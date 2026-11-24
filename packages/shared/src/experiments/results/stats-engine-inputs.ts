import { DEFAULT_TARGET_MDE } from "shared/constants";
import type { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";

export type BusinessMetricLists = Pick<
  ExperimentSnapshotSettings,
  "goalMetrics" | "secondaryMetrics" | "guardrailMetrics"
>;

/**
 * The stats engine's settings for a metric that change its statistics without
 * changing its result query SQL or its Incremental Pipeline settings hash. A
 * new-metrics update compares them to tell whether a result it would copy is
 * stale, so both are built here.
 */
export function getMetricStatsEngineInputs(
  metricId: string,
  priors: {
    properPrior: boolean;
    properPriorMean: number;
    properPriorStdDev: number;
    targetMDE?: number;
  },
  settings: BusinessMetricLists,
) {
  return {
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
