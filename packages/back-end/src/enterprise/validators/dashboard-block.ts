import { z } from "zod";
import { DistributiveOmit } from "shared/util";
import { differenceTypes, metricSelectors } from "shared/enterprise";

const baseBlockInterface = z
  .object({
    organization: z.string(),
    id: z.string(),
    uid: z.string(), // Enables sharing/linking to single blocks in future
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

// Begin deprecated block types
const legacyExperimentDescriptionBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("experiment-description"),
    experimentId: z.string(),
  })
  .strict();
export type LegacyExperimentDescriptionBlockInterface = z.infer<
  typeof legacyExperimentDescriptionBlockInterface
>;
const legacyExperimentHypothesisBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("experiment-hypothesis"),
    experimentId: z.string(),
  })
  .strict();
export type LegacyExperimentHypothesisBlockInterface = z.infer<
  typeof legacyExperimentHypothesisBlockInterface
>;
const legacyExperimentVariationImageBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("experiment-variation-image"),
    experimentId: z.string(),
    variationIds: z.array(z.string()),
  })
  .strict();
export type LegacyExperimentVariationImageBlockInterface = z.infer<
  typeof legacyExperimentVariationImageBlockInterface
>;
const legacyExperimentTrafficTableBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("experiment-traffic-table"),
    experimentId: z.string(),
  })
  .strict();

export type LegacyExperimentTrafficTableBlockInterface = z.infer<
  typeof legacyExperimentTrafficTableBlockInterface
>;
const legacyExperimentTrafficGraphBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("experiment-traffic-graph"),
    experimentId: z.string(),
  })
  .strict();

export type LegacyExperimentTrafficGraphBlockInterface = z.infer<
  typeof legacyExperimentTrafficGraphBlockInterface
>;
// End deprecated block types

const experimentMetadataBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("experiment-metadata"),
    experimentId: z.string(),
    showDescription: z.boolean(),
    showHypothesis: z.boolean(),
    showVariationImages: z.boolean(),
    variationIds: z.array(z.string()).optional(),
  })
  .strict();
export type ExperimentMetadataBlockInterface = z.infer<
  typeof experimentMetadataBlockInterface
>;

const experimentTrafficBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("experiment-traffic"),
    experimentId: z.string(),
    showTable: z.boolean(),
    showTimeseries: z.boolean(),
  })
  .strict();
export type ExperimentTrafficBlockInterface = z.infer<
  typeof experimentTrafficBlockInterface
>;

const experimentMetricBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("experiment-metric"),
    experimentId: z.string(),
    metricSelector: z.enum(metricSelectors),
    metricIds: z.array(z.string()).optional(),
    variationIds: z.array(z.string()),
    baselineRow: z.number(),
    differenceType: z.enum(differenceTypes),
    columnsFilter: z.array(
      z.enum([
        "Metric & Variation Names",
        "Baseline Average",
        "Variation Averages",
        "Chance to Win",
        "CI Graph",
        "Lift",
      ]),
    ),
    snapshotId: z.string(),
  })
  .strict();

export type ExperimentMetricBlockInterface = z.infer<
  typeof experimentMetricBlockInterface
>;
type LegacyExperimentMetricBlockInterface = Omit<
  ExperimentMetricBlockInterface,
  "metricSelector"
> & {
  metricSelector?: (typeof metricSelectors)[number];
};

const experimentDimensionBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("experiment-dimension"),
    experimentId: z.string(),
    dimensionId: z.string(),
    dimensionValues: z.array(z.string()),
    metricSelector: z.enum(metricSelectors),
    metricIds: z.array(z.string()).optional(),
    variationIds: z.array(z.string()),
    baselineRow: z.number(),
    differenceType: z.enum(differenceTypes),
    columnsFilter: z.array(
      z.enum([
        "Metric & Variation Names",
        "Baseline Average",
        "Variation Averages",
        "Chance to Win",
        "CI Graph",
        "Lift",
      ]),
    ),
    snapshotId: z.string(),
  })
  .strict();

export type ExperimentDimensionBlockInterface = z.infer<
  typeof experimentDimensionBlockInterface
