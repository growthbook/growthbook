import isEqual from "lodash/isEqual";
import {
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
  DEFAULT_TARGET_MDE,
} from "shared/constants";
import type { ExperimentInterface } from "shared/types/experiment";
import type {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  MetricStatsEngineInputs,
  SnapshotNewMetricsUpdate,
} from "shared/types/experiment-snapshot";
import type { MetricGroupInterface } from "shared/types/metric-groups";
import type { DataSourceSettings } from "shared/types/datasource";
import type { FactTableInterface } from "shared/types/fact-table";
import type { OrganizationSettings } from "shared/types/organization";
import type { newMetricsUpdateUnavailableReasons } from "../validators/api-errors";
import {
  type ExperimentMetricDefinition,
  expandMetricGroups,
  getAllMetricIdsFromExperiment,
  getClusterExperimentMetricEligibility,
  getDefinitionMetricId,
  getMetricSnapshotSettings,
  isFactMetric,
  isFactMetricJoinable,
  isMetricJoinable,
} from "./experiments";
import type { ResultsOutdatedReason } from "./outdated-reasons";

/**
 * The experiment's metrics that a snapshot holds no results for, in the
 * experiment's goal, secondary, guardrail order. Metric groups are expanded;
 * slice and funnel-step ids are left out, and so is the activation metric
 * unless it is also a goal, secondary or guardrail metric.
 */
export function getMetricIdsMissingFromSnapshot({
  experiment,
  snapshotSettings,
  metricGroups,
}: {
  experiment: Pick<
    ExperimentInterface,
    "goalMetrics" | "secondaryMetrics" | "guardrailMetrics"
  >;
  snapshotSettings: Pick<ExperimentSnapshotSettings, "metricSettings">;
  metricGroups: MetricGroupInterface[];
}): string[] {
  const computed = new Set(snapshotSettings.metricSettings.map((m) => m.id));
  return getAllMetricIdsFromExperiment(experiment, false, metricGroups).filter(
    (id) => !computed.has(id) && getDefinitionMetricId(id) === id,
  );
}

/**
 * The experiment's metrics missing from a snapshot that a new-metrics update
 * would compute. Mirrors the metrics the back-end snapshot planner gives a
 * `metricSettings` entry: the metric must load, join the experiment's units
 * (for a cluster experiment, be cluster-eligible), and for a holdout be a goal
 * or secondary metric without a conversion window.
 */
export function getComputableNewMetricIds({
  experiment,
  snapshotSettings,
  metricGroups,
  getMetricById,
  getFactTableById,
  identifierType,
  datasourceSettings,
}: {
  experiment: Pick<
    ExperimentInterface,
    | "type"
    | "goalMetrics"
    | "secondaryMetrics"
    | "guardrailMetrics"
    | "isClusterExperiment"
    | "clusterSubUnitIdentifier"
  >;
  snapshotSettings: Pick<ExperimentSnapshotSettings, "metricSettings">;
  metricGroups: MetricGroupInterface[];
  getMetricById: (id: string) => ExperimentMetricDefinition | null | undefined;
  getFactTableById: (
    id: string,
  ) => Pick<FactTableInterface, "userIdTypes"> | null | undefined;
  identifierType: string | undefined;
  // Undefined while the Data Source is unknown, which lets every metric join.
  datasourceSettings: DataSourceSettings | undefined;
}): string[] {
  const holdoutAnalyzed =
    experiment.type === "holdout"
      ? new Set(
          expandMetricGroups(
            [...experiment.goalMetrics, ...experiment.secondaryMetrics],
            metricGroups,
          ),
        )
      : null;
  const clusterSubUnitIdentifier = experiment.isClusterExperiment
    ? experiment.clusterSubUnitIdentifier
    : undefined;

  return getMetricIdsMissingFromSnapshot({
    experiment,
    snapshotSettings,
    metricGroups,
  }).filter((id) => {
    const metric = getMetricById(id);
    if (!metric) return false;
    if (
      holdoutAnalyzed &&
      (!holdoutAnalyzed.has(id) || metric.windowSettings?.type === "conversion")
    ) {
      return false;
    }
    if (clusterSubUnitIdentifier) {
      return getClusterExperimentMetricEligibility(metric, {
        clusterIdentifier: identifierType,
        clusterSubUnitIdentifier,
        getFactTable: getFactTableById,
        datasourceSettings,
      }).allowed;
    }
    if (!identifierType || !datasourceSettings) return true;
    return isFactMetric(metric)
      ? isFactMetricJoinable(
          metric,
          identifierType,
          getFactTableById,
          datasourceSettings,
        )
      : isMetricJoinable(
          metric.userIdTypes ?? [],
          identifierType,
          datasourceSettings,
        );
  });
}

