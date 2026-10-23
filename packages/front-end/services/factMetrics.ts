import { FactMetricInterface } from "shared/types/fact-table";

/**
 * Fact metrics whose numerator/denominator uses pre-aggregated sketch merge
 * (`kll merge` / `hll merge`) are created and updated via the REST API only;
 * the UI cannot represent these configurations.
 */
export const REST_API_ONLY_EDIT_MESSAGE =
  "This is a metric that can only be managed via the REST API";

export function isMergeAggregationMetric(metric: {
  numerator: { aggregation?: string } | null;
  denominator?: { aggregation?: string } | null;
}): boolean {
  return [metric.numerator?.aggregation, metric.denominator?.aggregation].some(
    (aggregation) => aggregation === "kll merge" || aggregation === "hll merge",
  );
}

export function getFactMetricCommercialFeature(
  metricType: FactMetricInterface["metricType"] | undefined,
) {
  if (metricType === "quantile") return "quantile-metrics" as const;
  if (metricType === "retention") return "retention-metrics" as const;
  if (metricType === "funnel") return "funnel-metrics" as const;
  return null;
}
