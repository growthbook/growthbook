import type { ExperimentInterface } from "shared/types/experiment";
import type {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
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
  "dateCreated" | "metricRefresh"
>;

/**
 * Side effects that differ between a full run and a metric refresh. Callers
 * keep their own conditions and also require the flag.
 */
export function getSnapshotSideEffects(snapshot: SnapshotLineage) {
  const refresh = snapshot.metricRefresh;
  if (!refresh) {
    return {
      advanceUpdateSchedule: true,
      refreshDashboards: true,
      ownsUpdateFailedAlert: true,
      yieldsToNewerOverallSnapshot: false,
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
    yieldsToNewerOverallSnapshot: true,
    timeSeries: {
      includesMetric: (metricId: string): boolean =>
        refreshed.has(getDefinitionMetricId(metricId)),
      pointDate: refresh.baseDateCreated,
    },
  };
}

export function getMetricFilterForCarriedQueries(
  snapshot: Pick<ExperimentSnapshotInterface, "metricRefresh" | "settings">,
): ReadonlySet<string> | undefined {
  if (!snapshot.metricRefresh) return undefined;
  return new Set(snapshot.settings.metricSettings.map((m) => m.id));
}
