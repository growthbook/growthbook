import { SqlDialect } from "shared/types/sql";

export function getUnitCountCTE(
  dialect: SqlDialect,
  dimensionColumn: string,
  whereClause?: string,
  ensureFloat?: boolean,
): string {
  return ` -- ${dimensionColumn}
    SELECT
      variation AS variation
      , ${dimensionColumn} AS dimension_value
      , MAX(${dialect.castToString(`'${dimensionColumn}'`)}) AS dimension_name
      , ${ensureFloat ? dialect.castToFloat("COUNT(*)") : "COUNT(*)"} AS units
    FROM
      __distinctUnits
    ${whereClause ?? ""}
    GROUP BY
      variation
      , ${dimensionColumn}`;
}
