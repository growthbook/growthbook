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

export const experimentSnapshotMetricResultValidator = z
  .object({
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    id: z.string(),
    snapshotId: z.string(),
    analysisIndex: z.number(),
    metricId: z.string(),
    parentMetricId: z.string(),
    dimensionName: z.string(),
    dimensionValue: z.string(),
    srm: z.number(),
    variations: z.array(
      z
        .object({
          users: z.number(),
          metric: z.unknown(),
        })
        .strict(),
    ),
  })
  .strict();
