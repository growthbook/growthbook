import {
  buildPrevResolvedExpr,
  conversionWindowToSeconds,
} from "shared/funnels";
import type { SqlDialect } from "shared/types/sql";
import type { FunnelFactMetricInterface } from "shared/types/fact-table";

import {
  funnelStepArrayColumn,
  funnelStepResolvedTsColumn,
  funnelStepTimestampColumn,
  funnelStepValueColumn,
} from "back-end/src/integrations/sql/fact-metrics/funnel-columns";

export interface FunnelMetricForResolution {
  metric: FunnelFactMetricInterface;
  /** The metric's slot alias (`m0`, `m1`, ...). */
  alias: string;
}

/**
 * Per-user aggregate columns a funnel needs out of `__userMetricAgg`.
 *
 * Step 0 is anchored directly: its resolved timestamp is simply the earliest
 * matching event. Every later step is resolved against a window relative to its
 * predecessor, which needs the full sorted list of candidate timestamps, so
 * those are materialized as arrays here — one GROUP BY pass over the events
 * regardless of step count.
 */
export function getFunnelUserMetricAggColumns(
  dialect: SqlDialect,
  funnelMetrics: FunnelMetricForResolution[],
): string {
  return funnelMetrics
    .flatMap(({ metric, alias }) =>
      metric.funnelSettings.steps.map((_step, stepIndex) => {
        const ts = `umj.${funnelStepTimestampColumn(alias, stepIndex)}`;
        return stepIndex === 0
          ? `, MIN(${ts}) AS ${funnelStepResolvedTsColumn(alias, 0)}`
          : `, ${dialect.arrayAggSorted(ts)} AS ${funnelStepArrayColumn(alias, stepIndex)}`;
      }),
    )
    .join("\n");
}

/**
 * Chained resolution CTEs plus the terminal CTE that turns each step into a
 * per-user 0/1 column.
 *
 * Each `__funnelResolve` CTE resolves exactly one step: the earliest candidate
 * timestamp falling inside `[prev - concurrencyWindow, prev + conversionWindow]`,
 * where `prev` is the most recent step the unit actually completed. Steps are
 * resolved in order because step k's window depends on step k-1's result.
 *
 * Two deliberate differences from product-analytics funnels: there is no
 * `WHERE step_0_resolved_ts IS NOT NULL` filter, because the experiment
 * denominator is every exposed unit and non-enterers must count as 0; and no
 * time-from-previous-step columns are emitted.
 */
export function getFunnelResolutionCTEs(
  dialect: SqlDialect,
  {
    funnelMetrics,
    sourceTableName,
    terminalTableName,
    resolveTablePrefix,
  }: {
    funnelMetrics: FunnelMetricForResolution[];
    sourceTableName: string;
    terminalTableName: string;
    resolveTablePrefix: string;
  },
): string {
  const ctes: string[] = [];
  let prevTableName = sourceTableName;

  const maxSteps = Math.max(
    ...funnelMetrics.map(({ metric }) => metric.funnelSettings.steps.length),
  );

  for (let stepIndex = 1; stepIndex < maxSteps; stepIndex++) {
    const resolutionCols: string[] = [];

    funnelMetrics.forEach(({ metric, alias }) => {
      const { steps, concurrencyWindowSeconds = 0 } = metric.funnelSettings;
      if (stepIndex >= steps.length) return;

      const step = steps[stepIndex];
      const prevExpr = buildPrevResolvedExpr({
        steps,
        index: stepIndex,
        resolvedTsColumn: (i) => funnelStepResolvedTsColumn(alias, i),
        alias: "r",
      });

      const lowerBound =
        concurrencyWindowSeconds > 0
          ? dialect.addIntervalSeconds(prevExpr, "-", concurrencyWindowSeconds)
          : prevExpr;
      const upperBound = step.conversionWindow
        ? dialect.addIntervalSeconds(
            prevExpr,
            "+",
            conversionWindowToSeconds(step.conversionWindow),
          )
        : null;

      resolutionCols.push(
        `, ${dialect.arrayMinInRange(
          `r.${funnelStepArrayColumn(alias, stepIndex)}`,
          lowerBound,
          upperBound,
        )} AS ${funnelStepResolvedTsColumn(alias, stepIndex)}`,
      );
    });

    const name = `${resolveTablePrefix}${stepIndex}`;
    // `r.*` rather than an explicit column list: this chain sits in the middle
    // of a query whose other metrics have their own per-user columns, and each
    // CTE only ever adds names, never shadows them.
    ctes.push(`
      , ${name} AS (
        SELECT
          r.*
          ${resolutionCols.join("\n          ")}
        FROM ${prevTableName} r
      )`);

    prevTableName = name;
  }

  const valueCols = funnelMetrics.flatMap(({ metric, alias }) =>
    metric.funnelSettings.steps.map(
      (_step, stepIndex) =>
        `, CASE WHEN r.${funnelStepResolvedTsColumn(alias, stepIndex)} IS NOT NULL THEN 1 ELSE 0 END AS ${funnelStepValueColumn(alias, stepIndex)}`,
    ),
  );

  ctes.push(`
      , ${terminalTableName} AS (
        SELECT
          r.*
          ${valueCols.join("\n          ")}
        FROM ${prevTableName} r
      )`);

  return ctes.join("\n");
}
