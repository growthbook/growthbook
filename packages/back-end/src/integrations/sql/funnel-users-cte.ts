import type { ExperimentMetricInterface } from "shared/experiments";
import type { DimensionColumnData } from "shared/types/integrations";
import type { SqlHelpers } from "shared/types/sql";

import { getConversionWindowClause } from "./conversion-window-clause";

export function getFunnelUsersCTE(
  helpers: SqlHelpers,
  baseIdType: string,
  metrics: ExperimentMetricInterface[],
  endDate: Date,
  dimensionCols: DimensionColumnData[],
  regressionAdjusted: boolean = false,
  overrideConversionWindows: boolean = false,
  banditDates: Date[] | undefined = undefined,
  tablePrefix: string = "__denominator",
  initialTable: string = "__experiment",
): string {
  return `
      -- one row per user
      SELECT
        initial.${baseIdType} AS ${baseIdType}
        ${dimensionCols
          .map((c) => `, MIN(initial.${c.alias}) AS ${c.alias}`)
          .join("")}
        , MIN(initial.variation) AS variation
        , MIN(initial.first_exposure_date) AS first_exposure_date
        ${
          banditDates?.length
            ? `, MIN(initial.bandit_period) AS bandit_period`
            : ""
        }
        ${
          regressionAdjusted
            ? `
            , MIN(initial.preexposure_start) AS preexposure_start
            , MIN(initial.preexposure_end) AS preexposure_end`
            : ""
        }
        , MIN(t${metrics.length - 1}.timestamp) AS timestamp
      FROM
        ${initialTable} initial
        ${metrics
          .map((m, i) => {
            const prevAlias = i ? `t${i - 1}` : "initial";
            const alias = `t${i}`;
            return `JOIN ${tablePrefix}${i} ${alias} ON (
            ${alias}.${baseIdType} = ${prevAlias}.${baseIdType}
          )`;
          })
          .join("\n")}
      WHERE
        ${metrics
          .map((m, i) => {
            const prevAlias = i ? `t${i - 1}` : "initial";
            const alias = `t${i}`;
            return getConversionWindowClause(
              helpers,
              `${prevAlias}.timestamp`,
              `${alias}.timestamp`,
              m,
              endDate,
              overrideConversionWindows,
            );
          })
          .join("\n AND ")}
      GROUP BY
        initial.${baseIdType}`;
}
