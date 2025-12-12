import { z } from "zod";

export const queryStatusValidator = z.enum([
  "queued",
  "running",
  "failed",
  "partially-succeeded",
  "succeeded",
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
