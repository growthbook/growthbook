import { z } from "zod";
import { DistributiveOmit } from "back-end/src/util/types";

const baseBlockInterface = z
  .object({
    organization: z.string(),
    id: z.string(),
    uid: z.string(),
    type: z.string(),
    title: z.string(),
    description: z.string(),
    snapshotId: z.string().optional(),
  })
  .strict();

const markdownBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("markdown"),
    content: z.string(),
  })
  .strict();

export type MarkdownBlockInterface = z.infer<typeof markdownBlockInterface>;

const descriptionBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("metadata-description"),
    experimentId: z.string(),
  })
  .strict();

export type DescriptionBlockInterface = z.infer<
  typeof descriptionBlockInterface
>;

const hypothesisBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("metadata-hypothesis"),
    experimentId: z.string(),
  })
  .strict();

export type HypothesisBlockInterface = z.infer<typeof hypothesisBlockInterface>;

const variationImageBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("variation-image"),
    experimentId: z.string(),
    variationIds: z.array(z.string()),
  })
  .strict();

export type VariationImageBlockInterface = z.infer<
  typeof variationImageBlockInterface
>;

const metricBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("metric"),
    experimentId: z.string(),
    metricIds: z.array(z.string()),
    variationIds: z.array(z.string()),
    baselineRow: z.number(),
    differenceType: z.enum(["absolute", "relative", "scaled"]),
    columnsFilter: z.array(
      z.enum([
        "Variation Names",
        "Baseline Average",
        "Variation Averages",
        "Chance to Win",
        "CI Graph",
        "Lift",
      ])
    ),
    snapshotId: z.string(),
  })
  .strict();

export type MetricBlockInterface = z.infer<typeof metricBlockInterface>;

const dimensionBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("dimension"),
    experimentId: z.string(),
    dimensionId: z.string(),
    dimensionValues: z.array(z.string()),
    metricIds: z.array(z.string()),
    variationIds: z.array(z.string()),
    baselineRow: z.number(),
    differenceType: z.enum(["absolute", "relative", "scaled"]),
    columnsFilter: z.array(
      z.enum([
        "Variation Names",
        "Baseline Average",
        "Variation Averages",
        "Chance to Win",
        "CI Graph",
        "Lift",
      ])
    ),
    snapshotId: z.string(),
  })
  .strict();

export type DimensionBlockInterface = z.infer<typeof dimensionBlockInterface>;

const timeSeriesBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("time-series"),
    experimentId: z.string(),
    metricId: z.string(),
    variationIds: z.array(z.string()),
    snapshotId: z.string(),
  })
  .strict();

export type TimeSeriesBlockInterface = z.infer<typeof timeSeriesBlockInterface>;

const trafficTableBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("traffic-table"),
    experimentId: z.string(),
  })
  .strict();

export type TrafficTableBlockInterface = z.infer<
  typeof trafficTableBlockInterface
>;

const trafficGraphBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("traffic-graph"),
    experimentId: z.string(),
  })
  .strict();

export type TrafficGraphBlockInterface = z.infer<
  typeof trafficGraphBlockInterface
>;

const sqlExplorerBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("sql-explorer"),
    savedQueryId: z.string(),
    dataVizConfigIndex: z.number(),
  })
  .strict();

export type SqlExplorerBlockInterface = z.infer<
  typeof sqlExplorerBlockInterface
>;

export const dashboardBlockInterface = z.discriminatedUnion("type", [
  markdownBlockInterface,
  descriptionBlockInterface,
  hypothesisBlockInterface,
  variationImageBlockInterface,
  metricBlockInterface,
  dimensionBlockInterface,
  timeSeriesBlockInterface,
  trafficTableBlockInterface,
  trafficGraphBlockInterface,
  sqlExplorerBlockInterface,
]);

export type DashboardBlockInterface = z.infer<typeof dashboardBlockInterface>;
export type DashboardBlockType = DashboardBlockInterface["type"];

// Utility type for the discriminated union without the backend-generated fields
const createOmits = {
  id: true,
  uid: true,
  organization: true,
} as const;
export const createDashboardBlockInterface = z.discriminatedUnion("type", [
  markdownBlockInterface.omit(createOmits),
  descriptionBlockInterface.omit(createOmits),
  hypothesisBlockInterface.omit(createOmits),
  variationImageBlockInterface.omit(createOmits),
  metricBlockInterface.omit(createOmits),
  dimensionBlockInterface.omit(createOmits),
  timeSeriesBlockInterface.omit(createOmits),
  trafficTableBlockInterface.omit(createOmits),
  trafficGraphBlockInterface.omit(createOmits),
  sqlExplorerBlockInterface.omit(createOmits),
]);
export type CreateDashboardBlockInterface = z.infer<
  typeof createDashboardBlockInterface
>;

// Allow templates to specify a partial of the individual block fields
export const dashboardBlockPartial = z.discriminatedUnion("type", [
  markdownBlockInterface.omit(createOmits).partial().required({ type: true }),
  descriptionBlockInterface
    .omit(createOmits)
    .partial()
    .required({ type: true }),
  hypothesisBlockInterface.omit(createOmits).partial().required({ type: true }),
  variationImageBlockInterface
    .omit(createOmits)
    .partial()
    .required({ type: true }),
  metricBlockInterface.omit(createOmits).partial().required({ type: true }),
  dimensionBlockInterface.omit(createOmits).partial().required({ type: true }),
  timeSeriesBlockInterface.omit(createOmits).partial().required({ type: true }),
  trafficTableBlockInterface
    .omit(createOmits)
    .partial()
    .required({ type: true }),
  trafficGraphBlockInterface
    .omit(createOmits)
    .partial()
    .required({ type: true }),
  sqlExplorerBlockInterface
    .omit(createOmits)
    .partial()
    .required({ type: true }),
]);

export type DashboardBlockData<
  T extends DashboardBlockInterface
> = DistributiveOmit<T, "id" | "uid" | "organization">;

export type DashboardBlockInterfaceOrData<T extends DashboardBlockInterface> =
  | T
  | DashboardBlockData<T>;
