import { z } from "zod";
import { baseSchema } from "./base-model";
import { queryPointerValidator, queryStatusValidator } from "./queries";
import { componentSchema } from "./openapi-helpers";

// One materialization run per (organization, datasourceId, factTableId,
// idType). Fed to the QueryRunner (satisfies `InterfaceWithQueries`); durable
// state lives on the AggregatedFactTable registry doc, updated when a run finishes.
const aggregatedFactTableRun = z
  .object({
    aggregatedFactTableId: z.string(),

    // Denormalized refs so runs can be queried by (organization, factTableId,
    // idType) without joining the registry.
    datasourceId: z.string(),
    factTableId: z.string(),
    idType: z.string(),

    mode: z.enum(["incremental", "restate"]),

    // Registry lock token, so an out-of-process reaper (expireOldQueries) can
    // release the exact lock this run acquired when finalizing a stalled run.
    executionId: z.string(),

    queries: z.array(queryPointerValidator),
    runStarted: z.date().nullable(),
    finishedAt: z.date().nullable(),
    error: z.string().nullable(),

    result: z
      .object({
        lastMaxTimestamp: z.date().nullable(),
        firstEventDate: z.date().nullable(),
        lastEventDate: z.date().nullable(),
      })
      .nullable(),
  })
  .strict();

export const aggregatedFactTableRunValidator = baseSchema
  .extend(aggregatedFactTableRun.shape)
  .strict();

export type AggregatedFactTableRunInterface = z.infer<
  typeof aggregatedFactTableRunValidator
>;

export const aggregatedTableRefreshTriggerStatusValidator = z.enum([
  "started",
  "failed",
  "skipped",
]);

export const aggregatedTableRefreshSkipReasonValidator = z.enum([
  "already-in-progress",
  "datasource-not-found",
  "pipeline-not-configured",
  "unsupported-datasource",
  "no-eligible-metrics",
]);

export type AggregatedTableRefreshSkipReason = z.infer<
  typeof aggregatedTableRefreshSkipReasonValidator
>;

const apiAggregatedTableRunSummaryFields = {
  id: z.string().describe("The run id (e.g. aftr_...)"),
  idType: z.string().describe("The id type this run materialized"),
  mode: z
    .enum(["incremental", "restate"])
    .describe("Whether this run appended new data or rebuilt the table"),
  status: queryStatusValidator.describe(
    "Overall run status derived from its warehouse queries",
  ),
  runStarted: z
    .string()
    .meta({ format: "date-time" })
    .nullable()
    .describe("When query execution began"),
  dateCreated: z
    .string()
    .meta({ format: "date-time" })
    .describe("When the run record was created"),
  finishedAt: z
    .string()
    .meta({ format: "date-time" })
    .nullable()
    .describe("When the run finished, or null if still in progress"),
  error: z.string().nullable().describe("Error message when the run failed"),
  queryIds: z
    .array(z.string())
    .describe(
      "Warehouse query ids for this run; poll each via GET /queries/{id} for per-query status",
    ),
};

export const apiAggregatedTableRunSummaryValidator = componentSchema(
  "AggregatedTableRunSummary",
  z.object(apiAggregatedTableRunSummaryFields).strict(),
);

export type ApiAggregatedTableRunSummary = z.infer<
  typeof apiAggregatedTableRunSummaryValidator
>;

export const apiAggregatedTableRunValidator = componentSchema(
  "AggregatedTableRun",
  z
    .object({
      ...apiAggregatedTableRunSummaryFields,
      factTableId: z.string(),
      datasourceId: z.string(),
      result: z
        .object({
          lastMaxTimestamp: z.string().meta({ format: "date-time" }).nullable(),
          firstEventDate: z.string().meta({ format: "date-time" }).nullable(),
          lastEventDate: z.string().meta({ format: "date-time" }).nullable(),
        })
        .nullable()
        .describe("Coverage written on success, or null while running/failed"),
    })
    .strict(),
);

export type ApiAggregatedTableRun = z.infer<
  typeof apiAggregatedTableRunValidator
>;

export const apiAggregatedTableRefreshTriggerValidator = componentSchema(
  "AggregatedTableRefreshTrigger",
  z
    .object({
      idType: z.string().describe("The id type this refresh targets"),
      runId: z
        .string()
        .nullable()
        .describe(
          "The id of the run, set when status is started or failed and null when skipped.",
        ),
      status: aggregatedTableRefreshTriggerStatusValidator.describe(
        "Whether a refresh was started, failed to be created, or was skipped",
      ),
      reason: aggregatedTableRefreshSkipReasonValidator
        .nullable()
        .describe("Why the refresh was skipped, when status is skipped."),
      error: z
        .string()
        .nullable()
        .describe("The error message when status is failed; null otherwise."),
    })
    .strict(),
);

export type ApiAggregatedTableRefreshTrigger = z.infer<
  typeof apiAggregatedTableRefreshTriggerValidator
>;
