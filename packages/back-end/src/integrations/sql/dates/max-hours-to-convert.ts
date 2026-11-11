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
    let conversionHours: number | null = null;
    if (m.windowSettings.type === "conversion") {
      // The metric conversion window is a hard envelope on every event.
      // When every funnel step also has a window, the funnel is settled
      // earlier — at the sum of those step windows — so skipPartialData
      // can use the tighter of the two. Otherwise the envelope alone
      // bounds conversion.
      const windowHours = getMetricWindowHours(m.windowSettings);
      conversionHours =
        funnelHours === null ? windowHours : Math.min(windowHours, funnelHours);
    } else if (m.windowSettings.type === "" && funnelHours !== null) {
      // A funnel metric with a series of timed steps still has an implicit
      // envelope for conversion, so it should apply even if the overall
      // conversion window is not present. Note: we do not use the same logic
      // for lookback windows, which do not start at the exposure event.
      conversionHours = funnelHours;
    }
    if (conversionHours === null) return;

    const metricHours = getDelayWindowHours(m.windowSettings) + conversionHours;
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