type SnapshotLineage = Pick<
  ExperimentSnapshotInterface,
  "type" | "dateCreated" | "newMetricsUpdate"
>;

export function getNewMetricsUpdate(
  snapshot: Pick<ExperimentSnapshotInterface, "type" | "newMetricsUpdate">,
): SnapshotNewMetricsUpdate | null {
  return snapshot.type === "standard"
    ? (snapshot.newMetricsUpdate ?? null)
    : null;
}

/**
 * The settings the stats engine runs an analysis of this snapshot with. A
 * new-metrics update's analyses keep the parent's settings so the front end
 * finds them by equality, but their goal and guardrail counts predate the
 * metrics it added.
 */
export function getStatsEngineAnalysisSettings(
  snapshot: Pick<
    ExperimentSnapshotInterface,
    "type" | "newMetricsUpdate" | "settings"
  >,
  analysisSettings: ExperimentSnapshotAnalysisSettings,
): ExperimentSnapshotAnalysisSettings {
  if (!getNewMetricsUpdate(snapshot)) return analysisSettings;
  return {
    ...analysisSettings,
    numGoalMetrics: snapshot.settings.goalMetrics.length,
    numGuardrailMetrics: snapshot.settings.guardrailMetrics.length,
  };
}

export function getSnapshotDataAsOfDate(snapshot: SnapshotLineage): Date {
  return getNewMetricsUpdate(snapshot)?.baseDateCreated ?? snapshot.dateCreated;
}

/**
 * The results endpoint's `dateEnd`. A new-metrics update reports what its base
 * reported, so adding metrics never moves it.
 */
export function getResultsDateEnd(
  snapshot: Pick<
    ExperimentSnapshotInterface,
    "type" | "newMetricsUpdate" | "runStarted"
  >,
  phase: { dateEnded?: Date | null } | undefined,
): Date | null {
  if (phase?.dateEnded) return phase.dateEnded;
  const newMetricsUpdate = getNewMetricsUpdate(snapshot);
  return (
    (newMetricsUpdate
      ? newMetricsUpdate.baseRunStarted
      : snapshot.runStarted) ?? null
  );
}

/**
 * Side effects that differ between a full run and a new-metrics update. Callers
 * keep their own conditions and also require the flag.
 */
export function getSnapshotSideEffects(snapshot: SnapshotLineage) {
  const newMetricsUpdate = getNewMetricsUpdate(snapshot);
  if (!newMetricsUpdate) {
    return {
      advanceUpdateSchedule: true,
      refreshDashboards: true,
      ownsUpdateFailedAlert: true,
      timeSeries: {
        includesMetric: (): boolean => true,
        pointDate: snapshot.dateCreated,
      },
    };
  }
  const newMetricIds = new Set(newMetricsUpdate.metricIds);
  return {
    advanceUpdateSchedule: false,
    refreshDashboards: false,
    ownsUpdateFailedAlert: false,
    timeSeries: {
      includesMetric: (metricId: string): boolean =>
        newMetricIds.has(getDefinitionMetricId(metricId)),
      pointDate: newMetricsUpdate.baseDateCreated,
    },
  };
}

