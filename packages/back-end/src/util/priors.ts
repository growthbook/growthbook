import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import type { MetricOverride } from "shared/types/experiment";
import type { MetricPriorSettings } from "shared/types/fact-table";

// A proper prior needs a positive standard deviation. 0, a negative, or NaN
// divides by zero in the Bayesian engine; `stddev > 0` rejects all three.
function isValidPriorStdDev(stddev: number): boolean {
  return stddev > 0;
}

export function healPriorSettings(
  priorSettings: Pick<MetricPriorSettings, "stddev"> | undefined,
): void {
  if (priorSettings && !isValidPriorStdDev(priorSettings.stddev)) {
    priorSettings.stddev = DEFAULT_PROPER_PRIOR_STDDEV;
  }
}

export function healMetricOverrides(
  overrides: MetricOverride[] | undefined,
): void {
  if (!overrides) return;

  for (const override of overrides) {
    if (
      override.properPriorStdDev !== undefined &&
      !isValidPriorStdDev(override.properPriorStdDev)
    ) {
      override.properPriorStdDev = DEFAULT_PROPER_PRIOR_STDDEV;
    }
  }
}

export function validatePriorSettings(
  priorSettings: Partial<Pick<MetricPriorSettings, "stddev">> | undefined,
): void {
  if (
    priorSettings?.stddev !== undefined &&
    !isValidPriorStdDev(priorSettings.stddev)
  ) {
    throw new Error("Prior standard deviation must be greater than 0");
  }
}

export function validateMetricOverrides(
  overrides: MetricOverride[] | undefined,
): void {
  if (!overrides) return;

  for (const override of overrides) {
    if (
      override.properPriorStdDev !== undefined &&
      !isValidPriorStdDev(override.properPriorStdDev)
    ) {
      throw new Error(
        `Prior standard deviation must be greater than 0 for metric ${override.id}`,
      );
    }
  }
}
