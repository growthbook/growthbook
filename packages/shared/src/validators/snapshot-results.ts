import { z } from "zod";

export const snapshotResultChunkValidator = z
  .object({
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    id: z.string(),
    snapshotId: z.string(),
    chunkNumber: z.number(),
    metricIds: z.array(z.string()),
    numRows: z.number(),
    data: z.record(z.string(), z.array(z.unknown())),
    metaNumRows: z.number(),
    metaData: z.record(z.string(), z.array(z.unknown())),
  })
  .strict();

export type SnapshotResultChunkInterface = z.infer<
  typeof snapshotResultChunkValidator
>;
