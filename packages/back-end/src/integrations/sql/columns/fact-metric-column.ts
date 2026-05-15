import {
  getAggregateFilters,
  getColumnExpression,
  isBinomialMetric,
} from "shared/experiments";
import type {
  ColumnRef,
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import type { SqlDialect } from "shared/types/sql";

export function getFactMetricColumn(
  dialect: SqlDialect,
  metric: FactMetricInterface,
  columnRef: ColumnRef,
  factTable: FactTableInterface,
  alias = "m",
): { timestamp: string; value: string } {
  const hasAggregateFilter =
    getAggregateFilters({
      columnRef: columnRef,
      column: columnRef?.column || "",
      ignoreInvalid: true,
    }).length > 0;

  const column = hasAggregateFilter
    ? columnRef?.aggregateFilterColumn
    : columnRef?.column;

  const timestampColumn = `${alias}.timestamp`;

  const value =
    (!hasAggregateFilter && isBinomialMetric(metric)) ||
    !columnRef ||
    column === "$$distinctUsers" ||
    column === "$$count"
      ? "1"
      : column === "$$distinctDates"
        ? dialect.dateTrunc(timestampColumn, "day")
        : factTable && column
          ? getColumnExpression(
              column,
              factTable,
              (jsonCol: string, path: string, isNumeric: boolean): string =>
                dialect.jsonExtract(jsonCol, path, isNumeric),
              alias,
            )
          : `${alias}.${column}`;

  return {
    timestamp: timestampColumn,
    value,
  };
}
