import type { SqlHelpers } from "shared/types/sql";

import { quantileColumn } from "./quantile-column";

export type PercentileCapSelectClauseValue = {
  valueCol: string;
  outputCol: string;
  percentile: number;
  ignoreZeros: boolean;
  sourceIndex: number;
};

/** Default SQL for a percentile-cap subquery; warehouses may override via `SqlHelpers.percentileCapSelectClause`. */
export function defaultPercentileCapSelectClause(
  helpers: SqlHelpers,
  values: PercentileCapSelectClauseValue[],
  metricTable: string,
  where: string = "",
): string {
  return `
        SELECT
          ${values
            .map(({ valueCol, outputCol, percentile, ignoreZeros }) => {
              const value = ignoreZeros
                ? helpers.ifElse(`${valueCol} = 0`, "NULL", valueCol)
                : valueCol;
              return quantileColumn(helpers, value, outputCol, percentile);
            })
            .join(",\n")}
        FROM ${metricTable}
        ${where}
        `;
}
