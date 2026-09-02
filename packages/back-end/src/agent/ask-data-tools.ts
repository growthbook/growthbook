import { randomUUID } from "crypto";
import { z } from "zod";
import type { ToolSet } from "ai";
import type { DataSourceInterface } from "shared/types/datasource";
import type { FactTableInterface } from "shared/types/fact-table";
import type { InformationSchema } from "shared/types/integrations";
import { ASK_ROW_LIMIT, assertSafeReadOnlySQL, ensureLimit } from "shared/sql";
import { aiTool } from "back-end/src/enterprise/services/ai";
import type { AgentEmit } from "back-end/src/enterprise/services/agent-handler";
import type { ConversationBuffer } from "back-end/src/enterprise/services/conversation-buffer";
import type { ReqContext } from "back-end/types/request";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  getSourceIntegrationObject,
  runFreeFormQuery,
} from "back-end/src/services/datasource";
import { getFactTablesForDatasource } from "back-end/src/models/FactTableModel";

export { ASK_ROW_LIMIT } from "shared/sql";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface AskDataToolsDeps {
  ctx: ReqContext;
  buffer: ConversationBuffer;
  datasource: DataSourceInterface;
  emit?: AgentEmit;
}

// -----------------------------------------------------------------------------
// Tool input schemas (exported for API validation)
// -----------------------------------------------------------------------------

export const searchTablesInputSchema = z.object({
  query: z
    .string()
    .default("")
    .describe(
      "Filter tables by name (case-insensitive substring match). Empty returns all.",
    ),
  limit: z.number().int().min(1).max(50).default(20),
});

export const getTableSchemaInputSchema = z.object({
  tables: z
    .array(
      z.object({
        databaseName: z.string(),
        tableSchema: z.string(),
        tableName: z.string(),
      }),
    )
    .min(1)
    .max(5)
    .describe("Tables to retrieve column schemas for."),
});

export const previewColumnValuesInputSchema = z.object({
  table: z.string().describe("Fully-qualified table name."),
  columns: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe("Column names to preview distinct values for."),
  limit: z.number().int().min(1).max(20).default(20),
});

export const runQueryInputSchema = z.object({
  sql: z.string().describe("A read-only SELECT or WITH query."),
  purpose: z
    .string()
    .describe("One-line description of what this query is intended to answer."),
});

// -----------------------------------------------------------------------------
// Tool descriptions
// -----------------------------------------------------------------------------

const SEARCH_TABLES_DESCRIPTION =
  "Search the warehouse's information schema for tables matching a query. " +
  "Returns table names with column counts. Use this to discover which raw " +
  "tables exist when the exploration tools can't answer the question.";

const GET_TABLE_SCHEMA_DESCRIPTION =
  "Retrieve column names and data types for specific warehouse tables. " +
  "Use this to understand a table's structure before writing SQL. Enriched " +
  "with descriptions from fact tables where available.";

const PREVIEW_COLUMN_VALUES_DESCRIPTION =
  "Preview distinct values in warehouse table columns. You MUST call this " +
  "before using any specific column value in a WHERE clause — never guess " +
  "enum spellings, date formats, or null patterns. WARNING: on scan-billed " +
  "warehouses (BigQuery), this scans full columns even with LIMIT.";

const RUN_QUERY_DESCRIPTION =
  "Execute a read-only SQL query against the warehouse. Use this as a " +
  "fallback when the question can't be answered with existing metrics or " +
  "explorations. The query is validated for safety and capped at 500 rows. " +
  "Results are shown to the user as a table. You will see column metadata " +
  "and the first ~20 rows as CSV to analyze.";

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
  const colList = input.columns.map((c) => `"${c}"`).join(", ");
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

/**
 * Conditionally builds SQL-fallback tools for the PA agent. Returns `null`
 * when ask-data is not enabled or the user lacks permissions, in which case
 * no SQL tools appear in the agent's tool set.
 */
