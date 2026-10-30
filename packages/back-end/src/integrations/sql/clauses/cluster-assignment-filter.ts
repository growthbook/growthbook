export const MULTIPLE_VARIATION_SENTINEL = "__multiple__";

/**
 * This returns a boolean condition (for a WHERE clause) that keeps only rows
 * whose cluster has a single, real distinct assignment.
 */
export function getConsistentClusterCondition({
  sourceTable,
  clusterIdColumn,
  variationColumn = "variation",
}: {
  sourceTable: string;
  clusterIdColumn: string;
  variationColumn?: string;
}): string {
  return `${clusterIdColumn} IN (
      SELECT ${clusterIdColumn}
      FROM ${sourceTable}
      GROUP BY ${clusterIdColumn}
      HAVING MIN(${variationColumn}) = MAX(${variationColumn})
        AND MAX(${variationColumn}) <> '${MULTIPLE_VARIATION_SENTINEL}'
    )`;
}

export const MULTIPLE_CLUSTER_SENTINEL = "__multiple__";

export function getSingleClusterPerUnitCondition({
  clusterIdColumn,
  tableAlias,
}: {
  clusterIdColumn: string;
  tableAlias?: string;
}): string {
  const column = tableAlias
    ? `${tableAlias}.${clusterIdColumn}`
    : clusterIdColumn;
  return `${column} <> '${MULTIPLE_CLUSTER_SENTINEL}'`;
}