export type NewMetricsUpdateBlocker = Extract<
  (typeof newMetricsUpdateUnavailableReasons)[number],
  | "unsupported_experiment_type"
  | "not_latest_phase"
  | "phase_ended"
  | "unsupported_data_source"
  | "metric_not_supported"
>;

type NewMetricsUpdateBlockerArgs = {
  experiment: Pick<ExperimentInterface, "type"> & {
    phases: { dateEnded?: string | Date }[];
  };
  phase: number;
  separateExperimentResultQueries: boolean;
};

/**
 * What the experiment and its Data Source alone rule out, before any results
 * are read.
 */
export function getNewMetricsUpdateSetupBlocker({
  experiment,
  phase,
  separateExperimentResultQueries,
}: NewMetricsUpdateBlockerArgs): NewMetricsUpdateBlocker | null {
  if ((experiment.type ?? "standard") !== "standard") {
    return "unsupported_experiment_type";
  }
  if (phase !== experiment.phases.length - 1) return "not_latest_phase";
  if (!separateExperimentResultQueries) return "unsupported_data_source";
  return null;
}

/**
 * Why no update can compute only new metrics for this phase, if anything.
 * `pipelineChanged`: the next update would run on a different pipeline than
 * the results did, for example because a new metric makes the Incremental
 * Pipeline fall back.
 */
export function getNewMetricsUpdateBlocker({
  pipelineChanged,
  ...args
}: NewMetricsUpdateBlockerArgs & {
  pipelineChanged: boolean;
}): NewMetricsUpdateBlocker | null {
  const setupBlocker = getNewMetricsUpdateSetupBlocker(args);
  if (setupBlocker) return setupBlocker;
  if (args.experiment.phases[args.phase]?.dateEnded) return "phase_ended";
  if (pipelineChanged) return "metric_not_supported";
  return null;
}

const HOUR_MS = 60 * 60 * 1000;

/** A window of 0 hours turns the new-metrics update off. */
export function isWithinNewMetricsUpdateWindow({
  resultsEndDate,
  windowHours,
  now,
}: {
  resultsEndDate: Date;
  windowHours: number;
  now: Date;
}): boolean {
  return (
    windowHours > 0 &&
    now.getTime() - resultsEndDate.getTime() < windowHours * HOUR_MS
  );
}

/**
 * Whether Update computes only the newly added metrics: they are the only
 * change, the results are recent, and nothing blocks such an update.
 */
export function shouldOfferNewMetricsUpdate({
  reasons,
  resultsEndDate,
  windowHours,
  now,
  newMetricsUpdateBlocker,
  statsEngineInputsChanged,
}: {
  reasons: readonly ResultsOutdatedReason[];
  resultsEndDate: Date;
  windowHours: number;
  now: Date;
  newMetricsUpdateBlocker: NewMetricsUpdateBlocker | null;
  // See haveStatsEngineInputsChanged.
  statsEngineInputsChanged: boolean;
}): boolean {
  return (
    reasons.length > 0 &&
    reasons.every((r) => r === "metrics_changed") &&
    !newMetricsUpdateBlocker &&
    !statsEngineInputsChanged &&
    isWithinNewMetricsUpdateWindow({ resultsEndDate, windowHours, now })
  );
}

type StatsEngineInputsSettings = Pick<
  ExperimentSnapshotSettings,
  "metricSettings" | "goalMetrics" | "secondaryMetrics" | "guardrailMetrics"
>;

function toStatsEngineInputs(
  metricId: string,
  inverse: boolean | undefined,
  priors: {
    properPrior: boolean;
    properPriorMean: number;
    properPriorStdDev: number;
    targetMDE?: number;
  },
  settings: Omit<StatsEngineInputsSettings, "metricSettings">,
): MetricStatsEngineInputs {
  return {
    inverse: !!inverse,
    properPrior: priors.properPrior,
    properPriorMean: priors.properPriorMean,
    properPriorStdDev: priors.properPriorStdDev,
    targetMDE: priors.targetMDE ?? DEFAULT_TARGET_MDE,
    businessMetricTypes: [
      settings.goalMetrics.includes(metricId) ? ("goal" as const) : null,
      settings.secondaryMetrics.includes(metricId)
        ? ("secondary" as const)
        : null,
      settings.guardrailMetrics.includes(metricId)
        ? ("guardrail" as const)
        : null,
    ].filter((type) => type !== null),
  };
}

