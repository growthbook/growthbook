import { z } from "zod";

export const snapshotAnalysisOverflowValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    snapshot: z.string(),
    chunkIndex: z.number(),
    // JSON-serialized slice of the snapshot's `analyses` array.
    // All chunks for a snapshot concatenated in chunkIndex order yield the
    // full JSON string.
    data: z.string(),
  })
  .strict();

export type SnapshotAnalysisOverflowInterface = z.infer<
  typeof snapshotAnalysisOverflowValidator
>;
