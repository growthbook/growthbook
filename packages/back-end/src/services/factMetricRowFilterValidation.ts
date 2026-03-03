import { FactTableInterface, RowFilter } from "shared/types/fact-table";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";

type FactTableForRowFilterValidation = Pick<
  FactTableInterface,
  "sql" | "eventName"
>;

export function getRiskyRowFilterSqlExpressions(
  rowFilters: RowFilter[] | undefined,
): string[] {
  if (!rowFilters?.length) return [];

  const expressions: string[] = [];

  rowFilters.forEach((rowFilter) => {
    if (rowFilter.operator === "sql_expr") {
      const sqlExpression = rowFilter.values?.[0]?.trim();
      if (sqlExpression) {
        // Add a newline before closing parens to support trailing line comments.
        expressions.push(`(${sqlExpression}\n)`);
      }
    }
  });

  return expressions;
}

export async function validateFactMetricRowFilterSql({
  integration,
  factTable,
  rowFilters,
  testQueryDays,
  errorPrefix,
}: {
  integration: SourceIntegrationInterface;
  factTable: FactTableForRowFilterValidation;
  rowFilters: RowFilter[] | undefined;
  testQueryDays?: number;
  errorPrefix: string;
}): Promise<void> {
  if (!integration.getTestValidityQuery || !integration.runTestQuery) {
    return;
  }

  const riskyFilterExpressions = getRiskyRowFilterSqlExpressions(rowFilters);
  if (!riskyFilterExpressions.length) {
    return;
  }

  const query = `SELECT * FROM (
  ${factTable.sql}
) f
WHERE ${riskyFilterExpressions.join(" AND ")}`;

  const sql = integration.getTestValidityQuery(query, testQueryDays, {
    eventName: factTable.eventName,
  });

  try {
    await integration.runTestQuery(sql);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`${errorPrefix}${message}`);
  }
}
