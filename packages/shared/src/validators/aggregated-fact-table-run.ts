import { z } from "zod";
import { baseSchema } from "./base-model";
import { queryPointerValidator } from "./queries";

// A single materialization run for one (organization, datasourceId,
// factTableId, idType). One doc per run, so runs can be referenced later (e.g.
// the debugging run-history selector). This is the document fed to the
// QueryRunner (it satisfies the `InterfaceWithQueries` contract via `queries` +
// `runStarted`). The durable state (watermark/coverage/metricState/lock) lives
// on the AggregatedFactTable registry doc, which is updated when a run finishes.
const aggregatedFactTableRun = z
  .object({
    // Registry doc this run materializes.
    aggregatedFactTableId: z.string(),

    // Denormalized refs so runs can be queried/indexed by
    // (organization, factTableId, idType) without joining the registry.
    datasourceId: z.string(),
    factTableId: z.string(),
    idType: z.string(),

    // Whether this run appended incrementally or fully restated the table.
    mode: z.enum(["incremental", "restate"]),

    // The registry lock token this run holds. Stored so an out-of-process
    // reaper (expireOldQueries) can release the exact lock this run acquired
    // when finalizing a stalled/orphaned run.
    executionId: z.string(),

    // Tracked async queries for this run (QueryRunner `InterfaceWithQueries`).
    queries: z.array(queryPointerValidator),
    runStarted: z.date().nullable(),
    finishedAt: z.date().nullable(),
    error: z.string().nullable(),

    // Snapshot of the coverage this run computed (handy for the history UI).
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
