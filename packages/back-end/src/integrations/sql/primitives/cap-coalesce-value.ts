import {
  getAggregateFilters,
  isCappableMetricType,
  getLowerCappingSettings,
  ExperimentMetricInterface,
} from "shared/experiments";
import { ColumnRef } from "shared/types/fact-table";
import { SqlDialect } from "shared/types/sql";
import { getCappingTailState } from "shared/validators";

export function capCoalesceValue(
  dialect: SqlDialect,
  {
    valueCol,
    metric,
    capTablePrefix = "c",
    lowerCapTablePrefix,
    capValueCol = "value_cap",
    lowerCapValueCol = "value_cap_lower",
    columnRef,
  }: {
    valueCol: string;
    metric: ExperimentMetricInterface;
    capTablePrefix?: string;
    /** When lower-tail uses a separate cap subquery/join alias (e.g. `cap_lower`). */
    lowerCapTablePrefix?: string;
    capValueCol?: string;
    lowerCapValueCol?: string;
    columnRef?: ColumnRef | null;
  },
): string {
  const cs = metric?.cappingSettings;
  // Lower tail is an independent settings object (own type + value), enabling
  // mixed configurations (e.g. percentile upper + absolute lower).
  const lowerCs = getLowerCappingSettings(metric);
  const tails = getCappingTailState(cs, lowerCs);
  const cappable = isCappableMetricType(metric);
  const upperThreshold = cs?.value;
  const lowerThreshold = lowerCs?.value;
  const hasUpperAbs = tails.upperAbsoluteCapped && cappable;
  const hasUpperPct = tails.upperPercentileCapped && cappable;
  const hasLowerAbs = tails.lowerAbsoluteCapped && cappable;
  const hasLowerPct = tails.lowerPercentileCapped && cappable;
  // Assumes cappable metrics do not have aggregate filters
  // which is true for now
  if (hasUpperAbs || hasUpperPct || hasLowerAbs || hasLowerPct) {
    let expression = dialect.castToFloat(`COALESCE(${valueCol}, 0)`);
    // Bound expressions (absolute threshold or percentile cap column).
    const upperBoundExpr = hasUpperAbs
      ? `${upperThreshold}`
      : hasUpperPct
        ? `${capTablePrefix}.${capValueCol}`
        : null;
    if (upperBoundExpr !== null) {
      expression = `LEAST(${expression}, ${upperBoundExpr})`;
    }
    const lowerPrefix = lowerCapTablePrefix ?? capTablePrefix;
    const lowerBoundExpr = hasLowerAbs
      ? `${lowerThreshold}`
      : hasLowerPct
        ? `${lowerPrefix}.${lowerCapValueCol}`
        : null;
    if (lowerBoundExpr !== null) {
      // With mixed types the lower bound can land above the upper bound (same-
      // type crossing is validated at save time). Clamp the lower bound to at
      // most the upper bound so GREATEST(...) can't collapse every row to the
      // floor; degrade to "capped at the upper bound" instead.
      const clampedLowerBound =
        upperBoundExpr !== null
          ? `LEAST(${lowerBoundExpr}, ${upperBoundExpr})`
          : lowerBoundExpr;
      expression = `GREATEST(${expression}, ${clampedLowerBound})`;
    }
    return expression;
  }

  const filters = getAggregateFilters({
    columnRef: columnRef || null,
    column: valueCol,
    ignoreInvalid: true,
  });
  if (filters.length) {
    valueCol = `(CASE WHEN ${filters.join(" AND ")} THEN 1 ELSE NULL END)`;
  }

  return `COALESCE(${valueCol}, 0)`;
}
