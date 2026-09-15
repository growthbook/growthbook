import { funnelStepMetricId } from "shared/experiments";
import type { FunnelFactMetricInterface } from "shared/types/fact-table";
import type { ExperimentFactMetricsQueryResponseRows } from "shared/types/integrations";
import type { QueryResultsForStatsEngine } from "shared/types/stats";

import { funnelStepSumColumn } from "back-end/src/integrations/sql/fact-metrics/funnel-columns";

const METRIC_SLOT_COLUMN_RE = /^m\d+_/;

/**
 * Turn a funnel metric's multi-column block into a standalone stats-engine
 * result of per-step binomial metrics.
 *
 * The funnel's slot in the original query holds `{slotAlias}_step_{k}_sum` for
 * every step instead of a `main_sum`. gbstats has no notion of a funnel, so
 * each step becomes an ordinary proportion metric `{metricId}?step={k}` in slot
 * `m{k}` of a fresh result, and a final slot carries the bare `{metricId}` as a
 * parent binomial for whole-funnel completion (units reaching the last step).
 * Emitting a separate result rather than expanding in place avoids renumbering
 * the slots of the other metrics sharing the query.
 *
 * A unit that never entered the funnel has no row-level value, hence the
 * `?? 0`: the denominator is every exposed unit, not just funnel enterers.
 */
export function splitFunnelMetricBlock({
  metric,
  slotAlias,
  rows,
  sql,
}: {
  metric: FunnelFactMetricInterface;
  slotAlias: string;
  rows: ExperimentFactMetricsQueryResponseRows;
  sql?: string;
}): QueryResultsForStatsEngine {
  const steps = metric.funnelSettings.steps;

  return {
    metrics: [
      ...steps.map((_step, stepIndex) =>
        funnelStepMetricId(metric.id, stepIndex),
      ),
      metric.id,
    ],
    rows: rows.map((row) => {
      // Carry variation, users, count, and every dimension / bandit attribute
      // column through untouched; drop all other metrics' slot columns.
      const carried = Object.fromEntries(
        Object.entries(row).filter(([key]) => !METRIC_SLOT_COLUMN_RE.test(key)),
      );

      return {
        ...carried,
        [`m${steps.length}_id`]: metric.id,
        [`m${steps.length}_main_sum`]:
          row[funnelStepSumColumn(slotAlias, steps.length - 1)] ?? 0,
        ...Object.fromEntries(
          steps.flatMap((_step, stepIndex) => [
            [`m${stepIndex}_id`, funnelStepMetricId(metric.id, stepIndex)],
            [
              `m${stepIndex}_main_sum`,
              row[funnelStepSumColumn(slotAlias, stepIndex)] ?? 0,
            ],
          ]),
        ),
      };
    }) as ExperimentFactMetricsQueryResponseRows,
    sql,
  };
}
