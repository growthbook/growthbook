// Wraps an aggregation query shaped like (column_name, value, count) and
// returns the top `limit` values per column. Shared across all efficient
// unpivot implementations so each dialect only has to produce the unpivot+
// aggregation, not the ranking.
export function getTopNPerColumnQuery(aggQuery: string, limit: number): string {
  return `
    SELECT column_name, value, count FROM (
      SELECT column_name, value, count,
        ROW_NUMBER() OVER (PARTITION BY column_name ORDER BY count DESC) AS row_num
      FROM (
        ${aggQuery}
      ) __topValuesAgg
    ) __topValuesRanked
    WHERE row_num <= ${limit}`;
}
