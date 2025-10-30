import { z } from "zod";
import { DistributiveOmit } from "shared/util";
import {
  differenceTypes,
  metricSelectors,
  pinSources,
} from "shared/enterprise";
import {
  metricAnalysisSettingsStringDatesValidator,
  metricAnalysisSettingsValidator,
} from "back-end/src/routers/metric-analysis/metric-analysis.validators";

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

const metricSliceSettingsInterface = z.object({
  pinSource: z.enum(pinSources),
  pinnedMetricSlices: z.array(z.string()),
});

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
  .merge(metricSliceSettingsInterface)
  .strict();

export type ExperimentMetricBlockInterface = z.infer<
  typeof experimentMetricBlockInterface
>;
const legacyExperimentMetricBlockInterface = experimentMetricBlockInterface
  .omit({ metricSelector: true, pinSource: true, pinnedMetricSlices: true })
  .extend({
    metricSelector: z.enum(metricSelectors).optional(),
  })
  .merge(metricSliceSettingsInterface.partial());
export type LegacyExperimentMetricBlockInterface = z.infer<
  typeof legacyExperimentMetricBlockInterface
>;

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
const legacyExperimentDimensionBlockInterface =
  experimentDimensionBlockInterface.omit({ metricSelector: true }).extend({
    metricSelector: z.enum(metricSelectors).optional(),
  });
export type LegacyExperimentDimensionBlockInterface = z.infer<
  typeof legacyExperimentDimensionBlockInterface
>;

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
  .merge(metricSliceSettingsInterface)
  .strict();

export type ExperimentTimeSeriesBlockInterface = z.infer<
  typeof experimentTimeSeriesBlockInterface
>;
const legacyExperimentTimeSeriesBlockInterface =
  experimentTimeSeriesBlockInterface
    .omit({ metricSelector: true, pinSource: true, pinnedMetricSlices: true })
    .extend({
      metricSelector: z.enum(metricSelectors).optional(),
    })
    .merge(metricSliceSettingsInterface.partial());
export type LegacyExperimentTimeSeriesBlockInterface = z.infer<
  typeof legacyExperimentTimeSeriesBlockInterface
>;

const sqlExplorerBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("sql-explorer"),
    savedQueryId: z.string(),
    dataVizConfigIndex: z.number().optional(), // Deprecated with the release of product analytics dashboards as we now allow users to show multiple visualizations
    blockConfig: z.array(z.string()).optional(),
  })
  .strict();

export type SqlExplorerBlockInterface = z.infer<
  typeof sqlExplorerBlockInterface
>;

const metricExplorerBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("metric-explorer"),
    factMetricId: z.string(),
    analysisSettings: z.union([
      metricAnalysisSettingsValidator,
      metricAnalysisSettingsStringDatesValidator,
    ]),
    visualizationType: z.enum(["histogram", "bigNumber", "timeseries"]),
    valueType: z.enum(["avg", "sum"]),
    metricAnalysisId: z.string(),
  })
  .strict();

export type MetricExplorerBlockInterface = z.infer<
  typeof metricExplorerBlockInterface
>;

export const dashboardBlockInterface = z.discriminatedUnion("type", [
  markdownBlockInterface,
  experimentMetadataBlockInterface,
  experimentMetricBlockInterface,
  experimentDimensionBlockInterface,
  experimentTimeSeriesBlockInterface,
  experimentTrafficBlockInterface,
  sqlExplorerBlockInterface,
  metricExplorerBlockInterface,
]);
export const legacyDashboardBlockInterface = z.discriminatedUnion("type", [
  legacyExperimentDescriptionBlockInterface,
  legacyExperimentHypothesisBlockInterface,
  legacyExperimentVariationImageBlockInterface,
  legacyExperimentMetricBlockInterface,
  legacyExperimentDimensionBlockInterface,
  legacyExperimentTimeSeriesBlockInterface,
  legacyExperimentTrafficGraphBlockInterface,
  legacyExperimentTrafficTableBlockInterface,
]);

export type DashboardBlockInterface = z.infer<typeof dashboardBlockInterface>;
export type DashboardBlockType = DashboardBlockInterface["type"];

export type LegacyDashboardBlockInterface = z.infer<
  typeof legacyDashboardBlockInterface
>;

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
  metricExplorerBlockInterface.omit(createOmits),
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
  metricExplorerBlockInterface
    .omit(createOmits)
    .partial()
    .required({ type: true }),
]);

export type DashboardBlockData<T extends DashboardBlockInterface> =
  DistributiveOmit<T, "id" | "uid" | "organization">;

export type DashboardBlockInterfaceOrData<T extends DashboardBlockInterface> =
  | T
  | DashboardBlockData<T>;
