import type { ExperimentFactMetricsQueryResponseRows } from "shared/types/integrations";

import { METRIC_USERS_COL } from "back-end/src/services/experimentQueries/constants";

/**
 * Replace the query-wide unit counts with the ones a metric slot analyzed.
 *
 * A metric that only analyzes units with complete data carries its own
 * `{slotAlias}_users`. gbstats reads one `users` / `count` per row, so those
 * metrics are handed over as a separate result built from these rows.
 */
export function withMetricSlotUsers(
  rows: ExperimentFactMetricsQueryResponseRows,
  slotAlias: string,
): ExperimentFactMetricsQueryResponseRows {
  return rows.map((row) => {
    const users = row[`${slotAlias}_${METRIC_USERS_COL}`];
    return typeof users === "number" ? { ...row, users, count: users } : row;
  });
}
