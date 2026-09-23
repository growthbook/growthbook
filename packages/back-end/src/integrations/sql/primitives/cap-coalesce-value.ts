import {
  getAggregateFilters,
  isCappableMetricType,
  ExperimentMetricInterface,
} from "shared/experiments";
import { ColumnRef } from "shared/types/fact-table";
import { SqlDialect } from "shared/types/sql";

export function capCoalesceValue(
  dialect: SqlDialect,
  {
    valueCol,
    metric,
    capTablePrefix = "c",
    capValueCol = "value_cap",
    columnRef,
    preserveType = false,
  }: {
    valueCol: string;
    metric: ExperimentMetricInterface;
    capTablePrefix?: string;
    capValueCol?: string;
    columnRef?: ColumnRef | null;
    // Skip the float cast on uncapped values, for callers that persist the
    // result into a typed (possibly integer) column.
    preserveType?: boolean;
  },
): string {
  // Assumes cappable metrics do not have aggregate filters
  // which is true for now
  if (
    metric?.cappingSettings.type === "absolute" &&
    metric.cappingSettings.value &&
    isCappableMetricType(metric)
  ) {
    return `LEAST(
        ${dialect.castToFloat(`COALESCE(${valueCol}, 0)`)},
        ${metric.cappingSettings.value}
      )`;
  }
  if (
    metric?.cappingSettings.type === "percentile" &&
    metric.cappingSettings.value &&
    metric.cappingSettings.value < 1 &&
    isCappableMetricType(metric)
  ) {
    return `LEAST(
        ${dialect.castToFloat(`COALESCE(${valueCol}, 0)`)},
        ${capTablePrefix}.${capValueCol}
      )`;
  }

  const filters = getAggregateFilters({
    columnRef: columnRef || null,
    column: valueCol,
    ignoreInvalid: true,
  });
  if (filters.length) {
    valueCol = `(CASE WHEN ${filters.join(" AND ")} THEN 1 ELSE NULL END)`;
  }

  // Cast to float so downstream SUM(a * b) cross products can't overflow
  // integer types when per-unit totals are large whole-number counts.
  const coalesced = `COALESCE(${valueCol}, 0)`;
  return preserveType ? coalesced : dialect.castToFloat(coalesced);
}
