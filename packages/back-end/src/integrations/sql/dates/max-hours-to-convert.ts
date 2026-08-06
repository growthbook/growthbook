import {
  ExperimentMetricInterface,
  getDelayWindowHours,
  getMetricWindowHours,
  isFactFunnelMetric,
} from "shared/experiments";
import { conversionWindowToSeconds } from "shared/funnels";

function getFunnelStepWindowHours(m: ExperimentMetricInterface): number {
  if (!isFactFunnelMetric(m)) return 0;
  return m.funnelSettings.steps.reduce(
    (total, step) =>
      total +
      (step.conversionWindow
        ? conversionWindowToSeconds(step.conversionWindow) / 3600
        : 0),
    0,
  );
}

export function getMaxHoursToConvert(
  funnelMetric: boolean,
  metricAndDenominatorMetrics: ExperimentMetricInterface[],
  activationMetric: ExperimentMetricInterface | null,
): number {
  // Used to set an experiment end date to filter out users
  // who have not had enough time to convert (if experimenter
  // has selected `skipPartialData`)
  let neededHoursForConversion = 0;
  metricAndDenominatorMetrics.forEach((m) => {
    if (m.windowSettings.type === "conversion") {
      const metricHours =
        getDelayWindowHours(m.windowSettings) +
        getMetricWindowHours(m.windowSettings) +
        // A funnel fact metric's steps convert in sequence inside the metric's
        // own window, so a unit needs the global window plus every per-step
        // window to have had a full chance to complete the funnel.
        getFunnelStepWindowHours(m);
      if (funnelMetric) {
        // funnel metric windows can cascade, so sum each metric hours to get max
        neededHoursForConversion += metricHours;
      } else if (metricHours > neededHoursForConversion) {
        neededHoursForConversion = metricHours;
      }
    }
  });
  // activation metrics windows always cascade
  if (
    activationMetric &&
    activationMetric.windowSettings.type == "conversion"
  ) {
    neededHoursForConversion +=
      getDelayWindowHours(activationMetric.windowSettings) +
      getMetricWindowHours(activationMetric.windowSettings);
  }
  return neededHoursForConversion;
}
