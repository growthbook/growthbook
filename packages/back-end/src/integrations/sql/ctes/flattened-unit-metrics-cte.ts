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
  baseColumns,
  sourceColumns,
  baseIdType,
}: {
  tableName: string;
  /** Per-source per-user aggregate; source i is suffixed with `i` (0 is bare). */
  perUserAggTableName: string;
  /**
   * Source 0's columns, which drive the join. Named one by one when given:
   * past one join, ClickHouse keeps the columns of `m.*` qualified
   * (`m.variation`), so later CTEs can't read them by bare name. Without
   * them, source 0 arrives via `m.*`.
   */
  baseColumns?: string[];
  /**
   * Sources above 0 to join, with the output columns to take from each, in
   * source order.
   */
  sourceColumns: { index: number; columns: string[] }[];
  baseIdType: string;
}): string {
  const sourceAlias = (index: number) => `m${index}`;
  const baseSelect = baseColumns
    ? baseColumns.map((col) => `m.${col} AS ${col}`).join("\n          , ")
    : "m.*";

  return `
      , ${tableName} AS (
        SELECT
          ${baseSelect}
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
