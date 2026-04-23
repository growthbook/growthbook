import { SqlHelpers } from "shared/types/sql";

export function getUnitCountCTE(
  helpers: SqlHelpers,
  dimensionColumn: string,
  whereClause?: string,
  ensureFloat?: boolean,
): string {
  return ` -- ${dimensionColumn}
    SELECT
      variation AS variation
      , ${dimensionColumn} AS dimension_value
      , MAX(${helpers.castToString(`'${dimensionColumn}'`)}) AS dimension_name
      , ${ensureFloat ? helpers.castToFloat("COUNT(*)") : "COUNT(*)"} AS units
    FROM
      __distinctUnits
    ${whereClause ?? ""}
    GROUP BY
      variation
      , ${dimensionColumn}`;
}
