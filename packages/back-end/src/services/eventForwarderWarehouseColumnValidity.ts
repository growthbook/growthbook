import {
  QueryResponseColumnData,
  TestQueryRow,
} from "shared/types/integrations";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";

/**
 * Event-forwarder-only column validation (mirrors testQueryValidity /
 * testFeatureUsageQueryValidity in datasource.ts without modifying those).
 */
function getMissingRequiredColumnsFromTestQueryResult(
  results: {
    columns?: QueryResponseColumnData[];
    results: TestQueryRow[];
  },
  requiredColumns: Iterable<string>,
): string | undefined {
  let columns: Set<string>;

  if (results.columns) {
    const columnNames = results.columns.map((c) => c.name);
    if (columnNames.length === 0) {
      return "Unable to determine columns from query";
    }
    columns = new Set(columnNames);
  } else {
    if (results.results.length === 0) {
      return "No rows returned";
    }
    columns = new Set(Object.keys(results.results[0]));
  }

  const missingColumns: string[] = [];
  for (const col of requiredColumns) {
    if (!columns.has(col)) {
      missingColumns.push(col);
    }
  }

  if (missingColumns.length > 0) {
    return `Missing required columns in response: ${missingColumns.join(", ")}`;
  }

  return undefined;
}

/** Validates a probe SQL query for the events catch-all table during warehouse sync. */
export async function testEventForwarderWarehouseColumnProbeValidity(
  integration: SourceIntegrationInterface,
  sql: string,
  requiredColumns: Iterable<string>,
  testDays?: number,
  timestampColumn = "timestamp",
): Promise<string | undefined> {
  if (!integration.getTestValidityQuery || !integration.runTestQuery) {
    return undefined;
  }

  const validitySql = integration.getTestValidityQuery(
    sql,
    testDays,
    undefined,
    timestampColumn,
  );

  try {
    const results = await integration.runTestQuery(
      validitySql,
      undefined,
      "testQuery",
    );
    return getMissingRequiredColumnsFromTestQueryResult(
      results,
      requiredColumns,
    );
  } catch (e) {
    return e.message;
  }
}
