import type { ExperimentFactMetricsQueryResponseRows } from "shared/types/integrations";

/**
 * Replace the query-wide unit counts with the ones in `usersColumn`.
 *
 * Metrics that only analyze units with complete data share a count of those
 * units (see `getMetricUsersColumn`). gbstats reads one `users` / `count` per
 * row, so those metrics are handed over as a separate result built from these
 * rows.
 */
export function withMetricSlotUsers(
  rows: ExperimentFactMetricsQueryResponseRows,
  usersColumn: string,
): ExperimentFactMetricsQueryResponseRows {
  return rows.map((row) => {
    const users = row[usersColumn];
    return typeof users === "number" ? { ...row, users, count: users } : row;
  });
}
