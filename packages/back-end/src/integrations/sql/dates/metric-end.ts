import {
  ExperimentMetricInterface,
  getMetricWindowHours,
  getDelayWindowHours,
} from "shared/experiments";

export function getMetricEnd(
  metrics: ExperimentMetricInterface[],
  initial?: Date,
  overrideConversionWindows?: boolean,
): Date | null {
  if (!initial) return null;
  if (overrideConversionWindows) return initial;

  const metricEnd = new Date(initial);
  let runningHours = 0;
  let maxHours = 0;
  metrics.forEach((m) => {
    if (m.windowSettings.type === "conversion") {
      const hours =
        runningHours +
        getMetricWindowHours(m.windowSettings) +
        getDelayWindowHours(m.windowSettings);
      if (hours > maxHours) maxHours = hours;
      runningHours = hours;
    }
  });

  if (maxHours > 0) {
    metricEnd.setHours(metricEnd.getHours() + maxHours);
  }

  return metricEnd;
}
