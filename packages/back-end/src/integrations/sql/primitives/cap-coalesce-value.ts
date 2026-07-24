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
    const lowerPrefix = lowerCapTablePrefix ?? capTablePrefix;
    // Absolute caps are applied OUTERMOST (percentile inner, absolute outer).
    // When one tail is absolute and the other percentile and their thresholds
    // cross (only possible for mixed types; same-type pairs are validated at
    // save time), this ordering collapses every value to the absolute bound —
    // the user's explicit number wins over the data-dependent percentile.
    if (hasUpperPct) {
      expression = `LEAST(${expression}, ${capTablePrefix}.${capValueCol})`;
    }
    if (hasLowerPct) {
      expression = `GREATEST(${expression}, ${lowerPrefix}.${lowerCapValueCol})`;
    }
    if (hasUpperAbs) {
      expression = `LEAST(${expression}, ${upperThreshold})`;
    }
    if (hasLowerAbs) {
      expression = `GREATEST(${expression}, ${lowerThreshold})`;
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
