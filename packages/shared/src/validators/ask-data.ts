import { z } from "zod";

// ---------------------------------------------------------------------------
// Public v1 API validators for SQL querying against data sources
// ---------------------------------------------------------------------------

const idParams = z
  .object({
    id: z.string().describe("The id of the data source"),
  })
  .strict();

export const searchTablesValidator = {
  bodySchema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Case-insensitive substring match on table name. Empty returns all.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Max results to return. Defaults to 20."),
  }),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      tables: z.array(
        z.object({
          database: z.string(),
          schema: z.string(),
          table: z.string(),
          columnCount: z.number(),
        }),
      ),
      total: z.number(),
      schemas: z.array(z.string()),
      datasourceType: z.string(),
    })
    .strict(),
  summary: "Search warehouse tables",
  operationId: "searchWarehouseTables",
  tags: ["data-sources"],
  method: "post" as const,
  path: "/data-sources/:id/sql/search-tables",
};

export const getTableSchemaValidator = {
  bodySchema: z.object({
    tables: z
      .array(
        z.object({
          databaseName: z.string(),
          tableSchema: z.string(),
          tableName: z.string(),
        }),
      )
      .min(1)
      .max(5),
  }),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      tables: z.array(
        z.object({
          database: z.string(),
          schema: z.string(),
          table: z.string(),
          columns: z.array(
            z.object({
              name: z.string(),
              type: z.string(),
              description: z.string().optional(),
            }),
          ),
        }),
      ),
    })
    .strict(),
  summary: "Get warehouse table schemas",
  operationId: "getWarehouseTableSchema",
  tags: ["data-sources"],
  method: "post" as const,
  path: "/data-sources/:id/sql/table-schema",
};

export const previewColumnValuesValidator = {
  bodySchema: z.object({
    table: z.string().describe("Fully-qualified table name."),
    columns: z.array(z.string()).min(1).max(3),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Max rows to return. Defaults to 20."),
  }),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      table: z.string(),
      columns: z.array(z.string()),
      rows: z.array(z.record(z.string(), z.unknown())),
      rowCount: z.number(),
    })
    .strict(),
  summary: "Preview distinct column values",
  operationId: "previewWarehouseColumnValues",
  tags: ["data-sources"],
  method: "post" as const,
  path: "/data-sources/:id/sql/preview-values",
};

export const runSqlQueryValidator = {
  bodySchema: z.object({
    sql: z.string().describe("A read-only SELECT or WITH query."),
    purpose: z
      .string()
      .describe("One-line description of what this query answers."),
    confirm: z
      .boolean()
      .optional()
      .describe(
        "Set to true to execute a query that previously returned confirmation_required.",
      ),
    tableMetadata: z
      .object({
        table: z.string().describe("Table name, e.g. 'events'"),
        path: z
          .string()
          .describe("Fully qualified path, e.g. 'db.schema.events'"),
        timestampColumn: z.string().describe("A date/timestamp column name"),
        columnTypes: z
          .record(
            z.string(),
            z.enum(["string", "number", "date", "boolean", "other"]),
          )
          .describe("Map of column names to types"),
      })
      .optional()
      .describe(
        "Table metadata from earlier discovery steps. When provided, the response includes an explorationUrl for viewing results in the product analytics explorer.",
      ),
  }),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z.union([
    z
      .object({
        status: z.literal("success"),
        summary: z.string(),
        rowCount: z.number(),
        columns: z.array(
          z.object({ name: z.string(), dataType: z.string().optional() }),
        ),
        resultCsv: z.string(),
        truncated: z.boolean(),
        durationMs: z.number(),
        sql: z.string(),
        explorationUrl: z.string().optional(),
      })
      .strict(),
    z
      .object({
        status: z.literal("confirmation_required"),
        estimatedBytesProcessed: z.number(),
        estimatedCostUsd: z.number().optional(),
        sql: z.string(),
        message: z.string(),
      })
      .strict(),
    z
      .object({
        status: z.literal("error"),
        message: z.string(),
      })
      .strict(),
  ]),
  summary: "Execute a read-only SQL query",
  operationId: "runSqlQuery",
  tags: ["data-sources"],
  method: "post" as const,
  path: "/data-sources/:id/sql/run-query",
};

// ---------------------------------------------------------------------------
// Agent answer schema (separate from the API endpoints)
// ---------------------------------------------------------------------------

export const askDataAnswerValidator = z.object({
  summary: z
    .string()
    .max(1200)
    .describe(
      "2-4 sentences answering the question, citing real numbers from the query results.",
    ),
  assumptions: z
    .array(z.string())
    .min(1)
    .max(6)
    .describe(
      "Every interpretive choice: how you defined the measure, the date range, " +
        "rows you excluded, joins whose grain could be contested.",
    ),
  caveats: z
    .array(z.string())
    .max(4)
    .optional()
    .describe(
      "Reasons the number could be wrong or misleading — small samples, nulls, " +
        "results hitting the row cap, a table that looked stale.",
    ),
  sourceTables: z
    .array(z.string())
    .min(1)
    .describe("Fully-qualified tables the answer depends on."),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe(
      "low when you guessed at a column meaning or the schema was ambiguous.",
    ),
});

export type AskDataAnswer = z.infer<typeof askDataAnswerValidator>;
