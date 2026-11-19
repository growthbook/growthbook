import type { ExperimentInterface } from "shared/types/experiment";
import type {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotNewMetricsUpdate,
} from "shared/types/experiment-snapshot";
import type { MetricGroupInterface } from "shared/types/metric-groups";
import type { DataSourceSettings } from "shared/types/datasource";
import type { FactTableInterface } from "shared/types/fact-table";
import type { newMetricsUpdateUnavailableReasons } from "../validators/api-errors";
import {
  type ExperimentMetricDefinition,
  expandMetricGroups,
  getAllMetricIdsFromExperiment,
  getClusterExperimentMetricEligibility,
  getDefinitionMetricId,
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
}: {
  reasons: readonly ResultsOutdatedReason[];
  resultsEndDate: Date;
  windowHours: number;
  now: Date;
  newMetricsUpdateBlocker: NewMetricsUpdateBlocker | null;
}): boolean {
  return (
    reasons.length > 0 &&
    reasons.every((r) => r === "metrics_changed") &&
    !newMetricsUpdateBlocker &&
    isWithinNewMetricsUpdateWindow({ resultsEndDate, windowHours, now })
  );
}
