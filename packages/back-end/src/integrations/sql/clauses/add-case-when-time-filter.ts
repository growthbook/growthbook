import type { ExperimentMetricInterface } from "shared/experiments";
import type { MetricQuantileSettings } from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";

import { getConversionWindowClause } from "back-end/src/integrations/sql/clauses/conversion-window-clause";

export function addCaseWhenTimeFilter(
  dialect: SqlDialect,
  {
    col,
    metric,
    overrideConversionWindows,
    endDate,
    metricQuantileSettings,
    metricTimestampColExpr,
    exposureTimestampColExpr,
  }: {
    col: string;
    metric: ExperimentMetricInterface;
    overrideConversionWindows: boolean;
    endDate: Date;
    metricQuantileSettings?: MetricQuantileSettings;
    metricTimestampColExpr: string;
    exposureTimestampColExpr: string;
  },
): string {
  return `${dialect.ifElse(
    `${getConversionWindowClause(
      dialect,
      exposureTimestampColExpr,
      metricTimestampColExpr,
      metric,
      endDate,
      overrideConversionWindows,
    )}
        ${metricQuantileSettings?.ignoreZeros && metricQuantileSettings?.type === "event" ? `AND ${col} != 0` : ""}
      `,
    `${col}`,
    `NULL`,
  )}`;
}
