import {
  ExperimentMetricInterface,
  getDelayWindowHours,
  getMetricWindowHours,
  isFactFunnelMetric,
} from "shared/experiments";
import { conversionWindowToSeconds } from "shared/funnels";

/**
 * Hours after exposure by which every funnel step is settled, or null when the
 * step chain gives no bound (some step can fire anywhere inside the metric
 * window). Only meaningful when every step has its own conversion window —
 * otherwise a missing step window can consume the full metric envelope.
 */
function getFunnelCompletionHours(m: ExperimentMetricInterface): number | null {
  if (!isFactFunnelMetric(m)) return null;
  const { steps } = m.funnelSettings;
  if (steps.length === 0) return null;

  let total = 0;
  for (const step of steps) {
    // A step without its own window can fire anywhere inside the metric
    // envelope, so the step chain no longer yields a completion bound.
    if (!step.conversionWindow) return null;
    total += conversionWindowToSeconds(step.conversionWindow) / 3600;
  }
  return total;
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
    const funnelHours = getFunnelCompletionHours(m);
    const delayHours = getDelayWindowHours(m.windowSettings);

    // Step windows are hours-after-exposure even when the metric-level
    // type is none/lookback.
    let metricHours: number | null = null;
    if (m.windowSettings.type === "conversion") {
      const windowHours = getMetricWindowHours(m.windowSettings);
      metricHours =
        delayHours +
        (funnelHours === null
          ? windowHours
          : Math.min(windowHours, funnelHours));
    } else if (funnelHours !== null) {
      metricHours = delayHours + funnelHours;
    }

    if (metricHours === null) {
      return;
    }

    if (funnelMetric) {
      // funnel metric windows can cascade, so sum each metric hours to get max
      neededHoursForConversion += metricHours;
    } else if (metricHours > neededHoursForConversion) {
      neededHoursForConversion = metricHours;
    }
  });
  // activation metrics windows always cascade
  if (
    activationMetric &&
    activationMetric.windowSettings.type === "conversion"
  ) {
    neededHoursForConversion +=
      getDelayWindowHours(activationMetric.windowSettings) +
      getMetricWindowHours(activationMetric.windowSettings);
  }
  return neededHoursForConversion;
}
