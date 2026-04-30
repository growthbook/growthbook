import { SegmentInterface } from "shared/types/segment";
import type { PopulationDataQuerySettings } from "shared/types/query";
import type { SqlDialect } from "shared/types/sql";
import { FactTableMap } from "back-end/src/models/FactTableModel";

import { getPowerPopulationSourceCTE } from "back-end/src/integrations/sql/ctes/power-population-source-cte";

export function getPowerPopulationCTEs(
  dialect: SqlDialect,
  {
    settings,
    factTableMap,
    segment,
  }: {
    settings: PopulationDataQuerySettings;
    factTableMap: FactTableMap;
    segment: SegmentInterface | null;
  },
): string {
  const timestampColumn =
    settings.sourceType === "segment" ? "date" : "timestamp";
  // BQ datetime cast for SELECT statements (do not use for where)
  const timestampDateTimeColumn = dialect.castUserDateCol(timestampColumn);

  const firstQuery = getPowerPopulationSourceCTE(dialect, {
    settings,
    factTableMap,
    segment,
  });

  return `
      ${firstQuery}
      , __experimentUnits AS (
        SELECT
          ${settings.userIdType}
          , MIN(${timestampDateTimeColumn}) AS first_exposure_timestamp
          , ${dialect.castToString("''")} as variation
        FROM
          __source
        WHERE
            ${timestampColumn} >= ${dialect.toTimestamp(settings.startDate)}
            AND ${timestampColumn} <= ${dialect.toTimestamp(settings.endDate)}
        GROUP BY ${settings.userIdType}
      ),`;
}
