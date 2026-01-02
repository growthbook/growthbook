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

  // Check variations from index 1 onwards (skip control)
  for (let i = 1; i < dataPoint.variations.length; i++) {
    const variation = dataPoint.variations[i];
    if (
      variation.absolute?.ci &&
      variation.absolute.ci[0] === 0 &&
      variation.absolute.ci[1] === 0
    ) {
      return false;
    }
  }

  return true;
}
