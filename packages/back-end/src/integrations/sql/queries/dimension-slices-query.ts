import { subDays } from "date-fns";
import { format } from "shared/sql";
import type { DataSourceInterface } from "shared/types/datasource";
import type { DimensionSlicesQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import {
  compileSqlTemplate,
  getBaseIdTypeAndJoins,
} from "back-end/src/util/sql";

import { getDimensionValuePerUnit } from "back-end/src/integrations/sql/fact-metrics/dimension-value-per-unit";
import { getExposureQuery } from "back-end/src/integrations/sql/queries/exposure-query";
import { getUnitCountCTE } from "back-end/src/integrations/sql/ctes/unit-count-cte";

export function getDimensionSlicesQuery(
  dialect: SqlDialect,
  datasource: DataSourceInterface,
  params: DimensionSlicesQueryParams,
): string {
  const exposureQuery = getExposureQuery(
    datasource,
    params.exposureQueryId || "",
  );

  const { baseIdType } = getBaseIdTypeAndJoins([[exposureQuery.userIdType]]);

  const startDate = subDays(new Date(), params.lookbackDays);
  const timestampColumn = "e.timestamp";
  return format(
    `-- Dimension Traffic Query
    WITH
      __rawExperiment AS (
        ${compileSqlTemplate(
          exposureQuery.query,
          {
            startDate: startDate,
          },
          dialect,
        )}
      ),
      __experimentExposures AS (
        -- Viewed Experiment
        SELECT
          e.${baseIdType} as ${baseIdType}
          , e.timestamp
          ${params.dimensions
            .map((d) => `, e.${d.id} AS dim_${d.id}`)
            .join("\n")}
        FROM
          __rawExperiment e
        WHERE
          ${timestampColumn} >= ${dialect.toTimestamp(startDate)}
      ),
      __distinctUnits AS (
        SELECT
          ${baseIdType}
          ${params.dimensions
            .map(
              (d) => `
            , ${getDimensionValuePerUnit(dialect, d)} AS dim_exp_${d.id}`,
            )
            .join("\n")}
          , 1 AS variation
        FROM
          __experimentExposures e
        GROUP BY
          e.${baseIdType}
      ),
      -- One row per dimension slice
      dim_values AS (
        SELECT
          1 AS variation
          , ${dialect.castToString("''")} AS dimension_value
          , ${dialect.castToString("''")} AS dimension_name
          , COUNT(*) AS units
        FROM
          __distinctUnits
        UNION ALL
        ${params.dimensions
          .map((d) => getUnitCountCTE(dialect, `dim_exp_${d.id}`))
          .join("\nUNION ALL\n")}
      ),
      total_n AS (
        SELECT
          SUM(units) AS N
        FROM dim_values
        WHERE dimension_name = ''
      ),
      dim_values_sorted AS (
        SELECT
          dimension_name
          , dimension_value
          , units
          , ROW_NUMBER() OVER (PARTITION BY dimension_name ORDER BY units DESC) as rn
        FROM
          dim_values
        WHERE
          dimension_name != ''
      )
      SELECT
        dim_values_sorted.dimension_name AS dimension_name,
        dim_values_sorted.dimension_value AS dimension_value,
        dim_values_sorted.units AS units,
        n.N AS total_units
      FROM
        dim_values_sorted
      CROSS JOIN total_n n
      WHERE 
        rn <= 20
    `,
    dialect.formatDialect,
  );
}
