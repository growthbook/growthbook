import type { SqlHelpers } from "shared/types/sql";

import { quantileColumn } from "./quantile-column";

export function percentileCapSelectClause(
  helpers: SqlHelpers,
  values: {
    valueCol: string;
    outputCol: string;
    percentile: number;
    ignoreZeros: boolean;
    sourceIndex: number;
  }[],
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
