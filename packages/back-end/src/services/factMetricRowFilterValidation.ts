import { FactTableInterface, RowFilter } from "shared/types/fact-table";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";

type FactTableForRowFilterValidation = Pick<
  FactTableInterface,
  "sql" | "eventName"
>;

function getNormalizedSqlExpr(rowFilter: RowFilter): string | null {
  if (rowFilter.operator !== "sql_expr") return null;
  return rowFilter.values?.[0]?.trim() || null;
}

export function getRiskyRowFilterSqlExpressions(
  rowFilters: RowFilter[] | undefined,
): string[] {
  if (!rowFilters?.length) return [];

  const expressions: string[] = [];

  rowFilters.forEach((rowFilter) => {
    const sqlExpression = getNormalizedSqlExpr(rowFilter);
    if (sqlExpression) {
      // Add a newline before closing parens to support trailing line comments.
      expressions.push(`(${sqlExpression}\n)`);
    }
  });

  return expressions;
}

export function getNetNewSqlExprRowFilters({
  rowFilters,
  previousRowFilters,
  validateAll = false,
}: {
  rowFilters: RowFilter[] | undefined;
  previousRowFilters: RowFilter[] | undefined;
  validateAll?: boolean;
}): RowFilter[] {
  if (!rowFilters?.length) return [];

  const previousExpressions = new Set(
    (previousRowFilters || [])
      .map(getNormalizedSqlExpr)
      .filter((s): s is string => !!s),
  );
  const seenExpressions = new Set<string>();
  const netNewSqlExprFilters: RowFilter[] = [];

  rowFilters.forEach((rowFilter) => {
    const sqlExpression = getNormalizedSqlExpr(rowFilter);
    if (!sqlExpression) return;
    if (!validateAll && previousExpressions.has(sqlExpression)) return;
    if (seenExpressions.has(sqlExpression)) return;

    seenExpressions.add(sqlExpression);
    netNewSqlExprFilters.push({
      operator: "sql_expr",
      values: [sqlExpression],
    });
  });

  return netNewSqlExprFilters;
}

export async function validateFactMetricRowFilterSql({
  integration,
  factTable,
  rowFilters,
  errorPrefix,
}: {
  integration: SourceIntegrationInterface;
  factTable: FactTableForRowFilterValidation;
  rowFilters: RowFilter[] | undefined;
  errorPrefix: string;
}): Promise<void> {
  if (!integration.getTestValidityQuery || !integration.runTestQuery) {
    return;
  }

  const riskyFilterExpressions = getRiskyRowFilterSqlExpressions(rowFilters);
  if (!riskyFilterExpressions.length) {
    return;
  }

  const query = `SELECT timestamp FROM (
  ${factTable.sql}
) f
WHERE ${riskyFilterExpressions.join(" AND ")}`;

  const sql = integration.getTestValidityQuery(
    query,
    1,
    {
      eventName: factTable.eventName,
    },
    "timestamp",
  );

  try {
    await integration.runTestQuery(sql, undefined, "factTableValidation");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`${errorPrefix}${message}`);
  }
}
