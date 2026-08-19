import {
  ExperimentMetricInterface,
  getFunnelStepMetrics,
  isFactFunnelMetric,
} from "shared/experiments";

export function getExperimentResultMetricIds(
  metrics: readonly ExperimentMetricInterface[],
): string[] {
  return metrics.flatMap((metric) =>
    isFactFunnelMetric(metric)
      ? [
          ...getFunnelStepMetrics(metric).map((stepMetric) => stepMetric.id),
          metric.id,
        ]
      : [metric.id],
  );
}
