import { randomUUID } from "crypto";
import type { DataSourceInterface } from "shared/types/datasource";
import type { FactTableInterface } from "shared/types/fact-table";
import { ASK_ROW_LIMIT, assertSafeReadOnlySQL, ensureLimit } from "shared/sql";
import type { ExplorationConfig } from "shared/validators";
import { calculateProductAnalyticsDateRange } from "shared/enterprise";
import type { ReqContext } from "back-end/types/request";
import { createCompletedQuery } from "back-end/src/models/QueryModel";
import {
  getIntegrationIdentifierQuote,
  getSourceIntegrationObject,
  runFreeFormQuery,
} from "back-end/src/services/datasource";
import { getFactTablesForDatasource } from "back-end/src/models/FactTableModel";

export { ASK_ROW_LIMIT } from "shared/sql";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

export function resultsToCsv(
  results: Record<string, unknown>[],
  maxRows: number,
): string {
  if (results.length === 0) return "(no rows)";
  const cols = Object.keys(results[0]);
  const header = cols.join("|");
  const rows = results.slice(0, maxRows).map((row) =>
    cols
      .map((c) => {
        const v = row[c];
        if (v === null || v === undefined) return "";
        return String(v);
      })
      .join("|"),
  );
  return [header, ...rows].join("\n");
}

// -----------------------------------------------------------------------------
// Exploration persistence
// -----------------------------------------------------------------------------

/**
 * Creates a persisted SQL exploration and linked Query record from SQL results.
 * The exploration uses `type: "sql"` so the agent's SQL populates the SQL IDE
 * at `/product-analytics/explore/sql`.
 */
export async function createSqlExploration(
  ctx: ReqContext,
  opts: {
    datasourceId: string;
    sql: string;
    purpose: string;
    colNames: string[];
    columns: Array<{ name: string; dataType?: string }> | undefined;
    rows: Record<string, unknown>[];
    durationMs: number;
    timestampColumn?: string;
  },
): Promise<{ explorationId: string; config: ExplorationConfig }> {
  const { colNames, rows } = opts;

  // Build columnTypes from SQL result columns
  const columnTypes: Record<
    string,
    "string" | "number" | "date" | "boolean" | "other"
  > = {};
  for (const col of colNames) {
    const meta = opts.columns?.find((c) => c.name === col);
    const dt = meta?.dataType?.toLowerCase() ?? "";
    if (/int|float|numeric|decimal|double/.test(dt)) {
      columnTypes[col] = "number";
    } else if (/date|time/.test(dt)) {
      columnTypes[col] = "date";
    } else if (/bool/.test(dt)) {
      columnTypes[col] = "boolean";
    } else {
      columnTypes[col] = "string";
    }
  }

  const config: ExplorationConfig = {
    type: "sql",
    datasource: opts.datasourceId,
    chartType: "table",
    dateRange: { predefined: "last30Days" },
    dimensions: [],
    dataset: {
      type: "sql" as const,
      sql: opts.sql,
      timestampColumn: opts.timestampColumn ?? null,
      columnTypes,
      values: [],
    },
  };

  const convertedRows = rows.map((row) => ({
    dimensions: colNames.map((col) => {
      const v = row[col];
      return v === null || v === undefined ? null : String(v);
    }),
  }));

  const dateRange = calculateProductAnalyticsDateRange(config.dateRange);

  const queryRecord = await createCompletedQuery({
    organization: ctx.org.id,
    datasource: opts.datasourceId,
    language: "sql",
    query: opts.sql,
    displayTitle: opts.purpose,
    queryType: "askDataAgentQuery",
    rawResult: rows,
    statistics: { executionDurationMs: opts.durationMs },
  });

  const exploration = await ctx.models.analyticsExplorations.create({
    config,
    datasource: opts.datasourceId,
    configHash: "",
    valueHashes: [],
    dateStart: dateRange.startDate.toISOString(),
    dateEnd: dateRange.endDate.toISOString(),
    queries: [
      {
        query: queryRecord.id,
        status: "succeeded" as const,
        name: "SQL Query",
      },
    ],
    result: { rows: convertedRows },
    runStarted: new Date(),
    status: "success",
    error: null,
  });

  return { explorationId: exploration.id, config };
}

