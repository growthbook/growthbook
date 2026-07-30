// Canonical names of the queries that compute metric statistics in the
// incremental pipeline. The builders and the classifier below both live here so
// they can't drift (same reason as getDropUnitsTableQueryName).
const STATISTICS_QUERY_PREFIX = "statistics_";

export function getIncrementalStatisticsQueryName(groupId: string): string {
  return `${STATISTICS_QUERY_PREFIX}${groupId}`;
}

export function getIncrementalCrossStatisticsQueryName(
  groupIdA: string,
  groupIdB: string,
): string {
  return `${STATISTICS_QUERY_PREFIX}cross_${groupIdA}__${groupIdB}`;
}
