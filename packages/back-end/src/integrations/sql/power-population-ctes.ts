import { SegmentInterface } from "shared/types/segment";
import type { PopulationDataQuerySettings } from "shared/types/query";
import type { SqlHelpers } from "shared/types/sql";
import { FactTableMap } from "back-end/src/models/FactTableModel";

import { getPowerPopulationSourceCTE } from "./power-population-source-cte";

export function getPowerPopulationCTEs(
  helpers: SqlHelpers,
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
  const timestampDateTimeColumn = helpers.castUserDateCol(timestampColumn);

  const firstQuery = getPowerPopulationSourceCTE(helpers, {
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
          , ${helpers.castToString("''")} as variation
        FROM
          __source
        WHERE
            ${timestampColumn} >= ${helpers.toTimestamp(settings.startDate)}
            AND ${timestampColumn} <= ${helpers.toTimestamp(settings.endDate)}
        GROUP BY ${settings.userIdType}
      ),`;
}
