import type { ExperimentMetricInterface } from "shared/experiments";
import type { MetricQuantileSettings } from "shared/types/fact-table";
import type { SqlHelpers } from "shared/types/sql";

import { getConversionWindowClause } from "./conversion-window-clause";

export function addCaseWhenTimeFilter(
  helpers: SqlHelpers,
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
  return `${helpers.ifElse(
    `${getConversionWindowClause(
      helpers,
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
