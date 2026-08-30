import type { FactMetricInterface } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";

import { computeParticipationDenominator } from "back-end/src/integrations/sql/processing/compute-participation-denominator";

/**
 * Applies the daily participation transformation to an aggregated value.
 * For dailyParticipation metrics, this divides by the number of days
 * in the participation window to get a participation rate.
 * For all other metric types, this returns the value unchanged.
 */
export function applyDailyParticipationTransformation(
  dialect: SqlDialect,
  {
    column,
    initialTimestampColumn,
    analysisEndDate,
    metric,
    overrideConversionWindows,
  }: {
    column: string;
    initialTimestampColumn: string;
    analysisEndDate: Date;
    metric: FactMetricInterface;
    overrideConversionWindows: boolean;
  },
): string {
  if (metric.metricType !== "dailyParticipation") {
    return column;
  }

  return `
      ${dialect.castToFloat(column)} / 
      ${computeParticipationDenominator(dialect, {
        initialTimestampColumn,
        analysisEndDate,
        metric,
        overrideConversionWindows,
      })}
    `;
}
