import type { ColumnRef } from "shared/types/fact-table";

export function getKllEventCountSourceColumn({
  column,
  quantileEventCountColumn,
}: {
  column: ColumnRef;
  quantileEventCountColumn?: string | null;
}): string {
  return quantileEventCountColumn?.trim() || `${column.column}_n_events`;
}