export async function buildAskDataTools(
  ctx: ReqContext,
  buffer: ConversationBuffer,
  datasourceId: string | undefined,
  emit?: AgentEmit,
): Promise<ToolSet | null> {
  const orgSettings = ctx.org.settings;
  if (!orgSettings?.aiAskDataEnabled) return null;

  if (!datasourceId) return null;
  const datasource = await getDataSourceById(ctx, datasourceId);
  if (!datasource) return null;
  if (!datasource.settings?.askData?.enabled) return null;

  if (!ctx.permissions.canRunSchemaQueries(datasource)) return null;
  if (!ctx.permissions.canRunSqlExplorerQueries(datasource)) return null;

  const deps: AskDataToolsDeps = { ctx, buffer, datasource, emit };

  // Per-conversation caches
  let infoSchemaCache: InformationSchema[] | null = null;
  const getInfoSchema = async (): Promise<InformationSchema[]> => {
    if (infoSchemaCache) return infoSchemaCache;
    const integration = getSourceIntegrationObject(ctx, datasource);
    if (!integration.getInformationSchema) {
      throw new Error("This datasource does not support schema discovery.");
    }
    emit?.("tool-progress", { message: "Reading warehouse structure\u2026" });
    infoSchemaCache = await integration.getInformationSchema();
    return infoSchemaCache;
  };

  const tableSchemaCache = new Map<string, { tableData: null | unknown[] }>();

  let factTablesCache: FactTableInterface[] | null = null;
  const getFactTables = async (): Promise<FactTableInterface[]> => {
    if (factTablesCache) return factTablesCache;
    factTablesCache = await getFactTablesForDatasource(ctx, datasourceId);
    return factTablesCache;
  };

  return {
    searchTables: aiTool({
      description: SEARCH_TABLES_DESCRIPTION,
      inputSchema: searchTablesInputSchema,
      execute: (input) => executeSearchTables(deps, getInfoSchema, input),
    }),

    getTableSchema: aiTool({
      description: GET_TABLE_SCHEMA_DESCRIPTION,
      inputSchema: getTableSchemaInputSchema,
      execute: (input) =>
        executeGetTableSchema(deps, tableSchemaCache, getFactTables, input),
    }),

    previewColumnValues: aiTool({
      description: PREVIEW_COLUMN_VALUES_DESCRIPTION,
      inputSchema: previewColumnValuesInputSchema,
      execute: (input) => executePreviewColumnValues(deps, input),
    }),

    runQuery: aiTool({
      description: RUN_QUERY_DESCRIPTION,
      inputSchema: runQueryInputSchema,
      execute: (input) => executeRunQuery(deps, input),
    }),
  };
}

// -----------------------------------------------------------------------------
// Agent tool implementations (thin wrappers using caches and deps)
// -----------------------------------------------------------------------------

async function executeSearchTables(
  { datasource }: AskDataToolsDeps,
  getInfoSchema: () => Promise<InformationSchema[]>,
  input: { query: string; limit: number },
): Promise<unknown> {
  const databases = await getInfoSchema();
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

  return {
    tables: results.slice(0, input.limit),
    total: results.length,
    datasourceType: datasource.type,
  };
}

async function executeGetTableSchema(
  { ctx, datasource }: AskDataToolsDeps,
  cache: Map<string, { tableData: null | unknown[] }>,
  getFactTables: () => Promise<FactTableInterface[]>,
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

  const factTables = await getFactTables();
  return buildTableSchemaResult(integration, factTables, input, cache);
}

async function executePreviewColumnValues(
  { ctx, datasource }: AskDataToolsDeps,
  input: { table: string; columns: string[]; limit: number },
): Promise<unknown> {
  return previewWarehouseColumnValues(ctx, datasource, input);
}

async function executeRunQuery(
  { ctx, datasource }: AskDataToolsDeps,
  input: { sql: string; purpose: string },
): Promise<unknown> {
  return runWarehouseQuery(ctx, datasource, input);
}
