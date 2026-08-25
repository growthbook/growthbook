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
 * Aggregate expression that resolves step 0 to a single timestamp.
 *
 * Step 0 anchors on exposure, which is known per-row at aggregation time, so it
 * is resolved to a scalar here rather than deferring an array to the read
 * resolver. With no conversion window it's the earliest matching event
 * (`MIN`); with an exposure-relative window it's the earliest event inside
 * `[exposure - concurrency, exposure + window]`, i.e. `MIN` over the in-window
 * candidates — exactly what `arrayMinInRange` would have computed downstream.
 *
 * `tsExpr` is the per-row step-0 timestamp (already overall-window filtered);
 * `exposureExpr` is the per-row exposure timestamp. Both forms are `MIN`, so the
 * same expression works for the inline per-user aggregate and the incremental
 * per-user·day partial (re-merged with `MIN` across days).
 */
export function funnelStep0ResolvedExpr(
  dialect: SqlDialect,
  metric: FunnelFactMetricInterface,
  tsExpr: string,
  exposureExpr: string,
): string {
  const step = metric.funnelSettings.steps[0];
  if (!step?.conversionWindow) {
    return `MIN(${tsExpr})`;
  }
  const { concurrencyWindowSeconds = 0 } = metric.funnelSettings;
  const lower =
    concurrencyWindowSeconds > 0
      ? dialect.addIntervalSeconds(exposureExpr, "-", concurrencyWindowSeconds)
      : exposureExpr;
  const upper = dialect.addIntervalSeconds(
    exposureExpr,
    "+",
    conversionWindowToSeconds(step.conversionWindow),
  );
  return `MIN(CASE WHEN ${tsExpr} >= ${lower} AND ${tsExpr} <= ${upper} THEN ${tsExpr} END)`;
}

/**
 * Per-user aggregate columns a funnel needs out of `__userMetricAgg`.
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
  funnelMetrics: FunnelMetricForResolution[],
): string {
  return funnelMetrics
    .flatMap(({ metric, alias }) =>
      metric.funnelSettings.steps.map((_step, stepIndex) => {
        const ts = `umj.${funnelStepTimestampColumn(alias, stepIndex)}`;
        // Step 0 anchors on exposure (available per-row here as umj.timestamp),
        // so resolve it to a scalar now — windowed or not — instead of emitting
        // an array to resolve downstream.
        if (stepIndex === 0) {
          return `, ${funnelStep0ResolvedExpr(dialect, metric, ts, "umj.timestamp")} AS ${funnelStepResolvedTsColumn(alias, 0)}`;
        }
        // Later steps anchor on a prior resolved step (only known after merging
        // days), so they must stay candidate arrays. All arrays share one ORDER
        // BY expression (the raw event timestamp) — Redshift requires identical
        // WITHIN GROUP orderings across every aggregate in a SELECT.
        return `, ${dialect.arrayAggSorted(ts, "umj.event_timestamp")} AS ${funnelStepArrayColumn(alias, stepIndex)}`;
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
  }: {
    funnelMetrics: FunnelMetricForResolution[];
    sourceTableName: string;
    terminalTableName: string;
    resolveTablePrefix: string;
    /** Per-user exposure timestamp column on the source table (e.g. `timestamp`). */
    exposureColumn: string;
  },
): string {
  const ctes: string[] = [];
  let prevTableName = sourceTableName;

  const maxSteps = Math.max(
    ...funnelMetrics.map(({ metric }) => metric.funnelSettings.steps.length),
  );

  // Step 0 is always pre-resolved to a scalar (inline aggregate / incremental
  // write), so the resolver only chains steps 1+, each anchored on the nearest
  // prior required resolved step (or exposure when all priors are optional).
  const startIndex = 1;

  for (let stepIndex = startIndex; stepIndex < maxSteps; stepIndex++) {
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
