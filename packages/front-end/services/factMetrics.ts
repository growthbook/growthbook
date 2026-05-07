/**
 * Fact metrics whose numerator/denominator uses pre-aggregated sketch merge
 * (`kll merge` / `hll merge`) are created and updated via the REST API only;
 * the UI cannot represent these configurations.
 */
export const REST_API_ONLY_EDIT_MESSAGE =
  "This is a metric that can only be managed via the REST API";

export function isMergeAggregationMetric(metric: {
  numerator: { aggregation?: string };
  denominator?: { aggregation?: string } | null;
}): boolean {
  return [metric.numerator.aggregation, metric.denominator?.aggregation].some(
    (aggregation) => aggregation === "kll merge" || aggregation === "hll merge",
  );
}
