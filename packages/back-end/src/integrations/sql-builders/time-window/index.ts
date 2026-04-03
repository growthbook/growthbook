/**
 * Time Window Utilities
 *
 * Pure functions for calculating experiment metric time windows.
 * Extracted from SqlIntegration.ts for better testability and reuse.
 *
 * These functions calculate:
 * - When to start querying metric data (accounting for lookback delays)
 * - When to stop querying metric data (accounting for conversion windows)
 * - Maximum hours needed for users to convert (for skipPartialData)
 */

import { ExperimentMetricInterface } from "shared/experiments";
import {
  getDelayWindowHours,
  getMetricWindowHours,
} from "shared/experiments";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";

/**
 * Calculate the minimum delay across a set of metrics.
 *
 * Used to determine how far back before the experiment start we need
 * to query metric data. A negative delay means we need to look at
 * events that happened BEFORE the user was exposed to the experiment.
 *
 * For funnel metrics where windows cascade, the delays accumulate.
 *
 * @param metrics - Array of experiment metrics
 * @returns Minimum (most negative) delay in hours
 *
 * @example
 * // Metric with -24 hour delay (lookback)
 * getMetricMinDelay([metricWithLookback]) // -24
 *
 * // Two metrics with cascading delays
 * getMetricMinDelay([m1WithDelay24, m2WithDelayNeg48]) // -72 (24 + -48)
 */
export function getMetricMinDelay(
  metrics: ExperimentMetricInterface[]
): number {
  let runningDelay = 0;
  let minDelay = 0;

  metrics.forEach((m) => {
    const delay = getDelayWindowHours(m.windowSettings);
    if (delay) {
      const totalDelay = runningDelay + delay;
      if (totalDelay < minDelay) {
        minDelay = totalDelay;
      }
      runningDelay = totalDelay;
    }
  });

  return minDelay;
}

/**
 * Calculate the start date for querying metric data.
 *
 * The start date may be earlier than the experiment start if:
 * - Metrics have negative delays (lookback windows)
 * - Regression adjustment is enabled (need pre-experiment data)
 *
 * @param initial - The experiment start date
 * @param minDelay - Minimum delay from getMetricMinDelay (negative for lookback)
 * @param regressionAdjustmentHours - Hours of pre-experiment data for CUPED
 * @returns Adjusted start date for metric queries
 *
 * @example
 * // No adjustments needed
 * getMetricStart(expStart, 0, 0) // expStart
 *
 * // 24 hour lookback
 * getMetricStart(expStart, -24, 0) // expStart - 24 hours
 *
 * // 48 hour regression adjustment
 * getMetricStart(expStart, 0, 48) // expStart - 48 hours
 */
export function getMetricStart(
  initial: Date,
  minDelay: number,
  regressionAdjustmentHours: number
): Date {
  const metricStart = new Date(initial);

  // If minDelay is negative, we need to look back before the experiment started
  if (minDelay < 0) {
    metricStart.setHours(metricStart.getHours() + minDelay);
  }

  // Regression adjustment requires pre-experiment data
  if (regressionAdjustmentHours > 0) {
    metricStart.setHours(metricStart.getHours() - regressionAdjustmentHours);
  }

  return metricStart;
}

/**
 * Calculate the end date for querying metric data.
 *
 * The end date is extended beyond the experiment end to account for
 * conversion windows - users need time after exposure to convert.
 *
 * For funnel metrics where windows cascade, the hours accumulate.
 *
 * @param metrics - Array of experiment metrics
 * @param initial - The experiment end date (optional)
 * @param overrideConversionWindows - If true, return initial without extending
 * @returns Extended end date, or null if initial is undefined
 *
 * @example
 * // 72 hour conversion window
 * getMetricEnd([metric72h], expEnd) // expEnd + 72 hours
 *
 * // Multiple metrics with cascading windows
 * getMetricEnd([m1_48h, m2_72h], expEnd) // expEnd + max(48, 48+72+delay)
 */
export function getMetricEnd(
  metrics: ExperimentMetricInterface[],
  initial?: Date,
  overrideConversionWindows?: boolean
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
      if (hours > maxHours) {
        maxHours = hours;
      }
      runningHours = hours;
    }
  });

  if (maxHours > 0) {
    metricEnd.setHours(metricEnd.getHours() + maxHours);
  }

  return metricEnd;
}

/**
 * Calculate maximum hours needed for a user to fully convert.
 *
 * Used with skipPartialData to exclude users who haven't had enough
 * time to complete their conversion journey.
 *
 * For funnel metrics, windows cascade (sum together).
 * For non-funnel metrics, we take the maximum window.
 * Activation metrics always add to the total.
 *
 * @param funnelMetric - Whether this is a funnel metric (windows cascade)
 * @param metricAndDenominatorMetrics - Primary metric and any denominator metrics
 * @param activationMetric - Optional activation metric (always adds to total)
 * @returns Maximum hours needed for conversion
 *
 * @example
 * // Single metric with 72h window + 24h delay
 * getMaxHoursToConvert(false, [metric], null) // 96
 *
 * // Funnel metric: windows cascade
 * getMaxHoursToConvert(true, [m1_48h, m2_72h], null) // 48 + 72 = 120
 *
 * // With activation metric
 * getMaxHoursToConvert(false, [metric_48h], activation_24h) // 48 + 24 = 72
 */
export function getMaxHoursToConvert(
  funnelMetric: boolean,
  metricAndDenominatorMetrics: ExperimentMetricInterface[],
  activationMetric: ExperimentMetricInterface | null
): number {
  let neededHoursForConversion = 0;

  metricAndDenominatorMetrics.forEach((m) => {
    if (m.windowSettings.type === "conversion") {
      const metricHours =
        getDelayWindowHours(m.windowSettings) +
        getMetricWindowHours(m.windowSettings);

      if (funnelMetric) {
        // Funnel metric windows cascade, so sum each metric's hours
        neededHoursForConversion += metricHours;
      } else if (metricHours > neededHoursForConversion) {
        // Non-funnel: take the maximum
        neededHoursForConversion = metricHours;
      }
    }
  });

  // Activation metrics always cascade (add to total)
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

/**
 * Calculate the effective experiment end date for filtering users.
 *
 * When skipPartialData is enabled, we exclude users who haven't had
 * enough time to fully convert. This returns the earlier of:
 * - The actual experiment end date
 * - The current time minus the conversion window
 *
 * @param settings - Experiment snapshot settings
 * @param conversionWindowHours - Hours needed for conversion (from getMaxHoursToConvert)
 * @returns Effective end date for filtering experiment users
 *
 * @example
 * // skipPartialData = false: use actual end date
 * getExperimentEndDate(settings, 72) // settings.endDate
 *
 * // skipPartialData = true, experiment still running
 * // Returns (now - 72 hours) so users have time to convert
 * getExperimentEndDate(settings, 72) // now - 72h
 */
export function getExperimentEndDate(
  settings: ExperimentSnapshotSettings,
  conversionWindowHours: number
): Date {
  // If we don't need to skip partial data, use the actual end date
  if (!settings.skipPartialData) {
    return settings.endDate;
  }

  // Calculate the last date that gives users enough time to convert
  const conversionWindowEndDate = new Date();
  conversionWindowEndDate.setHours(
    conversionWindowEndDate.getHours() - conversionWindowHours
  );

  // Use the earlier of the experiment end date or conversion window end
  return new Date(
    Math.min(settings.endDate.getTime(), conversionWindowEndDate.getTime())
  );
}
