/**
 * One row per exposed unit carrying every source's per-user metric columns.
 *
 * Only emitted for funnels spanning several fact tables: steps can only be
 * windowed against each other once every candidate timestamp sits on one row.
 * The rest of the metric columns ride along so the statistics CTE joins no
 * source a second time.
 *
 * Every per-user aggregate is built off `__distinctUsers`, so these joins are
 * 1:1 — `COUNT(*) AS users` downstream depends on that holding.
 */
export function getFlattenedUnitMetricsCTE({
  tableName,
  perUserAggTableName,
  sourceColumns,
  baseIdType,
}: {
  tableName: string;
  /** Per-source per-user aggregate; source i is suffixed with `i` (0 is bare). */
  perUserAggTableName: string;
  /**
   * Sources above 0 to join, with the output columns to take from each, in
   * source order. Source 0 drives the join and arrives via `m.*`.
   */
  sourceColumns: { index: number; columns: string[] }[];
  baseIdType: string;
}): string {
  const sourceAlias = (index: number) => `m${index}`;

  return `
      , ${tableName} AS (
        SELECT
          m.*
          ${sourceColumns
            .flatMap(({ index, columns }) =>
              columns.map((col) => `, ${sourceAlias(index)}.${col} AS ${col}`),
            )
            .join("\n          ")}
        FROM ${perUserAggTableName} m
        ${sourceColumns
          .map(
            ({
              index,
            }) => `LEFT JOIN ${perUserAggTableName}${index} ${sourceAlias(
              index,
            )} ON (
          ${sourceAlias(index)}.${baseIdType} = m.${baseIdType}
        )`,
          )
          .join("\n        ")}
      )`;
}
