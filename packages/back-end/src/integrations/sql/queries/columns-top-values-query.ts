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
  ${compileSqlTemplate(
    factTable.sql,
    {
      startDate: start,
      templateVariables: {
        eventName: factTable.eventName,
      },
    },
    dialect,
  )}
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
  { columns, start, limit, maxValueLength }: TopValuesCTEBodyParams,
): string {
  const pairs = columns.map((c) => ({
    keyLiteral: c.column.replace(/'/g, "''"),
    valueSql: dialect.castToString(c.column),
  }));

  const u = dialect.unpivotLabeledPairs(pairs);

  const lengthFilter =
    maxValueLength !== undefined
      ? `AND ${dialect.stringLength("value")} <= ${maxValueLength}`
      : "";

  // Materialize the unpivoted (column_name, value) once in an inner subquery so
  // keyExpr/valueExpr are only embedded one time. Some dialects (Redshift,
  // Snowflake) resolve these via large CASE expressions, and repeating those
  // across SELECT/WHERE/GROUP BY would balloon the SQL.
  const aggQuery = `
      SELECT column_name, value, COUNT(*) AS count
      FROM (
        SELECT ${u.keyExpr} AS column_name, ${u.valueExpr} AS value
        FROM __factTable
        ${u.fromContinuation}
        WHERE timestamp >= ${dialect.toTimestamp(start)}
      ) __unpivot
      WHERE value IS NOT NULL
        ${lengthFilter}
      GROUP BY column_name, value`;

  // Wraps an aggregation query shaped like (column_name, value, count) and
  // returns the top `limit` values per column. Shared across all efficient
  // unpivot implementations so each dialect only has to produce the unpivot+
  // aggregation, not the ranking.
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
