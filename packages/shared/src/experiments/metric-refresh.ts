import type { ExperimentInterface } from "shared/types/experiment";
import type {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotMetricRefresh,
} from "shared/types/experiment-snapshot";
import type { MetricGroupInterface } from "shared/types/metric-groups";
import type { metricRefreshUnavailableReasons } from "../validators/api-errors";
import {
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

type SnapshotLineage = Pick<
  ExperimentSnapshotInterface,
  "type" | "dateCreated" | "metricRefresh"
>;

export function getMetricRefresh(
  snapshot: Pick<ExperimentSnapshotInterface, "type" | "metricRefresh">,
): SnapshotMetricRefresh | null {
  return snapshot.type === "standard" ? (snapshot.metricRefresh ?? null) : null;
}

export function getSnapshotDataAsOf(snapshot: SnapshotLineage): Date {
  return getMetricRefresh(snapshot)?.baseDateCreated ?? snapshot.dateCreated;
}

/**
 * Side effects that differ between a full run and a metric refresh. Callers
 * keep their own conditions and also require the flag.
 */
export function getSnapshotSideEffects(snapshot: SnapshotLineage) {
  const refresh = getMetricRefresh(snapshot);
  if (!refresh) {
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
  const refreshed = new Set(refresh.metricIds);
  return {
    advanceUpdateSchedule: false,
    refreshDashboards: false,
    ownsUpdateFailedAlert: false,
    timeSeries: {
      includesMetric: (metricId: string): boolean =>
        refreshed.has(getDefinitionMetricId(metricId)),
      pointDate: refresh.baseDateCreated,
    },
  };
}

export function getMetricFilterForCarriedQueries(
  snapshot: Pick<
    ExperimentSnapshotInterface,
    "type" | "metricRefresh" | "settings"
  >,
): ReadonlySet<string> | undefined {
  if (!getMetricRefresh(snapshot)) return undefined;
  return new Set(snapshot.settings.metricSettings.map((m) => m.id));
}

export type MetricRefreshBlocker = Extract<
  (typeof metricRefreshUnavailableReasons)[number],
  | "unsupported_experiment_type"
  | "not_latest_phase"
  | "phase_ended"
  | "unsupported_data_source"
>;

/** Why no update can compute only new metrics for this phase, if anything. */
export function getMetricRefreshBlocker({
  experiment,
  phase,
  separateExperimentResultQueries,
}: {
  experiment: Pick<ExperimentInterface, "type"> & {
    phases: { dateEnded?: string | Date }[];
  };
  phase: number;
  separateExperimentResultQueries: boolean;
}): MetricRefreshBlocker | null {
  if ((experiment.type ?? "standard") !== "standard") {
    return "unsupported_experiment_type";
  }
  if (phase !== experiment.phases.length - 1) return "not_latest_phase";
  if (experiment.phases[phase]?.dateEnded) return "phase_ended";
  if (!separateExperimentResultQueries) return "unsupported_data_source";
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
 * - `up_to_date`: nothing to show, a normal Update.
 * - `new_metrics`: added metrics are the only change and the results are
 *   recent, so Update computes only those metrics.
 * - `metrics_added`: added metrics are the only change, but the results are
 *   too old or no update can compute only new metrics: Outdated, a normal
 *   Update.
 * - `settings_changed`: anything else changed: Outdated, a normal Update.
 */
export type ResultsUpdateSituation =
  | "up_to_date"
  | "new_metrics"
  | "metrics_added"
  | "settings_changed";

export function getResultsUpdateSituation({
  reasons,
  resultsEndDate,
  windowHours,
  now,
  refreshBlocker,
}: {
  reasons: readonly ResultsOutdatedReason[];
  resultsEndDate: Date;
  windowHours: number;
  now: Date;
  refreshBlocker: MetricRefreshBlocker | null;
}): ResultsUpdateSituation {
  if (!reasons.length) return "up_to_date";
  if (reasons.some((r) => r !== "metrics_changed")) return "settings_changed";
  return !refreshBlocker &&
    isWithinNewMetricsUpdateWindow({ resultsEndDate, windowHours, now })
    ? "new_metrics"
    : "metrics_added";
}
