import type { ExperimentInterface } from "shared/types/experiment";
import type {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotNewMetricsUpdate,
} from "shared/types/experiment-snapshot";
import type { MetricGroupInterface } from "shared/types/metric-groups";
import type { newMetricsUpdateUnavailableReasons } from "../validators/api-errors";
import {
  expandMetricGroups,
  getAllMetricIdsFromExperiment,
  getDefinitionMetricId,
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
 * The experiment's metrics that no snapshot analyzes because of the
 * experiment's type: a holdout analyzes neither guardrails, unless they are
 * also goal or secondary metrics, nor conversion-window metrics.
 */
export function getMetricIdsExcludedByExperimentType({
  experiment,
  metricGroups,
  getMetricById,
}: {
  experiment: Pick<
    ExperimentInterface,
    "type" | "goalMetrics" | "secondaryMetrics" | "guardrailMetrics"
  >;
  metricGroups: MetricGroupInterface[];
  getMetricById: (
    metricId: string,
  ) => { windowSettings?: { type?: string } } | null | undefined;
}): Set<string> {
  if (experiment.type !== "holdout") return new Set();
  const analyzed = new Set(
    expandMetricGroups(
      [...experiment.goalMetrics, ...experiment.secondaryMetrics],
      metricGroups,
    ),
  );
  return new Set(
    getAllMetricIdsFromExperiment(experiment, false, metricGroups).filter(
      (id) =>
        !analyzed.has(id) ||
        getMetricById(id)?.windowSettings?.type === "conversion",
    ),
  );
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

export function getSnapshotDataAsOf(snapshot: SnapshotLineage): Date {
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

export function getMetricFilterForCarriedQueries(
  snapshot: Pick<
    ExperimentSnapshotInterface,
    "type" | "newMetricsUpdate" | "settings"
  >,
): ReadonlySet<string> | undefined {
  if (!getNewMetricsUpdate(snapshot)) return undefined;
  return new Set(snapshot.settings.metricSettings.map((m) => m.id));
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
