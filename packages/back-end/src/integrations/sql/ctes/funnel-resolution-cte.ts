import {
  buildPrevResolvedExpr,
  conversionWindowToSeconds,
} from "shared/funnels";
import type { SqlDialect } from "shared/types/sql";
import type { FunnelFactMetricInterface } from "shared/types/fact-table";

import type { AggColumn } from "back-end/src/integrations/sql/columns/agg-column";
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

export interface FunnelMetricSteps extends FunnelMetricForResolution {
  /** Steps this fact table hosts. Other steps come from other sources. */
  stepIndices: number[];
}

/** Step 0 needs array + resolve CTE when its conversion window is relative to exposure. */
export function funnelStep0NeedsExposureWindow(
  metric: FunnelFactMetricInterface,
): boolean {
  return !!metric.funnelSettings.steps[0]?.conversionWindow;
}

/**
 * Per-user aggregate columns for the funnel steps a single fact table hosts.
 *
 * Step 0 without a conversion window is anchored directly: its resolved
 * timestamp is the earliest matching event. Step 0 with a conversion window,
 * and every later step, are resolved against a window (exposure for step 0,
 * predecessor for the rest), which needs the full sorted list of candidate
 * timestamps — so those are materialized as arrays here. One GROUP BY pass
 * over the events regardless of step count.
 */
export function getFunnelUserMetricAggColumns(
  dialect: SqlDialect,
  funnelMetrics: FunnelMetricSteps[],
): AggColumn[] {
  return funnelMetrics.flatMap(({ metric, alias, stepIndices }) =>
    stepIndices.map((stepIndex) => {
      const ts = `umj.${funnelStepTimestampColumn(alias, stepIndex)}`;
      // All arrays share one ORDER BY expression (the raw event timestamp
      // projected by __userMetricJoin): each step column equals it whenever
      // non-null, and Redshift requires identical WITHIN GROUP orderings
      // across every aggregate in a SELECT.
      const useArray = stepIndex > 0 || funnelStep0NeedsExposureWindow(metric);
      return useArray
        ? {
            name: funnelStepArrayColumn(alias, stepIndex),
            expr: dialect.arrayAggSorted(ts, "umj.event_timestamp"),
          }
        : {
            name: funnelStepResolvedTsColumn(alias, 0),
            expr: `MIN(${ts})`,
          };
    }),
  );
}

/**
 * Chained resolution CTEs plus the terminal CTE that turns each step into a
 * per-user 0/1 column.
 *
 * Every CTE in the chain selects `r.*`, so the terminal table is the source
 * table plus the funnel columns — including metric values that have nothing to
 * do with funnels. It is named for what it hands back, not for the funnel work
 * done along the way. The terminal projects an explicit list so the candidate
 * arrays (on Redshift, LISTAGG varchars of up to 64KB per user) die here
 * instead of flowing into the statistics scan.
 *
 * Each `__funnelResolve` CTE resolves exactly one step: the earliest candidate
 * timestamp falling inside `[prev - concurrencyWindow, prev + conversionWindow]`,
 * where `prev` is the nearest prior required step — or exposure for step 0 /
 * when every prior step is optional. Optional steps still resolve for their
 * own 0/1, but never anchor later steps.
 *
 * Two deliberate differences from product-analytics funnels: there is no
 * `WHERE step_0_resolved_ts IS NOT NULL` filter, because we need to pass forward
 * all user's data; and no time-from-previous-step columns are emitted yet.
 */
export function getFunnelResolutionCTEs(
  dialect: SqlDialect,
  {
    funnelMetrics,
    sourceTableName,
    terminalTableName,
    resolveTablePrefix,
    exposureColumn,
    sourcePassthroughColumns,
  }: {
    funnelMetrics: FunnelMetricForResolution[];
    sourceTableName: string;
    terminalTableName: string;
    resolveTablePrefix: string;
    /** Per-user exposure timestamp column on the source table (e.g. `timestamp`). */
    exposureColumn: string;
    /**
     * Source-table columns the terminal CTE carries through; excludes the
     * funnel working columns, whose resolved timestamps are re-projected
     * per step.
     */
    sourcePassthroughColumns: string[];
  },
): string {
  const ctes: string[] = [];
  let prevTableName = sourceTableName;

  const maxSteps = Math.max(
    ...funnelMetrics.map(({ metric }) => metric.funnelSettings.steps.length),
  );

  const anyStep0Window = funnelMetrics.some(({ metric }) =>
    funnelStep0NeedsExposureWindow(metric),
  );
  const startIndex = anyStep0Window ? 0 : 1;

  for (let stepIndex = startIndex; stepIndex < maxSteps; stepIndex++) {
    const resolutionCols: string[] = [];

    funnelMetrics.forEach(({ metric, alias }) => {
      const { steps, concurrencyWindowSeconds = 0 } = metric.funnelSettings;
      if (stepIndex >= steps.length) return;

      // Step 0 without a conversion window was already resolved via MIN in
      // the aggregate; only re-resolve it when the window is exposure-relative.
      if (stepIndex === 0 && !funnelStep0NeedsExposureWindow(metric)) return;

      const step = steps[stepIndex];
      const prevExpr =
        stepIndex === 0
          ? `r.${exposureColumn}`
          : buildPrevResolvedExpr({
              steps,
              index: stepIndex,
              resolvedTsColumn: (i) => funnelStepResolvedTsColumn(alias, i),
              alias: "r",
              exposureColumn,
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

    if (resolutionCols.length === 0) continue;

    const name = `${resolveTablePrefix}${stepIndex}`;
    // `r.*` rather than an explicit column list: each CTE in the chain only
    // ever adds names, never shadows them, so later steps can reference the
    // resolved timestamps of every earlier one.
    ctes.push(`
      , ${name} AS (
        SELECT
          r.*
          ${resolutionCols.join("\n          ")}
        FROM ${prevTableName} r
      )`);

    prevTableName = name;
  }

  const resolvedTsCols = funnelMetrics.flatMap(({ metric, alias }) =>
    metric.funnelSettings.steps.map(
      (_step, stepIndex) => `r.${funnelStepResolvedTsColumn(alias, stepIndex)}`,
    ),
  );
  const valueCols = funnelMetrics.flatMap(({ metric, alias }) =>
    metric.funnelSettings.steps.map(
      (_step, stepIndex) =>
        `CASE WHEN r.${funnelStepResolvedTsColumn(alias, stepIndex)} IS NOT NULL THEN 1 ELSE 0 END AS ${funnelStepValueColumn(alias, stepIndex)}`,
    ),
  );

  ctes.push(`
      , ${terminalTableName} AS (
        SELECT
          ${[
            ...sourcePassthroughColumns.map((col) => `r.${col}`),
            ...resolvedTsCols,
            ...valueCols,
          ].join("\n          , ")}
        FROM ${prevTableName} r
      )`);

  return ctes.join("\n");
}
