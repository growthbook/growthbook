import { format } from "shared/sql";
import type { ColumnTopValuesParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
import { compileSqlTemplate } from "back-end/src/util/sql";

export function getColumnsTopValuesQuery(
  dialect: SqlDialect,
  { factTable, columns, limit = 50, lookbackDays = 14 }: ColumnTopValuesParams,
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

  // Generate a UNION ALL query for each column
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
    ${columnQueries.join("\n    UNION ALL\n")}
  )
SELECT * FROM __topValues
ORDER BY column_name, count DESC
    `,
    dialect.formatDialect,
  );
}
