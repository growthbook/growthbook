import { format } from "shared/sql";
import type { ColumnTopValuesParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { ColumnInterface } from "shared/types/fact-table";
import { compileSqlTemplate } from "back-end/src/util/sql";

export function getColumnsTopValuesQuery(
  dialect: SqlDialect,
  {
    factTable,
    columns,
    limit = 50,
    lookbackDays = 14,
    maxValueLength,
  }: ColumnTopValuesParams,
): string {
  if (columns.length === 0) {
    throw new Error("At least one column is required");
  }

  // Validate all columns are string type
  for (const column of columns) {
    if (column.datatype !== "string") {
      throw new Error(`Column ${column.column} is not a string column`);
    }
  }

  const start = new Date();
  start.setDate(start.getDate() - lookbackDays);

  return format(
    `
WITH
__factTable AS (
  ${compileSqlTemplate(factTable.sql, {
    startDate: start,
    templateVariables: {
      eventName: factTable.eventName,
    },
  })}
),
__topValues AS (
  ${getTopValuesCTEBody(dialect, { columns, start, limit, maxValueLength })}
)
SELECT * FROM __topValues
ORDER BY column_name, count DESC
  `,
    dialect.formatDialect,
  );
}

type TopValuesCTEBodyParams = {
  columns: ColumnInterface[];
  start: Date;
  limit: number;
  maxValueLength?: number;
};

function getTopValuesCTEBody(
  dialect: SqlDialect,
  params: TopValuesCTEBodyParams,
): string {
  if (dialect.unpivotLabeledPairs) {
    return getEfficientTopValuesCTEBody(dialect, params);
  }

  const { columns, start, limit } = params;
  // Naive approach: one subquery per column UNION ALL'd together. Each
  // subquery re-scans __factTable, so this is only suitable for dialects
  // where we haven't implemented a single-scan unpivot. The maxValueLength
  // filter is not applied here — non-efficient datasources currently only
  // fetch explicitly-opted-in columns, and the caller filters over-length
  // values in TS as a safety net.
  const columnQueries = columns.map((column, i) => {
    return `
  (${dialect.selectStarLimit(
    `(
      SELECT
        ${dialect.castToString(`'${column.column}'`)} AS column_name,
        ${dialect.castToString(column.column)} AS value,
        COUNT(*) AS count
      FROM __factTable
      WHERE timestamp >= ${dialect.toTimestamp(start)}
        AND ${column.column} IS NOT NULL
      GROUP BY ${column.column}
      ORDER BY count DESC
    ) c${i}`,
    limit,
  )})`;
  });
  return columnQueries.join("\n    UNION ALL\n");
}

function getEfficientTopValuesCTEBody(
  dialect: SqlDialect,
  { columns, start, limit, maxValueLength }: TopValuesCTEBodyParams,
): string {
  const unpivot = dialect.unpivotLabeledPairs;
  if (!unpivot) {
    throw new Error(
      "getEfficientTopValuesCTEBody requires dialect.unpivotLabeledPairs",
    );
  }

  const pairs = columns.map((c) => ({
    keyLiteral: c.column.replace(/'/g, "''"),
    valueSql: dialect.castToString(c.column),
  }));

  const u = unpivot(pairs);

  const lengthFilter =
    maxValueLength !== undefined
      ? `AND ${dialect.stringLength(u.valuePredicateExpr)} <= ${maxValueLength}`
      : "";

  const aggQuery = `
      SELECT ${u.keyExpr} AS column_name, ${u.valueExpr} AS value, COUNT(*) AS count
      FROM __factTable
      ${u.fromContinuation}
      WHERE timestamp >= ${dialect.toTimestamp(start)}
        AND ${u.valuePredicateExpr} IS NOT NULL
        ${lengthFilter}
      GROUP BY ${u.groupByClause}`;

  return getTopNPerColumnQuery(aggQuery, limit);
}

// Wraps an aggregation query shaped like (column_name, value, count) and
// returns the top `limit` values per column. Shared across all efficient
// unpivot implementations so each dialect only has to produce the unpivot+
// aggregation, not the ranking.
function getTopNPerColumnQuery(aggQuery: string, limit: number): string {
  return `
    SELECT column_name, value, count FROM (
      SELECT column_name, value, count,
        ROW_NUMBER() OVER (PARTITION BY column_name ORDER BY count DESC) AS row_num
      FROM (
        ${aggQuery}
      ) __topValuesAgg
    ) __topValuesRanked
    WHERE row_num <= ${limit}`;
}
