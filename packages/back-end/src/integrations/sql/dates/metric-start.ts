export function getMetricStart(
  initial: Date,
  minDelay: number,
  regressionAdjustmentHours: number,
): Date {
  const metricStart = new Date(initial);
  if (minDelay < 0) {
    metricStart.setHours(metricStart.getHours() + minDelay);
  }
  if (regressionAdjustmentHours > 0) {
    metricStart.setHours(metricStart.getHours() - regressionAdjustmentHours);
  }
  return metricStart;
}
