import { ExperimentReportResultDimension } from "shared/types/report";
import { ExperimentMetricDefinition, isFactMetric } from "./experiments";

function snapshotHasMetric(
  results: ExperimentReportResultDimension[],
  metricId: string,
): boolean {
  return results.some((result) =>
    result.variations.some((v) => v.metrics?.[metricId] !== undefined),
  );
}

// Older metrics are substituted only when the snapshot has their results and
// not this metric's.
export function resolveMetricsForSnapshot({
  metric,
  getExperimentMetricById,
  results,
}: {
  metric: ExperimentMetricDefinition;
  getExperimentMetricById: (id: string) => ExperimentMetricDefinition | null;
  results: ExperimentReportResultDimension[];
}): {
  metrics: ExperimentMetricDefinition[];
  replacedByMetricName?: string;
} {
  if (
    !isFactMetric(metric) ||
    !metric.replaces?.length ||
    snapshotHasMetric(results, metric.id)
  ) {
    return { metrics: [metric] };
  }

  const metrics: ExperimentMetricDefinition[] = [];
  for (const replacedId of metric.replaces) {
    if (!snapshotHasMetric(results, replacedId)) continue;
    const replacedMetric = getExperimentMetricById(replacedId);
    if (replacedMetric) metrics.push(replacedMetric);
  }

  if (!metrics.length) return { metrics: [metric] };

  return { metrics, replacedByMetricName: metric.name };
}

export function resolveSnapshotMetricIds({
  metricIds,
  getExperimentMetricById,
  results,
}: {
  metricIds: string[];
  getExperimentMetricById: (id: string) => ExperimentMetricDefinition | null;
  results: ExperimentReportResultDimension[];
}): string[] {
  return [
    ...new Set(
      metricIds.flatMap((metricId) => {
        const metric = getExperimentMetricById(metricId);
        if (!metric) return [metricId];
        return resolveMetricsForSnapshot({
          metric,
          getExperimentMetricById,
          results,
        }).metrics.map((m) => m.id);
      }),
    ),
  ];
}
