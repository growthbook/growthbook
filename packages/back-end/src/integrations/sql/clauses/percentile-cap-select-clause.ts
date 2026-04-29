import type { SqlDialect } from "shared/types/sql";

import { quantileColumn } from "back-end/src/integrations/sql/columns/quantile-column";

export type PercentileCapSelectClauseValue = {
  valueCol: string;
  outputCol: string;
  percentile: number;
  ignoreZeros: boolean;
  sourceIndex: number;
};

/** Default SQL for a percentile-cap subquery; warehouses may override via `SqlDialect.percentileCapSelectClause`. */
export function defaultPercentileCapSelectClause(
  dialect: SqlDialect,
  values: PercentileCapSelectClauseValue[],
  metricTable: string,
  where: string = "",
): string {
  return `
        SELECT
          ${values
            .map(({ valueCol, outputCol, percentile, ignoreZeros }) => {
              const value = ignoreZeros
                ? dialect.ifElse(`${valueCol} = 0`, "NULL", valueCol)
                : valueCol;
              return quantileColumn(dialect, value, outputCol, percentile);
            })
            .join(",\n")}
        FROM ${metricTable}
        ${where}
        `;
}
