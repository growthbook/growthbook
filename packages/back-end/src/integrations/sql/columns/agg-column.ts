/**
 * An output column of a per-user aggregate CTE, kept as a name/expression pair
 * rather than rendered SQL so downstream CTEs can project the column by name
 * without restating the expression.
 */
export type AggColumn = {
  name: string;
  expr: string;
};

/** Renders columns for a SELECT list that already has a leading column. */
export function renderAggColumns(columns: AggColumn[]): string {
  return columns.map(({ name, expr }) => `, ${expr} AS ${name}`).join("\n");
}
