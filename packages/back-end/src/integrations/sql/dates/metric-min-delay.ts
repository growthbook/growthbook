import {
  ExperimentMetricInterface,
  getDelayWindowHours,
} from "shared/experiments";

export function getMetricMinDelay(
  metrics: ExperimentMetricInterface[],
): number {
  let runningDelay = 0;
  let minDelay = 0;
  metrics.forEach((m) => {
    if (getDelayWindowHours(m.windowSettings)) {
      const delay = runningDelay + getDelayWindowHours(m.windowSettings);
      if (delay < minDelay) minDelay = delay;
      runningDelay = delay;
    }
  });
  return minDelay;
}
