import { z } from "zod";
import { baseSchema } from "./base-model";
import { queryPointerValidator } from "./queries";

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
