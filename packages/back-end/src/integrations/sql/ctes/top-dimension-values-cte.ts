import { NULL_DIMENSION_VALUE } from "shared/constants";

// The most common values of `column` in a one-row-per-unit `source`, flagged by is_top
// so unmatched LEFT JOINs are detectable on ClickHouse, which fills them with defaults
export function getTopDimensionValuesCTE({
  source,
  column,
  limit,
}: {
  source: string;
  column: string;
  limit: number;
}): string {
  return `
    SELECT
      dimension_value
      , 1 AS is_top
    FROM (
      SELECT
        dimension_value
        , ROW_NUMBER() OVER (ORDER BY units DESC, dimension_value) AS rn
      FROM (
        SELECT
          ${column} AS dimension_value
          , COUNT(*) AS units
        FROM
          ${source}
        WHERE
          ${column} != '${NULL_DIMENSION_VALUE}'
        GROUP BY
          ${column}
      ) __dimensionUnits
    ) __rankedDimensionValues
    WHERE
      rn <= ${limit}`;
}
