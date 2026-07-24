import type { MetricTimeSeries } from "../validators/metric-time-series";

export function filterInvalidMetricTimeSeries(
  metricTimeSeries: MetricTimeSeries[],
): MetricTimeSeries[] {
  return metricTimeSeries
    .map((ts) => ({
      ...ts,
      dataPoints: ts.dataPoints.filter(isValidDataPoint),
    }))
    .filter(isValidMetricTimeSeries);
}

// Must have at least 1 valid data point
export function isValidMetricTimeSeries(metricTimeSeries: MetricTimeSeries) {
  return metricTimeSeries.dataPoints.length > 0;
}

export function isValidDataPoint(
  dataPoint: MetricTimeSeries["dataPoints"][number],
) {
  // If there are not variations or only control it is not a valid data point at the moment
  if (!dataPoint.variations || dataPoint.variations.length <= 1) {
    return false;
  }

  // Only drop the point when EVERY treatment variation (index 1+) is degenerate
  // (absolute CI of [0, 0]). A point with a real estimate for at least one
  // variation is still useful and should be kept.
  const allTreatmentsDegenerate = dataPoint.variations
    .slice(1)
    .every(
      (variation) =>
        variation.absolute?.ci &&
        variation.absolute.ci[0] === 0 &&
        variation.absolute.ci[1] === 0,
    );

  return !allTreatmentsDegenerate;
}
