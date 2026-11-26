import {
  buildRowFilterWhereClause,
  expandVirtualColumnsInSql,
  getFactTableTimestampColumn,
} from "shared/experiments";
import { DEFAULT_TEST_QUERY_DAYS } from "shared/constants";
import {
  FactFilterTestResults,
  FactTableInterface,
  RowFilter,
  RowFilterTestResults,
} from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";
import { ReqContext } from "back-end/types/request";
import {
  getSourceIntegrationObject,
  getIntegrationIdentifierQuote,
  getIntegrationSqlDialect,
} from "back-end/src/services/datasource";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { validateVirtualColumnSql } from "back-end/src/util/factTable";

const SAMPLE_ROWS_LIMIT = 20;

function requireTestQueryIntegration(
  context: ReqContext,
  datasource: DataSourceInterface,
): SourceIntegrationInterface & {
  getTestQuery: NonNullable<SourceIntegrationInterface["getTestQuery"]>;
  runTestQuery: NonNullable<SourceIntegrationInterface["runTestQuery"]>;
} {
  if (!context.permissions.canRunTestQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource, true);
  if (!integration.getTestQuery || !integration.runTestQuery) {
    throw new Error("Testing not supported on this data source");
  }

  return integration as SourceIntegrationInterface & {
    getTestQuery: NonNullable<SourceIntegrationInterface["getTestQuery"]>;
    runTestQuery: NonNullable<SourceIntegrationInterface["runTestQuery"]>;
  };
}

/** Must have a newline after fact table SQL in case it ends with a comment. */
function wrapFactTableSql(sql: string): string {
  return `(\n      ${sql}\n    ) f`;
}

export async function runFactTableTestQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: FactTableInterface,
  {
    query,
    limit,
    notNullColumn,
    testDays,
  }: {
    query: string;
    limit?: number;
    notNullColumn?: string;
    // Overrides the org's test query lookback for this query only.
    testDays?: number;
  },
  preloaded?: ReturnType<typeof requireTestQueryIntegration>,
): Promise<FactFilterTestResults> {
  const integration =
    preloaded ?? requireTestQueryIntegration(context, datasource);
  const timestampColumn = getFactTableTimestampColumn(factTable);

  const sql = integration.getTestQuery({
    query,
    templateVariables: {
      eventName: factTable.eventName,
    },
    testDays: testDays ?? context.org.settings?.testQueryDays,
    timestampColumn,
    limit,
    notNullColumn,
  });

  try {
    const results = await integration.runTestQuery(
      sql,
      [timestampColumn],
      "factTableValidation",
      factTable.id,
    );
    return { sql, ...results };
  } catch (e) {
    return { sql, error: e.message };
  }
}

export async function testFilterQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: FactTableInterface,
  filter: string,
): Promise<FactFilterTestResults> {
  const integration = requireTestQueryIntegration(context, datasource);

  return runFactTableTestQuery(
    context,
    datasource,
    factTable,
    {
      query: `SELECT * FROM ${wrapFactTableSql(factTable.sql)} WHERE ${expandVirtualColumnsInSql(
        filter,
        factTable,
        getIntegrationIdentifierQuote(integration),
      )}`,
    },
    integration,
  );
}

export async function testRowFiltersQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: FactTableInterface,
  rowFilters: RowFilter[],
): Promise<RowFilterTestResults> {
  const integration = requireTestQueryIntegration(context, datasource);
  const dialect = getIntegrationSqlDialect(integration);
  if (!dialect) {
    throw new Error("Sample rows are not supported on this Data Source");
  }

  const where = buildRowFilterWhereClause({
    rowFilters,
    factTable,
    dialect,
  });

  const query = `SELECT * FROM ${wrapFactTableSql(factTable.sql)}${
    where ? `\nWHERE ${where}` : ""
  }`;
  const result = await runNarrowThenWiden(
    context.org.settings?.testQueryDays ?? DEFAULT_TEST_QUERY_DAYS,
    (testDays) =>
      runFactTableTestQuery(
        context,
        datasource,
        factTable,
        { query, limit: SAMPLE_ROWS_LIMIT, testDays },
        integration,
      ),
  );

  return { ...result, where };
}

/**
 * Sample rows try the last day first. `LIMIT` doesn't cut bytes billed on
 * scan-priced warehouses (BigQuery, Athena), so a narrow window is cheaper.
 * Only a run with no rows and no error retries over the org's full window.
 */
export async function runNarrowThenWiden(
  orgWindow: number,
  run: (testDays: number) => Promise<FactFilterTestResults>,
): Promise<FactFilterTestResults> {
  const narrow = await run(Math.min(1, orgWindow));
  if (narrow.error || narrow.results?.length || orgWindow <= 1) return narrow;
  return run(orgWindow);
}

export async function testVirtualColumnQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  factTable: FactTableInterface,
  sql: string,
  columnId?: string,
): Promise<FactFilterTestResults> {
  validateVirtualColumnSql(sql);

  const integration = requireTestQueryIntegration(context, datasource);

  const alias =
    (columnId || "").replace(/[^a-zA-Z0-9_]/g, "") || "__virtual_column";

  // Exclude this column so a self-reference isn't silently expanded.
  const expandedSql = expandVirtualColumnsInSql(
    sql,
    {
      columns: factTable.columns.filter((c) => c.column !== columnId),
    },
    getIntegrationIdentifierQuote(integration),
  );

  return runFactTableTestQuery(
    context,
    datasource,
    factTable,
    {
      query: `SELECT (${expandedSql}) AS ${alias}, * FROM ${wrapFactTableSql(
        factTable.sql,
      )}`,
      notNullColumn: alias,
    },
    integration,
  );
}
