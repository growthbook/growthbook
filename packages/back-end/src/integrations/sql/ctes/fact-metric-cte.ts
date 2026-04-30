import {
  getColumnRefWhereClause,
  getFactTableTemplateVariables,
  isRatioMetric,
  parseSliceMetricId,
} from "shared/experiments";
import { buildMinimalOrCondition } from "shared/sql";
import type { PhaseSQLVar, SqlDialect } from "shared/types/sql";
import type {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { compileSqlTemplate } from "back-end/src/util/sql";

import { getFactMetricColumn } from "back-end/src/integrations/sql/columns/fact-metric-column";
import { toTimestampWithMs } from "back-end/src/integrations/sql/primitives/to-timestamp-with-ms";

/** Fact Table CTE for multiple fact metrics that share the same fact table */
export function getFactMetricCTE(
  dialect: SqlDialect,
  {
    metricsWithIndices,
    factTable,
    baseIdType,
    castIdToString,
    idJoinMap,
    startDate,
    endDate,
    experimentId,
    addFiltersToWhere,
    exclusiveStartDateFilter,
    exclusiveEndDateFilter,
    phase,
    customFields,
  }: {
    metricsWithIndices: { metric: FactMetricInterface; index: number }[];
    factTable: FactTableInterface;
    baseIdType: string;
    idJoinMap: Record<string, string>;
    startDate: Date;
    endDate: Date | null;
    experimentId?: string;
    addFiltersToWhere?: boolean;
    phase?: PhaseSQLVar;
    customFields?: Record<string, unknown>;
    exclusiveStartDateFilter?: boolean;
    exclusiveEndDateFilter?: boolean;
    castIdToString?: boolean;
  },
): string {
  // Determine if a join is required to match up id types
  let join = "";
  let userIdCol = "";
  const userIdTypes = factTable.userIdTypes;
  if (userIdTypes.includes(baseIdType)) {
    userIdCol = baseIdType;
  } else if (userIdTypes.length > 0) {
    for (let i = 0; i < userIdTypes.length; i++) {
      const userIdType: string = userIdTypes[i];
      if (userIdType in idJoinMap) {
        const metricUserIdCol = `m.${userIdType}`;
        join = `JOIN ${idJoinMap[userIdType]} i ON (i.${userIdType} = ${metricUserIdCol})`;
        userIdCol = `i.${baseIdType}`;
        break;
      }
    }
  }

  // BQ datetime cast for SELECT statements (do not use for where)
  const timestampDateTimeColumn = dialect.castUserDateCol("m.timestamp");

  const sql = factTable.sql;
  const where: string[] = [];

  // Add a rough date filter to improve query performance
  if (startDate) {
    // If exclusive, we need to be more precise with the timestamp
    const operator = exclusiveStartDateFilter ? ">" : ">=";
    const timestampFn = exclusiveStartDateFilter
      ? toTimestampWithMs
      : dialect.toTimestamp.bind(dialect);
    where.push(`m.timestamp ${operator} ${timestampFn(startDate)}`);
  }
  if (endDate) {
    // If exclusive, we need to be more precise with the timestamp
    const operator = exclusiveEndDateFilter ? "<" : "<=";
    const timestampFn = exclusiveEndDateFilter
      ? toTimestampWithMs
      : dialect.toTimestamp.bind(dialect);
    where.push(`m.timestamp ${operator} ${timestampFn(endDate)}`);
  }

  const metricCols: string[] = [];
  const allMetricFilters: string[][] = [];

  metricsWithIndices.forEach((metricWithIndex) => {
    const m = metricWithIndex.metric;
    const index = metricWithIndex.index;
    if (m.numerator?.factTableId === factTable.id) {
      const value = getFactMetricColumn(
        dialect,
        m,
        m.numerator,
        factTable,
        "m",
      ).value;

      const sliceInfo = parseSliceMetricId(m.id, {
        [factTable.id]: factTable,
      });
      const filters = getColumnRefWhereClause({
        factTable,
        columnRef: m.numerator,
        escapeStringLiteral: dialect.escapeStringLiteral,
        jsonExtract: dialect.jsonExtract,
        evalBoolean: dialect.evalBoolean,
        sliceInfo,
      });

      const column =
        filters.length > 0
          ? `CASE WHEN (${filters.join("\n AND ")}) THEN ${value} ELSE NULL END`
          : value;

      metricCols.push(`-- ${m.name}
        ${column} as m${index}_value`);

      allMetricFilters.push(filters);
    }

    if (isRatioMetric(m) && m.denominator) {
      if (m.denominator.factTableId !== factTable.id) {
        return;
      }

      const value = getFactMetricColumn(
        dialect,
        m,
        m.denominator,
        factTable,
        "m",
      ).value;

      const sliceInfo = parseSliceMetricId(m.id, {
        [factTable.id]: factTable,
      });
      const filters = getColumnRefWhereClause({
        factTable,
        columnRef: m.denominator,
        escapeStringLiteral: dialect.escapeStringLiteral,
        jsonExtract: dialect.jsonExtract,
        evalBoolean: dialect.evalBoolean,
        sliceInfo,
      });
      const column =
        filters.length > 0
          ? `CASE WHEN (${filters.join(" AND ")}) THEN ${value} ELSE NULL END`
          : value;
      metricCols.push(`-- ${m.name} (denominator)
        ${column} as m${index}_denominator`);

      allMetricFilters.push(filters);
    }
  });

  if (addFiltersToWhere) {
    const filters = buildMinimalOrCondition(allMetricFilters);
    if (filters) {
      where.push(filters);
    }
  }

  return compileSqlTemplate(
    `-- Fact Table (${factTable.name})
      SELECT
        ${castIdToString ? dialect.castToString(userIdCol) : userIdCol} as ${baseIdType},
        ${timestampDateTimeColumn} as timestamp,
        ${metricCols.join(",\n")}
      FROM(
          ${sql}
        ) m
        ${join}
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    `,
    {
      startDate,
      endDate: endDate || undefined,
      experimentId,
      templateVariables: getFactTableTemplateVariables(factTable),
      phase,
      customFields,
    },
    dialect,
  );
}