/**
 * The inputs the stats engine reads for a metric of a snapshot with these
 * settings. Its computed settings override the definition's priors and target
 * MDE, as they do before the stats engine runs.
 */
export function getMetricStatsEngineInputs(
  metric: Pick<
    ExperimentMetricDefinition,
    "id" | "inverse" | "priorSettings" | "targetMDE"
  >,
  settings: StatsEngineInputsSettings,
): MetricStatsEngineInputs {
  const computed = settings.metricSettings.find(
    (m) => m.id === metric.id,
  )?.computedSettings;
  return toStatsEngineInputs(
    metric.id,
    metric.inverse,
    computed ?? {
      properPrior: metric.priorSettings.proper,
      properPriorMean: metric.priorSettings.mean,
      properPriorStdDev: metric.priorSettings.stddev,
      targetMDE: metric.targetMDE,
    },
    settings,
  );
}

/**
 * The inputs a full update planned now would store for a metric, from today's
 * definitions. `metric` is the definition of the metric, or of the metric a
 * slice belongs to.
 */
export function getPlannedMetricStatsEngineInputs({
  metricId,
  metric,
  experiment,
  metricGroups,
  organizationSettings,
}: {
  metricId: string;
  metric: ExperimentMetricDefinition;
  experiment: Pick<
    ExperimentInterface,
    | "goalMetrics"
    | "secondaryMetrics"
    | "guardrailMetrics"
    | "metricOverrides"
    | "decisionFrameworkSettings"
    | "regressionAdjustmentEnabled"
  >;
  metricGroups: MetricGroupInterface[];
  organizationSettings: Partial<OrganizationSettings>;
}): MetricStatsEngineInputs {
  const { metricSnapshotSettings } = getMetricSnapshotSettings({
    metric,
    denominatorMetrics: [],
    experimentRegressionAdjustmentEnabled:
      experiment.regressionAdjustmentEnabled ??
      DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
    organizationSettings,
    metricOverrides: experiment.metricOverrides,
  });
  const definitionMetricId = getDefinitionMetricId(metricId);
  const targetMDE =
    experiment.decisionFrameworkSettings?.decisionFrameworkMetricOverrides?.find(
      (o) => o.id === definitionMetricId,
    )?.targetMDE ?? metric.targetMDE;
  return toStatsEngineInputs(
    metricId,
    metric.inverse,
    { ...metricSnapshotSettings, targetMDE },
    {
      goalMetrics: expandMetricGroups(experiment.goalMetrics, metricGroups),
      secondaryMetrics: expandMetricGroups(
        experiment.secondaryMetrics,
        metricGroups,
      ),
      guardrailMetrics: expandMetricGroups(
        experiment.guardrailMetrics,
        metricGroups,
      ),
    },
  );
}

/**
 * Whether the stats engine would read any of these metrics differently than it
 * did for the snapshot, so their copied results would be stale. A metric the
 * snapshot stored no inputs for, or one `getInputs` can't resolve, counts as
 * changed.
 */
export function haveStatsEngineInputsChanged({
  snapshotSettings,
  metricIds,
  getInputs,
}: {
  snapshotSettings: Pick<ExperimentSnapshotSettings, "metricStatsEngineInputs">;
  metricIds: Iterable<string>;
  getInputs: (metricId: string) => MetricStatsEngineInputs | null;
}): boolean {
  const stored = new Map(
    (snapshotSettings.metricStatsEngineInputs ?? []).map(
      ({ id, ...inputs }) => [id, inputs],
    ),
  );
  return [...metricIds].some((id) => {
    const before = stored.get(id);
    const now = getInputs(id);
    return !before || !now || !isEqual(before, now);
  });
}
