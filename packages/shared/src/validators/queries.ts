import { z } from "zod";

import { baseSchema } from "./base-model";
import { namedSchema } from "./openapi-helpers";

export const queryStatusValidator = z.enum([
  "queued",
  "running",
  "failed",
  "partially-succeeded",
  "succeeded",
]);

export const queryRunnerFailureCause = z.enum([
  "query",
  "analysis",
  "no-queries",
  "cancelled",
  // The runner itself failed (database, dependency, or refresh error) before
  // the queries or analysis could be blamed.
  "unknown",
]);

export const queryPointerValidator = z
  .object({
    query: z.string(),
    status: queryStatusValidator,
    name: z.string(),
  })
  .strict();

export const sqlResultChunkValidator = z
  .object({
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    id: z.string(),
    queryId: z.string(),
    chunkNumber: z.number(),
    numRows: z.number(),
    data: z.record(z.string(), z.array(z.unknown())),
  })
  .strict();

// Corresponds to schemas/Query.yaml
export const apiQueryValidator = namedSchema(
  "Query",
  z
    .object({
      id: z.string(),
      organization: z.string(),
      datasource: z.string(),
      language: z.string(),
      query: z.string(),
      queryType: z.string(),
      createdAt: z.string(),
      startedAt: z.string(),
      status: z.enum([
        "running",
        "queued",
        "failed",
        "partially-succeeded",
        "succeeded",
      ]),
      externalId: z.string(),
      dependencies: z.array(z.string()),
      runAtEnd: z.boolean(),
    })
    .strict(),
);

export type ApiQuery = z.infer<typeof apiQueryValidator>;

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const getQueryValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      query: apiQueryValidator,
    })
    .strict(),
  summary: "Get a single query",
  operationId: "getQuery",
  tags: ["queries"],
  method: "get" as const,
  path: "/queries/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const queryStatisticsValidator = z.object({
  executionDurationMs: z.number().optional(),
  totalSlotMs: z.number().optional(),
  rowsProcessed: z.number().optional(),
  bytesProcessed: z.number().optional(),
  bytesBilled: z.number().optional(),
  rowsInserted: z.number().optional(),
  warehouseCachedResult: z.boolean().optional(),
  partitionsUsed: z.boolean().optional(),
  physicalWrittenBytes: z.number().optional(),
  // Partitions read vs. available, to measure pruning (BigQuery reports only partitions read)
  partitionsScanned: z.number().optional(),
  partitionsTotal: z.number().optional(),
});

// One row per query GrowthBook sends to a warehouse, including queries with no Query document
export const queryUsageValidator = baseSchema
  .extend({
    datasource: z.string(),
    datasourceType: z.string(),
    queryType: z.string(),
    status: z.enum(["succeeded", "failed"]),
    startedAt: z.date(),
    durationMs: z.number(),
    // The warehouse's own job/query ID, for joining with its query history
    externalId: z.string().optional(),
    queryId: z.string().optional(),
    experimentId: z.string().optional(),
    factTableIds: z.array(z.string()).optional(),
    snapshotTriggeredBy: z.string().optional(),
    snapshotType: z.string().optional(),
    userId: z.string().optional(),
    rowsReturned: z.number().optional(),
    error: z.string().optional(),
    // The warehouse's own error code, e.g. Snowflake 002003 or BigQuery notFound
    errorCode: z.string().optional(),
    statistics: queryStatisticsValidator.optional(),
  })
  .strict();