// -----------------------------------------------------------------------------
// Standalone functions (usable by both agent tools and API controllers)
// -----------------------------------------------------------------------------

export async function searchWarehouseTables(
  ctx: ReqContext,
  datasource: DataSourceInterface,
  input: { query: string; limit: number },
): Promise<unknown> {
  const integration = getSourceIntegrationObject(ctx, datasource);
  if (!integration.getInformationSchema) {
    throw new Error("This datasource does not support schema discovery.");
  }
  const databases = await integration.getInformationSchema();
  const q = input.query.toLowerCase();

  const results: Array<{
    database: string;
    schema: string;
    table: string;
    columnCount: number;
  }> = [];

  for (const db of databases) {
    for (const schema of db.schemas) {
      for (const table of schema.tables) {
        const fqtn =
          `${db.databaseName}.${schema.schemaName}.${table.tableName}`.toLowerCase();
        if (!q || fqtn.includes(q)) {
          results.push({
            database: db.databaseName,
            schema: schema.schemaName,
            table: table.tableName,
            columnCount: table.numOfColumns,
          });
        }
      }
    }
  }

  // Include all matching schemas so the agent sees the full scope even when
  // the table list is truncated by the limit.
  const schemas = [...new Set(results.map((r) => `${r.database}.${r.schema}`))];

  return {
    tables: results.slice(0, input.limit),
    total: results.length,
    schemas,
    datasourceType: datasource.type,
  };
}

export async function getWarehouseTableSchema(
  ctx: ReqContext,
  datasource: DataSourceInterface,
  input: {
    tables: Array<{
      databaseName: string;
      tableSchema: string;
      tableName: string;
    }>;
  },
): Promise<unknown> {
  const integration = getSourceIntegrationObject(ctx, datasource);
  if (!integration.getTableData) {
    return {
      error: "This datasource does not support table schema retrieval.",
    };
  }

  const factTables = await getFactTablesForDatasource(ctx, datasource.id);
  return buildTableSchemaResult(integration, factTables, input, new Map());
}

export async function previewWarehouseColumnValues(
  ctx: ReqContext,
  datasource: DataSourceInterface,
  input: { table: string; columns: string[]; limit: number },
): Promise<unknown> {
  const integration = getSourceIntegrationObject(ctx, datasource);
  const q = getIntegrationIdentifierQuote(integration);
  const colList = input.columns.map((c) => `${q}${c}${q}`).join(", ");
  const sql = `SELECT DISTINCT ${colList} FROM ${input.table} LIMIT ${input.limit}`;

  const { results, error } = await runFreeFormQuery(
    ctx,
    datasource,
    sql,
    input.limit,
  );

  if (error) return { error };

  return {
    table: input.table,
    columns: input.columns,
    rows: (results ?? []).slice(0, input.limit),
    rowCount: (results ?? []).length,
  };
}

