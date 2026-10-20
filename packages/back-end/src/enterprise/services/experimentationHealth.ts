import {
  ExperimentationHealthSummary,
  canJudgeProcess,
  getAverage,
  getCompletedExperimentsInWindow,
  getExperimentQualityScore,
  getExperimentsStartedPerMonth,
  getGoalMetricNames,
  hasCurrentProcessResults,
  getHealthWindow,
  getIdeasPerMonth,
  getWinRate,
  resolveExperimentQualitySettings,
} from "shared/enterprise";
import { ExperimentInterface, ORG_DEFAULT_SCOPE } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { getIdeasByOrganization } from "back-end/src/services/ideas";
import { getExperimentMetricsByIds } from "back-end/src/services/experiments";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { queueExperimentProcessScoreBackfill } from "back-end/src/jobs/updateExperimentProcessScores";
import { logger } from "back-end/src/util/logger";

// Mean quality score of the completed experiments, each scored with its own
// Project's settings. Process checks need results cached by a background
// job; missing ones are queued, so this never reads audit history.
async function getAverageQualityScore(
  context: ReqContext,
  experiments: ExperimentInterface[],
): Promise<{ average: number | null; processPending: number }> {
  const metricIds = [...new Set(experiments.flatMap((e) => e.goalMetrics))];
  const [records, configs, { aiEnabled }, metrics] = await Promise.all([
    context.models.experimentationHealthSettings.getAll(),
    context.models.experimentQualityConfigs.getAll(),
    getAISettingsForOrg(context),
    getExperimentMetricsByIds(context, metricIds),
  ]);
  const recordsByProject = new Map(records.map((r) => [r.project, r]));
  const configsById = new Map(configs.map((c) => [c.id, c]));
  const metricNames = new Map(metrics.map((m) => [m.id, m.name]));

  const scores: number[] = [];
  const processPending: string[] = [];
  for (const experiment of experiments) {
    // Each experiment is scored with its own Project's quality settings
    const resolved = resolveExperimentQualitySettings({
      orgRecord: recordsByProject.get(ORG_DEFAULT_SCOPE),
      projectRecord: experiment.project
        ? recordsByProject.get(experiment.project)
        : null,
      getConfig: (id) => configsById.get(id),
      aiEnabled,
    });
    if (!resolved) continue;
    if (
      resolved.settings.sections.process.enabled &&
      canJudgeProcess(experiment) &&
      !hasCurrentProcessResults(experiment)
    ) {
      processPending.push(experiment.id);
    }
    const { score } = getExperimentQualityScore({
      experiment,
      settings: resolved.settings,
      goalMetricNames: getGoalMetricNames(experiment.goalMetrics, (id) =>
        metricNames.get(id),
      ),
    });
    if (score !== null) scores.push(score);
  }

  if (processPending.length) {
    queueExperimentProcessScoreBackfill(context.org.id, processPending).catch(
      (e) => logger.error(e, "Failed to queue the process score backfill"),
    );
  }
  return { average: getAverage(scores), processPending: processPending.length };
}

/**
 * Current values of the Experimentation Health metrics for a scope ("" =
 * the whole organization), over the trailing window. Only experiments and
 * ideas the user can read are included.
 */
export async function getExperimentationHealthSummary(
  context: ReqContext,
  project: string,
): Promise<ExperimentationHealthSummary> {
  const window = getHealthWindow();
  const experiments = await getAllExperiments(context, {
    ...(project ? { project } : {}),
    type: "standard",
  });
  const completed = getCompletedExperimentsInWindow(experiments, window);

  const [quality, ideas] = await Promise.all([
    getAverageQualityScore(context, completed),
    getIdeasByOrganization(context.org.id, project || undefined),
  ]);

  const ideaDates = ideas
    .filter(
      (idea) =>
        !idea.archived &&
        context.permissions.canReadSingleProjectResource(idea.project),
    )
    .map((idea) => idea.dateCreated);
  const ideasPerMonth = getIdeasPerMonth(ideaDates, window);

  return {
    windowDays: window.days,
    completedCount: completed.length,
    values: {
      experimentsStartedPerMonth: getExperimentsStartedPerMonth(
        experiments,
        window,
      ),
      averageQualityScore: quality.average,
      winRate: getWinRate(completed),
      ideasPerMonth,
    },
    ideasInUse: ideasPerMonth > 0,
    processPending: quality.processPending,
  };
}
