import { subDays } from "date-fns";
import { format, SQL_ROW_LIMIT } from "shared/sql";
import type { DataSourceInterface } from "shared/types/datasource";
import type { UserExperimentExposuresQueryParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import {
  getExposureQueryExperimentIdColumn,
  getExposureQueryIdentifierColumn,
  getExposureQueryIdentifierTypes,
  getExposureQueryTimestampColumn,
  getExposureQueryVariationIdColumn,
} from "shared/util";
import { compileSqlTemplate } from "back-end/src/util/sql";

export function getUserExperimentExposuresQuery(
  dialect: SqlDialect,
  datasource: DataSourceInterface,
  params: UserExperimentExposuresQueryParams,
): string {
  const { userIdType } = params;
  const allExposureQueries = (
    datasource.settings.queries?.exposure || []
  ).filter((query) =>
    getExposureQueryIdentifierTypes(query).includes(userIdType),
  );

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
            const tsCol = getExposureQueryTimestampColumn(exposureQuery);
            const expIdCol = getExposureQueryExperimentIdColumn(exposureQuery);
            const varIdCol = getExposureQueryVariationIdColumn(exposureQuery);
            const idCol = getExposureQueryIdentifierColumn(
              exposureQuery,
              userIdType,
            );

            const dimensionSelects = allDimensionNames.map((dim) => {
              if (availableDimensions.includes(dim)) {
                return `${dialect.castToString(`${tableAlias}.${dim}`)} AS ${dim}`;
              } else {
                return `${dialect.castToString("null")} AS ${dim}`;
              }
            });

            const dimensionSelectString = dimensionSelects.join(", ");

            return `
              SELECT ${tsCol} as timestamp, ${expIdCol} as experiment_id, ${varIdCol} as variation_id, ${dimensionSelectString} FROM (
                ${compileSqlTemplate(
                  exposureQuery.query,
                  {
                    startDate: startDate,
                  },
                  dialect,
                )}
              ) ${tableAlias}
              WHERE ${dialect.castToString(idCol)} = '${params.unitId}' AND ${tsCol} >= ${dialect.toTimestamp(startDate)}
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
