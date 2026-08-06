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
 * Build the chained `COALESCE(stepN_resolved_ts, stepN-1_resolved_ts, ...)`
 * expression used as the "previous resolved timestamp" for step `index`.
 * Walks backward from `index - 1` and stops at the first required step: an
 * optional step the unit skipped resolves to NULL, so chaining COALESCE through
 * it anchors the next step's window on the most recent step actually completed.
 *
 * `resolvedTsColumn` maps a step index to that step's resolved-timestamp column
 * name, which differs between the two callers.
 */
export function buildPrevResolvedExpr({
  steps,
  index,
  resolvedTsColumn,
  alias = "",
}: {
  steps: { optional: boolean }[];
  index: number;
  resolvedTsColumn: (stepIndex: number) => string;
  alias?: string;
}): string {
  const prefix = alias ? `${alias}.` : "";
  const parts: string[] = [];
  for (let i = index - 1; i >= 0; i--) {
    parts.push(`${prefix}${resolvedTsColumn(i)}`);
    if (!steps[i].optional) break;
  }
  if (parts.length === 1) return parts[0];
  return `COALESCE(${parts.join(", ")})`;
}
