import { subDays } from "date-fns";
import { format, SQL_ROW_LIMIT } from "shared/sql";
import type { DataSourceInterface } from "shared/types/datasource";
import type { UserExperimentExposuresQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

import { getExposureQuery } from "back-end/src/integrations/sql/queries/exposure-query";

export function getUserExperimentExposuresQuery(
  dialect: SqlDialect,
  datasource: DataSourceInterface,
  params: UserExperimentExposuresQueryParams,
): string {
  const { userIdType } = params;
  const allExposureQueries = (datasource.settings.queries?.exposure || [])
    .map(({ id }) => getExposureQuery(datasource, id))
    .filter((query) => query.userIdType === userIdType);

  const allDimensionNames = Array.from(
    new Set(allExposureQueries.flatMap((query) => query.dimensions || [])),
  );
  const startDate = subDays(new Date(), params.lookbackDays);

  return format(
    `-- User Exposures Query
      WITH __userExposures AS (
        ${allExposureQueries
          .map((exposureQuery, i) => {
            const availableDimensions = exposureQuery.dimensions || [];
            const tableAlias = `t${i}`;

            const dimensionSelects = allDimensionNames.map((dim) => {
              if (availableDimensions.includes(dim)) {
                return `${dialect.castToString(`${tableAlias}.${dim}`)} AS ${dim}`;
              } else {
                return `${dialect.castToString("null")} AS ${dim}`;
              }
            });

            const dimensionSelectString = dimensionSelects.join(", ");

            return `
              SELECT timestamp, experiment_id, variation_id, ${dimensionSelectString} FROM (
                ${compileSqlTemplate(
                  exposureQuery.query,
                  {
                    startDate: startDate,
                  },
                  dialect,
                )}
              ) ${tableAlias}
              WHERE ${dialect.castToString(exposureQuery.userIdType)} = '${params.unitId}' AND timestamp >= ${dialect.toTimestamp(startDate)}
            `;
          })
          .join("\nUNION ALL\n")}
      )
      SELECT * FROM __userExposures 
      ORDER BY timestamp DESC 
      LIMIT ${SQL_ROW_LIMIT}
      `,
    dialect.formatDialect,
  );
}
