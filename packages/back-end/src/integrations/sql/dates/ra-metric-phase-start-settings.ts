import type { CovariatePhaseStartSettings } from "shared/types/integrations";

/** Accounts for minimum delay from activation metric and analysis metric. */
export function getRaMetricPhaseStartSettings({
  minDelay,
  phaseStartDate,
  regressionAdjustmentHours,
}: {
  minDelay: number;
  phaseStartDate: Date;
  regressionAdjustmentHours: number;
}): CovariatePhaseStartSettings {
  const metricEnd = new Date(phaseStartDate);
  if (minDelay > 0) {
    metricEnd.setHours(metricEnd.getHours() + minDelay);
  }

  const metricStart = new Date(phaseStartDate);
  if (regressionAdjustmentHours > 0) {
    metricStart.setHours(metricStart.getHours() - regressionAdjustmentHours);
  }

  return {
    covariateStartDate: metricStart,
    covariateEndDate: metricEnd,
  };
}
