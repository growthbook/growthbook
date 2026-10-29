/**
 * This returns a boolean condition (for a WHERE clause) that keeps only rows
 * whose cluster has a single distinct assignment.
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
    )`;
}

export const MULTIPLE_CLUSTER_SENTINEL = "__multiple__";

export function getSingleClusterPerUnitCondition({
  clusterIdColumn,
}: {
  clusterIdColumn: string;
}): string {
  return `${clusterIdColumn} <> '${MULTIPLE_CLUSTER_SENTINEL}'`;
}
