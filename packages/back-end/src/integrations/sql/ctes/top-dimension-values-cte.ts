import type { SqlDialect } from "shared/types/sql";

// The most common non-null values of `column` in `source`, ranked by distinct units
export function getTopDimensionValuesCTE(
  dialect: SqlDialect,
  {
    source,
    column,
    unitColumn,
    where,
    limit,
  }: {
    source: string;
    column: string;
    unitColumn: string;
    where: string;
    limit: number;
  },
): string {
  const value = dialect.castToString(`e.${column}`);
  return `
    SELECT
      dimension_value
    FROM (
      SELECT
        dimension_value
        , ROW_NUMBER() OVER (ORDER BY units DESC, dimension_value) AS rn
      FROM (
        SELECT
          ${value} AS dimension_value
          , COUNT(DISTINCT e.${unitColumn}) AS units
        FROM
          ${source} e
        WHERE
          ${where}
          AND e.${column} IS NOT NULL
        GROUP BY
          ${value}
      ) __dimensionUnits
    ) __rankedDimensionValues
    WHERE
      rn <= ${limit}`;
}
