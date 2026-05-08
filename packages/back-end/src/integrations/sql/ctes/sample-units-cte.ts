import { SqlDialect } from "shared/types/sql";

export function getSampleUnitsCTE(dialect: SqlDialect): string {
  return `__experimentUnits AS (
    SELECT 'user_1' AS user_id, 'A' AS variation, cast(${dialect.getCurrentTimestamp()} as timestamp) AS first_exposure_timestamp
    UNION ALL
    SELECT 'user_2' AS user_id, 'B' AS variation, cast(${dialect.getCurrentTimestamp()} as timestamp) AS first_exposure_timestamp
  )`;
}
