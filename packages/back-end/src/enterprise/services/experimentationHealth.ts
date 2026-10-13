import {
  ExperimentationHealthSummary,
  getAverage,
  getCompletedExperimentsInWindow,
  getExperimentQualityScore,
  getExperimentsStartedPerMonth,
  getGoalMetricNames,
  getHealthSettings,
  getHealthWindow,
  getIdeasPerMonth,
  getProcessScore,
  getWinRate,
  resolveExperimentQualitySettings,
} from "shared/enterprise";
import { ExperimentInterface, ORG_DEFAULT_SCOPE } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { getIdeasByOrganization } from "back-end/src/services/ideas";
import { getExperimentMetricsByIds } from "back-end/src/services/experiments";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import {
  canJudgeProcess,
  hasCurrentProcessResults,
} from "back-end/src/enterprise/services/experimentProcess";
import { queueExperimentProcessScoreBackfill } from "back-end/src/jobs/updateExperimentProcessScores";
import { logger } from "back-end/src/util/logger";

// Average process score of completed experiments with current cached
// results. Missing or outdated results are filled in by a background job,
// so this never reads audit history.
function getAverageProcessScore(
  context: ReqContext,
  completed: ExperimentInterface[],
): { average: number | null; pending: number } {
  const judgeable = completed.filter(canJudgeProcess);
  const pending = judgeable.filter((e) => !hasCurrentProcessResults(e));
  if (pending.length) {
    queueExperimentProcessScoreBackfill(
      context.org.id,
      pending.map((e) => e.id),
    ).catch((e) =>
      logger.error(e, "Failed to queue the process score backfill"),
    );
  }
  const scores = judgeable
    .filter(hasCurrentProcessResults)
    .map((e) => getProcessScore(e.processResults?.rules ?? []))
    .filter((score): score is number => score !== null);
  return { average: getAverage(scores), pending: pending.length };
}

async function getAverageQualityScore(
  context: ReqContext,
  experiments: ExperimentInterface[],
): Promise<number | null> {
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
  const healthSettings = getHealthSettings(
    context.org.settings,
    context.hasPremiumFeature("decision-framework"),
  );

  const scores: number[] = [];
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
    const { score } = getExperimentQualityScore({
      experiment,
      settings: resolved.settings,
      healthSettings,
      goalMetricNames: getGoalMetricNames(experiment.goalMetrics, (id) =>
        metricNames.get(id),
      ),
    });
    if (score !== null) scores.push(score);
  }
  return getAverage(scores);
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

  const [averageQualityScore, ideas] = await Promise.all([
    getAverageQualityScore(context, completed),
    getIdeasByOrganization(context.org.id, project || undefined),
  ]);
  const process = getAverageProcessScore(context, completed);

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
      averageQualityScore,
      processScore: process.average,
      winRate: getWinRate(completed),
      ideasPerMonth,
    },
    ideasInUse: ideasPerMonth > 0,
    processPending: process.pending,
  };
}
