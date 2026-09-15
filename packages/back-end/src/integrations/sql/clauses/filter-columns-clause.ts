export function getFilterColumnsClause(filterColumns: string[]): string {
  let filterClause = "";
  if (!filterColumns.length) return filterClause;

  filterColumns.forEach((column) => (filterClause += `, ${column}`));

  return filterClause;
}