export async function runWarehouseQuery(
  ctx: ReqContext,
  datasource: DataSourceInterface,
  input: { sql: string; purpose: string },
): Promise<unknown> {
  assertSafeReadOnlySQL(input.sql);

  const limited = ensureLimit(input.sql, ASK_ROW_LIMIT);

  const { results, duration, sql, columns, error } = await runFreeFormQuery(
    ctx,
    datasource,
    limited,
    ASK_ROW_LIMIT,
  );

  if (error) {
    return { status: "error", message: error };
  }

  const rows = results ?? [];
  const colNames = columns?.map((c) => c.name) ?? Object.keys(rows[0] ?? {});
  const truncated = rows.length >= ASK_ROW_LIMIT;
  const csvPreview = resultsToCsv(rows, 20);

  const syntheticConfig = {
    type: "data_source" as const,
    datasource: datasource.id,
    chartType: "table" as const,
    dateRange: { predefined: "last30Days" as const },
    dimensions: colNames.map((col) => ({
      dimensionType: "dynamic" as const,
      column: col,
      maxValues: 500,
    })),
    dataset: {
      type: "data_source" as const,
      table: "sql_query",
      path: "",
      timestampColumn: "",
      columnTypes: Object.fromEntries(
        colNames.map((col) => {
          const meta = columns?.find((c) => c.name === col);
          const dt = meta?.dataType;
          return [col, dt === "number" ? "number" : "string"];
        }),
      ),
      values: [],
    },
  };

  const convertedRows = rows.map((row) => ({
    dimensions: colNames.map((col) => {
      const v = row[col];
      return v === null || v === undefined ? null : String(v);
    }),
  }));

  const syntheticId = `sql_${randomUUID().slice(0, 8)}`;
  const executedSql = sql ?? limited;

  return {
    summary: `SQL query (${rows.length} rows, ${duration ?? 0}ms): ${executedSql.slice(0, 120)}`,
    status: "success",
    snapshotId: syntheticId,
    rowCount: rows.length,
    config: syntheticConfig,
    resultCsv: csvPreview,
    exploration: {
      id: syntheticId,
      organization: ctx.org.id,
      dateCreated: new Date(),
      dateUpdated: new Date(),
      datasource: datasource.id,
      configHash: "",
      valueHashes: [],
      config: syntheticConfig,
      result: { rows: convertedRows },
      dateStart: "",
      dateEnd: "",
      runStarted: new Date(),
      status: "success",
      error: null,
      queries: [],
    },
    ...(truncated
      ? {
          note: "Results were truncated at 500 rows. Consider re-aggregating at a coarser grain.",
        }
      : {}),
  };
}

// -----------------------------------------------------------------------------
// Shared internal helper for table schema building (used by both standalone
// function and cached agent tool wrapper)
// -----------------------------------------------------------------------------

async function buildTableSchemaResult(
  integration: ReturnType<typeof getSourceIntegrationObject>,
  factTables: FactTableInterface[],
  input: {
    tables: Array<{
      databaseName: string;
      tableSchema: string;
      tableName: string;
    }>;
  },
  cache: Map<string, { tableData: null | unknown[] }>,
): Promise<unknown> {
  const results: Array<{
    database: string;
    schema: string;
    table: string;
    columns: unknown[];
  }> = [];

  for (const t of input.tables) {
    const key = `${t.databaseName}.${t.tableSchema}.${t.tableName}`;
    let data = cache.get(key);
    if (!data) {
      data = await integration.getTableData!(
        t.databaseName,
        t.tableSchema,
        t.tableName,
      );
      cache.set(key, data);
    }

    const matchingFt = factTables.find((ft) =>
      ft.sql.toLowerCase().includes(t.tableName.toLowerCase()),
    );
    const columnDescriptions = new Map<string, string>();
    if (matchingFt) {
      for (const col of matchingFt.columns) {
        if (col.description) {
          columnDescriptions.set(col.column, col.description);
        }
      }
    }

    const columns = (data.tableData ?? []).map((col) => {
      const c = col as { column_name?: string; data_type?: string };
      const name = c.column_name ?? "";
      return {
        name,
        type: c.data_type ?? "unknown",
        ...(columnDescriptions.has(name)
          ? { description: columnDescriptions.get(name) }
          : {}),
      };
    });

    results.push({
      database: t.databaseName,
      schema: t.tableSchema,
      table: t.tableName,
      columns,
    });
  }

  return { tables: results };
}

// -----------------------------------------------------------------------------
// Agent tool builder
// -----------------------------------------------------------------------------
