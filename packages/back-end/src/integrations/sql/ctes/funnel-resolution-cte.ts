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

export interface FunnelMetricSteps extends FunnelMetricForResolution {
  /** Steps this fact table hosts. Other steps come from other sources. */
  stepIndices: number[];
}

export interface FunnelMetricWithSources extends FunnelMetricForResolution {
  /** Source index per step, in step order. */
  stepSourceIndices: number[];
}

/** Step 0 needs array + resolve CTE when its conversion window is relative to exposure. */
export function funnelStep0NeedsExposureWindow(
  metric: FunnelFactMetricInterface,
): boolean {
  return !!metric.funnelSettings.steps[0]?.conversionWindow;
}

/**
 * Per-unit column carrying step k's candidate timestamps into resolution.
 *
 * Step 0 without a conversion window is anchored directly, so its per-unit
 * aggregate is already the resolved timestamp. Every other step is resolved
 * against a window, which needs the full sorted candidate list.
 */
function funnelStepUnitColumn(
  metric: FunnelFactMetricInterface,
  alias: string,
  stepIndex: number,
): string {
  return stepIndex > 0 || funnelStep0NeedsExposureWindow(metric)
    ? funnelStepArrayColumn(alias, stepIndex)
    : funnelStepResolvedTsColumn(alias, 0);
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
): string {
  return funnelMetrics
    .flatMap(({ metric, alias, stepIndices }) =>
      stepIndices.map((stepIndex) => {
        const ts = `umj.${funnelStepTimestampColumn(alias, stepIndex)}`;
        // All arrays share one ORDER BY expression (the raw event timestamp
        // projected by __userMetricJoin): each step column equals it whenever
        // non-null, and Redshift requires identical WITHIN GROUP orderings
        // across every aggregate in a SELECT.
        const useArray =
          stepIndex > 0 || funnelStep0NeedsExposureWindow(metric);
        return useArray
          ? `, ${dialect.arrayAggSorted(ts, "umj.event_timestamp")} AS ${funnelStepArrayColumn(alias, stepIndex)}`
          : `, MIN(${ts}) AS ${funnelStepResolvedTsColumn(alias, 0)}`;
      }),
    )
    .join("\n");
}

/**
 * One row per unit with every step's candidates, gathered from each fact table
 * that hosts a step so resolution can run once over the whole funnel.
 *
 * Source 0 drives the join: it holds a row for every exposed unit (its
 * per-user aggregate is built off `__distinctUsers`), and carries the exposure
 * timestamp that exposure-relative windows anchor on.
 */
export function getFunnelUsersCTE({
  funnelMetrics,
  tableName,
  perUserAggTableName,
  baseIdType,
  exposureColumn,
}: {
  funnelMetrics: FunnelMetricWithSources[];
  tableName: string;
  /** Per-source per-user aggregate; source i is suffixed with `i` (0 is bare). */
  perUserAggTableName: string;
  baseIdType: string;
  exposureColumn: string;
}): string {
  const sourceAlias = (index: number) => `m${index === 0 ? "" : index}`;

  const joinIndices = Array.from(
    new Set(funnelMetrics.flatMap((f) => f.stepSourceIndices)),
  )
    .filter((index) => index !== 0)
    .sort((a, b) => a - b);

  const stepCols = funnelMetrics.flatMap(
    ({ metric, alias, stepSourceIndices }) =>
      metric.funnelSettings.steps.map((_step, stepIndex) => {
        const col = funnelStepUnitColumn(metric, alias, stepIndex);
        return `, ${sourceAlias(stepSourceIndices[stepIndex])}.${col} AS ${col}`;
      }),
  );

  return `
      , ${tableName} AS (
        SELECT
          m.${baseIdType} AS ${baseIdType}
          , m.${exposureColumn} AS ${exposureColumn}
          ${stepCols.join("\n          ")}
        FROM ${perUserAggTableName} m
        ${joinIndices
          .map(
            (index) => `LEFT JOIN ${perUserAggTableName}${index} ${sourceAlias(
              index,
            )} ON (
          ${sourceAlias(index)}.${baseIdType} = m.${baseIdType}
        )`,
          )
          .join("\n        ")}
      )`;
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
