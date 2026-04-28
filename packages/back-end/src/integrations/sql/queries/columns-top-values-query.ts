import { format } from "shared/sql";
import type { ColumnTopValuesParams } from "shared/types/integrations";
import type { SqlDialect } from "shared/types/sql";
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
  ${dialect.getTopValuesCTEBody(dialect, { columns, start, limit, maxValueLength })}
)
SELECT * FROM __topValues
ORDER BY column_name, count DESC
  `,
    dialect.formatDialect,
  );
}
