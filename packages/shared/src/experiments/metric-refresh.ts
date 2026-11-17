import type { ExperimentInterface } from "shared/types/experiment";
import type {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
  SnapshotMetricRefresh,
} from "shared/types/experiment-snapshot";
import type { MetricGroupInterface } from "shared/types/metric-groups";
import {
  getAllMetricIdsFromExperiment,
  getDefinitionMetricId,
} from "./experiments";

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
