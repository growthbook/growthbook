import {
  getAggregateFilters,
  isCappableMetricType,
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
  const tails = getCappingTailState(cs);
  const cappable = isCappableMetricType(metric);
  const upperThreshold = cs?.value;
  const lowerThreshold = cs?.lowerValue;
  const hasUpperAbs = tails.upperAbsoluteCapped && cappable;
  const hasUpperPct = tails.upperPercentileCapped && cappable;
  const hasLowerAbs = tails.lowerAbsoluteCapped && cappable;
  const hasLowerPct = tails.lowerPercentileCapped && cappable;
  // Assumes cappable metrics do not have aggregate filters
  // which is true for now
  if (hasUpperAbs || hasUpperPct || hasLowerAbs || hasLowerPct) {
    let expression = dialect.castToFloat(`COALESCE(${valueCol}, 0)`);
    if (hasUpperAbs) {
      expression = `LEAST(${expression}, ${upperThreshold})`;
    } else if (hasUpperPct) {
      expression = `LEAST(${expression}, ${capTablePrefix}.${capValueCol})`;
    }
    if (hasLowerAbs) {
      expression = `GREATEST(${expression}, ${lowerThreshold})`;
    } else if (hasLowerPct) {
      const lowerPrefix = lowerCapTablePrefix ?? capTablePrefix;
      expression = `GREATEST(${expression}, ${lowerPrefix}.${lowerCapValueCol})`;
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
