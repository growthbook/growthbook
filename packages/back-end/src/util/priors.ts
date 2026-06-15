import type { MetricOverride } from "shared/types/experiment";
import type { MetricPriorSettings } from "shared/types/fact-table";

export function validatePriorSettings(
  priorSettings: Partial<Pick<MetricPriorSettings, "stddev">> | undefined,
): void {
  if (
    priorSettings?.stddev !== undefined &&
    (Number.isNaN(priorSettings.stddev) || priorSettings.stddev <= 0)
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
      (Number.isNaN(override.properPriorStdDev) ||
        override.properPriorStdDev <= 0)
    ) {
      throw new Error(
        `Prior standard deviation must be greater than 0 for metric ${override.id}`,
      );
    }
  }
}
