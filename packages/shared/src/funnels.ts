import { ConversionWindowUnit } from "shared/types/fact-table";

/**
 * Window/anchoring rules shared by the two funnel SQL builders: the
 * product-analytics funnel explorer (`enterprise/product-analytics/sql.ts`) and
 * the experiment funnel fact metric pipeline (back-end `funnel-resolution-cte`).
 * Both describe steps with their own shape, so these helpers take the minimum
 * they need rather than a concrete step type.
 */

const CONVERSION_WINDOW_UNIT_TO_SECONDS: Record<ConversionWindowUnit, number> =
  {
    minutes: 60,
    hours: 3600,
    days: 86400,
    weeks: 86400 * 7,
  };

export function conversionWindowToSeconds(window: {
  unit: ConversionWindowUnit;
  value: number;
}): number {
  return (
    Math.max(1, Math.round(window.value)) *
    CONVERSION_WINDOW_UNIT_TO_SECONDS[window.unit]
  );
}

/**
 * Build the "previous resolved timestamp" expression for step `index`.
 *
 * Optional steps do not anchor later steps: walk backward from `index - 1`,
 * skip every optional step, and use the nearest required step's resolved
 * timestamp. When every preceding step is optional, fall back to
 * `exposureColumn` (experiment funnel metrics) or step 0 (product analytics),
 * so an optional early step never blocks later conversions.
 *
 * `resolvedTsColumn` maps a step index to that step's resolved-timestamp column
 * name, which differs between the two callers.
 */
export function buildPrevResolvedExpr({
  steps,
  index,
  resolvedTsColumn,
  alias = "",
  exposureColumn,
}: {
  steps: { optional: boolean }[];
  index: number;
  resolvedTsColumn: (stepIndex: number) => string;
  alias?: string;
  /** Bare column name (e.g. `timestamp`); prefixed with `alias` when set. */
  exposureColumn?: string;
}): string {
  const prefix = alias ? `${alias}.` : "";
  for (let i = index - 1; i >= 0; i--) {
    if (!steps[i].optional) {
      return `${prefix}${resolvedTsColumn(i)}`;
    }
  }
  // No required step precedes this one. Experiment funnels anchor on exposure;
  // product-analytics funnels anchor on step 0, which their qualifying-users
  // filter already guarantees is non-null. Never emit a NULL bound, which
  // would silently drop every candidate event.
  return `${prefix}${exposureColumn ?? resolvedTsColumn(0)}`;
}
