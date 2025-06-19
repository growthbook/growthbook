import { z } from "zod";
import { DistributiveOmit } from "back-end/src/util/types";

const baseBlockInterface = z
  .object({
    organization: z.string(),
    id: z.string(),
    uid: z.string(),
    type: z.string(),
  })
  .strict();

const markdownBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("markdown"),
    content: z.string(),
  })
  .strict();

export type MarkdownBlockInterface = z.infer<typeof markdownBlockInterface>;

const metadataBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("metadata"),
    subtype: z.enum(["description", "hypothesis"]),
    experimentId: z.string(),
  })
  .strict();

export type MetadataBlockInterface = z.infer<typeof metadataBlockInterface>;

const variationImageBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("variation-image"),
    experiment: z.string(),
    variationIds: z.array(z.string()),
  })
  .strict();

export type VariationImageBlockInterface = z.infer<
  typeof variationImageBlockInterface
>;

const metricBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("metric"),
    metricId: z.string().optional(),
    variationIds: z.array(z.string()).optional(),
    baselineRow: z.number().optional(),
  })
  .strict();

export type MetricBlockInterface = z.infer<typeof metricBlockInterface>;

const dimensionBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("dimension"),
    dimensionId: z.string().optional(),
    dimensionValues: z.array(z.string()).optional(),
    metricId: z.string().optional(),
    variationIds: z.array(z.string()).optional(),
    baselineRow: z.number().optional(),
    differenceType: z.enum(["absolute", "relative", "scaled"]).optional(),
  })
  .strict();

export type DimensionBlockInterface = z.infer<typeof dimensionBlockInterface>;

const timeSeriesBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("time-series"),
    metricId: z.string().optional(),
    variationIds: z.array(z.string()).optional(),
    dateStart: z.date().optional(),
    dateEnd: z.date().optional(),
  })
  .strict();

export type TimeSeriesBlockInterface = z.infer<typeof timeSeriesBlockInterface>;

export const dashboardBlockInterface = z.discriminatedUnion("type", [
  markdownBlockInterface,
  metadataBlockInterface,
  variationImageBlockInterface,
  metricBlockInterface,
  dimensionBlockInterface,
  timeSeriesBlockInterface,
]);

export type DashboardBlockInterface = z.infer<typeof dashboardBlockInterface>;

// Utility types for the discriminated union without the backend-generated fields and a generic
// type for individual block types
const createOmits = {
  id: true,
  uid: true,
  organization: true,
} as const;
export const createDashboardBlockInterface = z.discriminatedUnion("type", [
  markdownBlockInterface.omit(createOmits),
  metadataBlockInterface.omit(createOmits),
  variationImageBlockInterface.omit(createOmits),
  metricBlockInterface.omit(createOmits),
  dimensionBlockInterface.omit(createOmits),
  timeSeriesBlockInterface.omit(createOmits),
]);

export type CreateDashboardBlockInterface = z.infer<
  typeof createDashboardBlockInterface
>;
export type DashboardBlockData<T extends DashboardBlockInterface> =
  | T
  | DistributiveOmit<T, "id" | "uid" | "organization">;
