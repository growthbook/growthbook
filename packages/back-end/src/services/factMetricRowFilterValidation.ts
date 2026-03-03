import { FactTableInterface, RowFilter } from "shared/types/fact-table";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";

type FactTableForRowFilterValidation = Pick<
  FactTableInterface,
  "sql" | "eventName" | "filters"
>;

export function getRiskyRowFilterSqlExpressions(
  rowFilters: RowFilter[] | undefined,
  factTable: Pick<FactTableInterface, "filters">,
): string[] {
  if (!rowFilters?.length) return [];

  const expressions: string[] = [];

  rowFilters.forEach((rowFilter) => {
    if (rowFilter.operator === "sql_expr") {
      const sqlExpression = rowFilter.values?.[0]?.trim();
      if (sqlExpression) {
        expressions.push(`(${sqlExpression})`);
      }
      return;
    }

    if (rowFilter.operator === "saved_filter") {
      const filterId = rowFilter.values?.[0];
      if (!filterId) return;

      const savedFilter = factTable.filters.find((f) => f.id === filterId);
      const savedFilterSql = savedFilter?.value?.trim();
      if (savedFilterSql) {
        expressions.push(`(${savedFilterSql})`);
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

  const riskyFilterExpressions = getRiskyRowFilterSqlExpressions(
    rowFilters,
    factTable,
  );
  if (!riskyFilterExpressions.length) {
    return;
  }

  const query = `SELECT * FROM (
  ${factTable.sql}
) f
WHERE ${riskyFilterExpressions.join(" AND ")}`;

  const sql = integration.getTestValidityQuery(
    query,
    testQueryDays,
    { eventName: factTable.eventName },
  );

  try {
    await integration.runTestQuery(sql);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`${errorPrefix}${message}`);
  }
}
