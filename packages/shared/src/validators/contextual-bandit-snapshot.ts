import { z } from "zod";
import { baseSchema } from "./base-model";

/** Pointer to a single query that ran as part of a CBS. */
export const cbsQueryEntryValidator = z.object({
  query: z.string(),
  status: z.enum(["running", "succeeded", "failed"]),
  /** Wall-clock ms from start to finish (null while running). */
  durationMs: z.number().nullable().optional(),
  error: z.string().optional(),
});
export type CbsQueryEntry = z.infer<typeof cbsQueryEntryValidator>;

export const contextualBanditSnapshotValidator = baseSchema
  .extend({
    experiment: z.string(),
    phase: z.number(),
    status: z.enum(["pending", "running", "success", "error", "partial"]),
    error: z.string().optional(),
    queries: z.array(cbsQueryEntryValidator),
    /**
     * Frozen copy of the CB settings at the time the snapshot was created.
     * Stored as an opaque blob so the snapshot remains self-contained.
     */
    frozenSettings: z.record(z.string(), z.unknown()).optional(),
    /** ID of the ContextualBanditEvent produced by this snapshot (null until success). */
    contextualBanditEventId: z.string().nullable().optional(),
    /** True when arm weights were actually changed by this run. */
    weightsWereUpdated: z.boolean().optional(),
    triggeredBy: z.enum(["manual", "schedule"]).optional(),
  })
  .strict();

export type ContextualBanditSnapshotInterface = z.infer<
  typeof contextualBanditSnapshotValidator
>;
