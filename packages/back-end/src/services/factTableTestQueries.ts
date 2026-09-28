import {
  expandVirtualColumnsInSql,
  getFactTableTimestampColumn,
  getRowFilterSQL,
} from "shared/experiments";
import {
  FactFilterTestResults,
  FactTableInterface,
  RowFilter,
  RowFilterTestResults,
} from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";
import type { SqlDialect } from "shared/types/sql";
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
  }: {
    query: string;
    limit?: number;
    notNullColumn?: string;
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
    testDays: context.org.settings?.testQueryDays,
    timestampColumn,
    limit,
    notNullColumn,
  });

  try {
    const results = await integration.runTestQuery(
      sql,
      [timestampColumn],
      "factTableValidation",
    );
    return { sql, ...results };
  } catch (e) {
    return { sql, error: e.message };
  }
}

export function buildRowFilterWhereClause({
  rowFilters,
  factTable,
  dialect,
}: {
  rowFilters: RowFilter[];
  factTable: Pick<FactTableInterface, "columns" | "filters" | "userIdTypes">;
  dialect: Pick<
    SqlDialect,
    | "jsonExtract"
    | "escapeStringLiteral"
    | "stringMatch"
    | "evalBoolean"
    | "castToTimestamp"
    | "identifierQuote"
  >;
}): string {
  const where: string[] = [];
  rowFilters.forEach((rowFilter) => {
    const sql = getRowFilterSQL({
      rowFilter,
      factTable,
      jsonExtract: dialect.jsonExtract,
      escapeStringLiteral: dialect.escapeStringLiteral,
      stringMatch: dialect.stringMatch,
      evalBoolean: dialect.evalBoolean,
      castToTimestamp: dialect.castToTimestamp,
      identifierQuote: dialect.identifierQuote,
    });

    // Incomplete/deleted filters would silently widen the preview.
    if (sql === null) {
      if (rowFilter.operator === "saved_filter") {
        throw new Error(
          `Saved Filter "${rowFilter.values?.[0]}" no longer exists. Remove it from the row filters to preview rows.`,
        );
      }
      throw new Error(
        `The row filter on "${rowFilter.column || rowFilter.operator}" is incomplete and cannot be previewed.`,
      );
    }

    where.push(sql);
  });

  return where.join("\n  AND ");
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

  const result = await runFactTableTestQuery(
    context,
    datasource,
    factTable,
    {
      query: `SELECT * FROM ${wrapFactTableSql(factTable.sql)}${
        where ? `\nWHERE ${where}` : ""
      }`,
      limit: SAMPLE_ROWS_LIMIT,
    },
    integration,
  );

  return { ...result, where };
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
