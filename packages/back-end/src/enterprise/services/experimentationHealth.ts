import {
  ExperimentationHealthSummary,
  ProcessHistoryEntry,
  evaluateProcessSignals,
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
import { findAuditByEntityList } from "back-end/src/models/AuditModel";
import { getIdeasByOrganization } from "back-end/src/services/ideas";
import { getExperimentMetricsByIds } from "back-end/src/services/experiments";
import { getAISettingsForOrg } from "back-end/src/services/organizations";

// Audit events whose before/after snapshots feed the process signals
const PROCESS_AUDIT_EVENTS = [
  "experiment.update",
  "experiment.status",
  "experiment.phase",
];

function toProcessFields(snapshot: unknown): ProcessHistoryEntry["pre"] {
  if (!snapshot || typeof snapshot !== "object") return undefined;
  const { goalMetrics, hypothesis, status } = snapshot as Record<
    string,
    unknown
  >;
  return {
    ...(Array.isArray(goalMetrics)
      ? { goalMetrics: goalMetrics.filter((m) => typeof m === "string") }
      : {}),
    ...(typeof hypothesis === "string" ? { hypothesis } : {}),
    ...(status === "draft" || status === "running" || status === "stopped"
      ? { status }
      : {}),
  };
}

async function getProcessHistory(
  context: ReqContext,
  experimentIds: string[],
): Promise<Map<string, ProcessHistoryEntry[]>> {
  const history = new Map<string, ProcessHistoryEntry[]>();
  if (!experimentIds.length) return history;
  const audits = await findAuditByEntityList(
    context.org.id,
    "experiment",
    experimentIds,
    { event: { $in: PROCESS_AUDIT_EVENTS } },
  );
  for (const audit of audits) {
    let details: { pre?: unknown; post?: unknown } = {};
    try {
      details = audit.details ? JSON.parse(audit.details) : {};
    } catch {
      // Unparseable details still mark that history exists
    }
    const entries = history.get(audit.entity.id) ?? [];
    entries.push({
      date: audit.dateCreated,
      pre: toProcessFields(details.pre),
      post: toProcessFields(details.post),
    });
    history.set(audit.entity.id, entries);
  }
  return history;
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

  const [averageQualityScore, history, ideas] = await Promise.all([
    getAverageQualityScore(context, completed),
    getProcessHistory(
      context,
      completed.map((e) => e.id),
    ),
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
      averageQualityScore,
      processScore: getProcessScore(
        completed.map((e) =>
          evaluateProcessSignals(e, history.get(e.id) ?? []),
        ),
      ),
      winRate: getWinRate(completed),
      ideasPerMonth,
    },
    ideasInUse: ideasPerMonth > 0,
  };
}
