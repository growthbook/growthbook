import { z } from "zod";

const baseBlockInterface = z
  .object({
    type: z.string(),
  })
  .strict();

const markdownBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("markdown"),
    content: z.string(),
  })
  .strict();

const metadataBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("metadata"),
    subtype: z.enum(["description", "hypothesis"]),
  })
  .strict();

const variationImageBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("variation-image"),
    variationIds: z.array(z.string()),
  })
  .strict();

const metricBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("metric"),
    metricId: z.string(),
    variationIds: z.array(z.string()),
    baselineRow: z.number(),
  })
  .strict();

const dimensionBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("dimension"),
    dimensionId: z.string(),
    dimensionValues: z.array(z.string()),
    metricId: z.string(),
    variationIds: z.array(z.string()),
    baselineRow: z.number(),
    differenceType: z.enum(["absolute", "relative", "scaled"]),
  })
  .strict();

const timeSeriesBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("time-series"),
    metricId: z.string(),
    variationIds: z.array(z.string()),
    dateStart: z.date(),
    dateEnd: z.date(),
  })
  .strict();

export const dashboardBlockInterface = z.discriminatedUnion("type", [
  markdownBlockInterface,
  metadataBlockInterface,
  variationImageBlockInterface,
  metricBlockInterface,
  dimensionBlockInterface,
  timeSeriesBlockInterface,
]);

export type DashboardBlockInterface = z.infer<typeof dashboardBlockInterface>;