>;
type LegacyExperimentDimensionBlockInterface = Omit<
  ExperimentDimensionBlockInterface,
  "metricSelector"
> & {
  metricSelector?: (typeof metricSelectors)[number];
};

const experimentTimeSeriesBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("experiment-time-series"),
    experimentId: z.string(),
    metricId: z.string().optional(), // Deprecated
    metricSelector: z.enum(metricSelectors),
    metricIds: z.array(z.string()).optional(),
    variationIds: z.array(z.string()),
    snapshotId: z.string(),
  })
  .strict();

export type ExperimentTimeSeriesBlockInterface = z.infer<
  typeof experimentTimeSeriesBlockInterface
>;
type LegacyExperimentTimeSeriesBlockInterface = Omit<
  ExperimentTimeSeriesBlockInterface,
  "metricIds" | "metricSelector"
> & {
  metricIds?: string[];
  metricId: string;
  metricSelector?: (typeof metricSelectors)[number];
};

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
  experimentMetadataBlockInterface,
  experimentMetricBlockInterface,
  experimentDimensionBlockInterface,
  experimentTimeSeriesBlockInterface,
  experimentTrafficBlockInterface,
  sqlExplorerBlockInterface,
]);

export type DashboardBlockInterface = z.infer<typeof dashboardBlockInterface>;
export type DashboardBlockType = DashboardBlockInterface["type"];

export type LegacyDashboardBlockInterface =
  | Exclude<
      DashboardBlockInterface,
      | ExperimentMetricBlockInterface
      | ExperimentDimensionBlockInterface
      | ExperimentTimeSeriesBlockInterface
      | ExperimentMetadataBlockInterface
      | ExperimentTrafficBlockInterface
    >
  | LegacyExperimentMetricBlockInterface
  | LegacyExperimentDimensionBlockInterface
  | LegacyExperimentTimeSeriesBlockInterface
  | LegacyExperimentDescriptionBlockInterface
  | LegacyExperimentHypothesisBlockInterface
  | LegacyExperimentVariationImageBlockInterface
  | LegacyExperimentTrafficGraphBlockInterface
  | LegacyExperimentTrafficTableBlockInterface;

// Utility type for the discriminated union without the backend-generated fields
const createOmits = {
  id: true,
  uid: true,
  organization: true,
} as const;
export const createDashboardBlockInterface = z.discriminatedUnion("type", [
  markdownBlockInterface.omit(createOmits),
  experimentMetadataBlockInterface.omit(createOmits),
  experimentMetricBlockInterface.omit(createOmits),
  experimentDimensionBlockInterface.omit(createOmits),
  experimentTimeSeriesBlockInterface.omit(createOmits),
  experimentTrafficBlockInterface.omit(createOmits),
  sqlExplorerBlockInterface.omit(createOmits),
]);
export type CreateDashboardBlockInterface = z.infer<
  typeof createDashboardBlockInterface
>;

// Allow templates to specify a partial of the individual block fields
export const dashboardBlockPartial = z.discriminatedUnion("type", [
  markdownBlockInterface.omit(createOmits).partial().required({ type: true }),
  experimentMetadataBlockInterface
    .omit(createOmits)
    .partial()
    .required({ type: true }),
  experimentMetricBlockInterface
    .omit(createOmits)
    .partial()
    .required({ type: true }),
  experimentDimensionBlockInterface
    .omit(createOmits)
    .partial()
    .required({ type: true }),
  experimentTimeSeriesBlockInterface
    .omit(createOmits)
    .partial()
    .required({ type: true }),
  experimentTrafficBlockInterface
    .omit(createOmits)
    .partial()
    .required({ type: true }),
  sqlExplorerBlockInterface
    .omit(createOmits)
    .partial()
    .required({ type: true }),
]);

export type DashboardBlockData<T extends DashboardBlockInterface> =
  DistributiveOmit<T, "id" | "uid" | "organization">;

export type DashboardBlockInterfaceOrData<T extends DashboardBlockInterface> =
  | T
  | DashboardBlockData<T>;
