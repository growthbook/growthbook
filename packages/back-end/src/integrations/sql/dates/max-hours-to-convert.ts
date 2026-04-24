import {
  ExperimentMetricInterface,
  getDelayWindowHours,
  getMetricWindowHours,
} from "shared/experiments";

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
        getMetricWindowHours(m.windowSettings);
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
