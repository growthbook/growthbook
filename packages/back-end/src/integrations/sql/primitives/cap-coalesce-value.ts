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
  }: {
    valueCol: string;
    metric: ExperimentMetricInterface;
    capTablePrefix?: string;
    capValueCol?: string;
    columnRef?: ColumnRef | null;
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

  return `COALESCE(${valueCol}, 0)`;
}
