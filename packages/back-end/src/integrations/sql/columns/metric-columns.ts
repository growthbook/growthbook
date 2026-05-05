import {
  ExperimentMetricInterface,
  getAggregateFilters,
  getColumnExpression,
  getUserIdTypes,
  isBinomialMetric,
  isFactMetric,
} from "shared/experiments";
import type { SqlDialect } from "shared/types/sql";
import type { FactTableMap } from "back-end/src/models/FactTableModel";

import { getMetricQueryFormat } from "back-end/src/integrations/sql/fact-metrics/metric-query-format";

// TODO(sql): refactor to change metric type to legacy only
// currently this is used for activation metrics even if they are
// fact metrics
export function getMetricColumns(
  dialect: SqlDialect,
  metric: ExperimentMetricInterface,
  factTableMap: FactTableMap,
  alias = "m",
  useDenominator?: boolean,
): { userIds: Record<string, string>; timestamp: string; value: string } {
  if (isFactMetric(metric)) {
    const userIds: Record<string, string> = {};
    getUserIdTypes(metric, factTableMap, useDenominator).forEach(
      (userIdType) => {
        userIds[userIdType] = `${alias}.${userIdType}`;
      },
    );

    const columnRef = useDenominator ? metric.denominator : metric.numerator;

    const factTable = factTableMap.get(columnRef?.factTableId || "");

    const hasAggregateFilter =
      getAggregateFilters({
        columnRef: columnRef,
        column: columnRef?.column || "",
        ignoreInvalid: true,
      }).length > 0;

    const column = hasAggregateFilter
      ? columnRef?.aggregateFilterColumn
      : columnRef?.column;

    const value =
      (!hasAggregateFilter && isBinomialMetric(metric)) ||
      // TODO(sql): remove when switching this method to only be used by legacy metrics
      !columnRef ||
      column === "$$distinctUsers" ||
      column === "$$count" ||
      column === "$$distinctDates"
        ? "1"
        : factTable && column
          ? getColumnExpression(column, factTable, dialect.jsonExtract, alias)
          : `${alias}.${column}`;

    return {
      userIds,
      timestamp: `${alias}.timestamp`,
      value,
    };
  }

  const queryFormat = getMetricQueryFormat(metric);

  // Directly inputting SQL (preferred)
  if (queryFormat === "sql") {
    const userIds: Record<string, string> = {};
    metric.userIdTypes?.forEach((userIdType) => {
      userIds[userIdType] = `${alias}.${userIdType}`;
    });
    return {
      userIds: userIds,
      timestamp: `${alias}.timestamp`,
      value: metric.type === "binomial" ? "1" : `${alias}.value`,
    };
  }

  // Using the query builder (legacy)
  let valueCol = metric.column || "value";
  if (metric.type === "duration" && valueCol.match(/\{alias\}/)) {
    valueCol = valueCol.replace(/\{alias\}/g, alias);
  } else {
    valueCol = alias + "." + valueCol;
  }
  const value = metric.type !== "binomial" && metric.column ? valueCol : "1";

  const userIds: Record<string, string> = {};
  metric.userIdTypes?.forEach((userIdType) => {
    userIds[userIdType] = `${alias}.${
      metric.userIdColumns?.[userIdType] || userIdType
    }`;
  });

  return {
    userIds,
    timestamp: `${alias}.${metric.timestampColumn || "received_at"}`,
    value,
  };
}
