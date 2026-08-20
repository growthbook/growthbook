/**
 * One row per exposed unit carrying every source's per-user metric columns.
 *
 * Only emitted for funnel queries that span several fact tables. A funnel's
 * steps can live on different tables and can only be windowed against each
 * other once every candidate timestamp sits on one row, so those sources have
 * to be joined before resolution runs. Flattening the rest of the metric
 * columns at the same time (ratio numerators and denominators, covariates,
 * quantile sketches) means the statistics CTE reads everything off the table
 * resolution hands back and joins no source a second time.
 *
 * Source 0 drives the join and supplies the shared unit columns (variation,
 * dimensions, bandit period, id, exposure timestamp) via `m.*`. Every source's
 * per-user aggregate is built off `__distinctUsers`, so each holds exactly one
 * row per exposed unit and these joins are 1:1 — `COUNT(*) AS users` in the
 * statistics CTE reads its sample size through this table and would be wrong
 * if that stopped holding.
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
  /** Output columns to take from each source above 0, in source order. */
  sourceColumns: { index: number; columns: string[] }[];
  baseIdType: string;
}): string {
  const sourceAlias = (index: number) => `m${index}`;

  const joinedSources = sourceColumns.filter(({ index }) => index !== 0);

  return `
      , ${tableName} AS (
        SELECT
          m.*
          ${joinedSources
            .flatMap(({ index, columns }) =>
              columns.map((col) => `, ${sourceAlias(index)}.${col} AS ${col}`),
            )
            .join("\n          ")}
        FROM ${perUserAggTableName} m
        ${joinedSources
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
