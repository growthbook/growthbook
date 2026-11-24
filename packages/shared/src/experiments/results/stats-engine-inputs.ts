import { DEFAULT_TARGET_MDE } from "shared/constants";
import type {
  ExperimentSnapshotSettings,
  MetricStatsEngineInputs,
} from "shared/types/experiment-snapshot";
import type { ExperimentMetricDefinition } from "../experiments";

export type BusinessMetricLists = Pick<
  ExperimentSnapshotSettings,
  "goalMetrics" | "secondaryMetrics" | "guardrailMetrics"
>;

type StatsEngineInputsSettings = Pick<
  ExperimentSnapshotSettings,
  "metricSettings" | "goalMetrics" | "secondaryMetrics" | "guardrailMetrics"
>;

/** The inputs taken from stored or computed priors and the metric's roles. */
export function getPriorAndRoleInputs(
  metricId: string,
  priors: {
    properPrior: boolean;
    properPriorMean: number;
    properPriorStdDev: number;
    targetMDE?: number;
  },
  settings: BusinessMetricLists,
): Omit<MetricStatsEngineInputs, "inverse"> {
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
  return {
    inverse: !!metric.inverse,
    ...getPriorAndRoleInputs(
      metric.id,
      computed ?? {
        properPrior: metric.priorSettings.proper,
        properPriorMean: metric.priorSettings.mean,
        properPriorStdDev: metric.priorSettings.stddev,
        targetMDE: metric.targetMDE,
      },
      settings,
    ),
  };
}
