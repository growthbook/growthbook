import { z } from "zod";
import { DistributiveOmit } from "shared/util";
import {
  metricAnalysisSettingsStringDatesValidator,
  metricAnalysisSettingsValidator,
} from "../../validators/metric-analysis";
import {
  metricExplorationConfigValidator,
  factTableExplorationConfigValidator,
  dataSourceExplorationConfigValidator,
  explorationDateRangeValidator,
} from "../../validators/product-analytics";
import { differenceTypes, pinSources } from "../dashboards/utils";

// Hard cap on the canonical column count. Used as the zod ceiling on `w`/`x`
// and as the default the back-end clamps to. Height is intentionally
// uncapped - users can grow a block as tall as they need.
export const DASHBOARD_GRID_COLS = 24;

// Per-block layout only stores user-driven coordinates. Per-type sizing
// constraints (initial w/h, drag/resize min) live in
// DEFAULT_BLOCK_SIZE_BY_TYPE below so we have one source of truth and existing
// dashboards pick up tweaks automatically. `.strict()` is intentionally
// omitted so legacy docs with stale minW/maxW/etc. quietly strip on parse.
export const blockLayoutInterface = z.object({
  x: z
    .number()
    .int()
    .min(0)
    .max(DASHBOARD_GRID_COLS - 1),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(DASHBOARD_GRID_COLS),
  h: z.number().int().min(1),
  static: z.boolean().optional(),
});

export type BlockLayout = z.infer<typeof blockLayoutInterface>;

// Default size and drag/resize minimums per block type. The maximum width is
// always DASHBOARD_GRID_COLS, so we don't repeat it here. Height has no upper
// bound. `minW` values are tuned against the canonical 24-column grid -
// e.g. 12 = half-width, 8 = one-third, 4 = one-sixth.
export type BlockSizeBounds = {
  w: number;
  h: number;
  minW: number;
  minH: number;
};

export const DEFAULT_BLOCK_SIZE_BY_TYPE: Record<
  DashboardBlockType,
  BlockSizeBounds
> = {
  markdown: { w: DASHBOARD_GRID_COLS, h: 3, minW: 4, minH: 2 },
  "experiment-metadata": { w: DASHBOARD_GRID_COLS, h: 8, minW: 12, minH: 4 },
  "experiment-traffic": { w: DASHBOARD_GRID_COLS, h: 8, minW: 12, minH: 4 },
  "experiment-metric": { w: DASHBOARD_GRID_COLS, h: 8, minW: 12, minH: 4 },
  "experiment-dimension": { w: DASHBOARD_GRID_COLS, h: 8, minW: 12, minH: 4 },
  "experiment-time-series": { w: DASHBOARD_GRID_COLS, h: 8, minW: 12, minH: 4 },
  "sql-explorer": { w: DASHBOARD_GRID_COLS, h: 8, minW: 8, minH: 4 },
  "metric-explorer": { w: DASHBOARD_GRID_COLS, h: 8, minW: 8, minH: 4 },
  "metric-exploration": { w: DASHBOARD_GRID_COLS, h: 8, minW: 8, minH: 4 },
  "fact-table-exploration": { w: DASHBOARD_GRID_COLS, h: 8, minW: 8, minH: 4 },
  "data-source-exploration": { w: DASHBOARD_GRID_COLS, h: 8, minW: 8, minH: 4 },
};

export function getBlockSizeBounds(
  blockType: DashboardBlockType | string,
): BlockSizeBounds {
  return (
    DEFAULT_BLOCK_SIZE_BY_TYPE[blockType as DashboardBlockType] ??
    DEFAULT_BLOCK_SIZE_BY_TYPE.markdown
  );
}

const baseBlockInterface = z
  .object({
    organization: z.string(),
    id: z.string(),
    uid: z.string(), // Enables sharing/linking to single blocks in future
    type: z.string(),
    title: z.string(),
    description: z.string(),
    snapshotId: z.string().optional(),
    layout: blockLayoutInterface.optional(),
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
const legacyExperimentHypothesisBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("experiment-hypothesis"),
    experimentId: z.string(),
  })
  .strict();
const legacyExperimentVariationImageBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("experiment-variation-image"),
    experimentId: z.string(),
    variationIds: z.array(z.string()),
  })
  .strict();
const legacyExperimentTrafficTableBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("experiment-traffic-table"),
    experimentId: z.string(),
  })
  .strict();

const legacyExperimentTrafficGraphBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("experiment-traffic-graph"),
    experimentId: z.string(),
  })
  .strict();

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
    metricIds: z.array(z.string()),
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
    sliceTagsFilter: z.array(z.string()),
    metricTagFilter: z.array(z.string()),
    sortBy: z
      .enum(["metrics", "metricTags", "significance", "change"])
      .nullable(),
    sortDirection: z.enum(["asc", "desc"]).nullable(),
  })
  .strict();

export type ExperimentMetricBlockInterface = z.infer<
  typeof experimentMetricBlockInterface
>;
const legacyExperimentMetricBlockInterface = experimentMetricBlockInterface
  .omit({ sliceTagsFilter: true })
  .extend({
    metricSelector: z
      .enum([
        "experiment-goal",
        "experiment-secondary",
        "experiment-guardrail",
        "custom",
      ] as [string, ...string[]])
      .optional(),
    pinSource: z.enum(pinSources).optional(),
    pinnedMetricSlices: z.array(z.string()).optional(),
    sliceTagsFilter: z.array(z.string()).nullable().optional(),
  });

const experimentDimensionBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("experiment-dimension"),
    experimentId: z.string(),
    dimensionId: z.string(),
    dimensionValues: z.array(z.string()),
    metricIds: z.array(z.string()),
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
    metricTagFilter: z.array(z.string()),
    sortBy: z
      .enum(["metrics", "metricTags", "significance", "change"])
      .nullable(),
    sortDirection: z.enum(["asc", "desc"]).nullable(),
  })
  .strict();

export type ExperimentDimensionBlockInterface = z.infer<
  typeof experimentDimensionBlockInterface
>;
const legacyExperimentDimensionBlockInterface =
  experimentDimensionBlockInterface.extend({
    metricSelector: z
      .enum([
        "experiment-goal",
        "experiment-secondary",
        "experiment-guardrail",
        "custom",
      ] as [string, ...string[]])
      .optional(),
  });

const experimentTimeSeriesBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("experiment-time-series"),
    experimentId: z.string(),
    metricId: z.string().optional(), // Deprecated
    metricIds: z.array(z.string()),
    variationIds: z.array(z.string()),
    differenceType: z.enum(differenceTypes),
    snapshotId: z.string(),
    sliceTagsFilter: z.array(z.string()),
    metricTagFilter: z.array(z.string()),
    sortBy: z
      .enum(["metrics", "metricTags", "significance", "change"])
      .nullable(),
    sortDirection: z.enum(["asc", "desc"]).nullable(),
  })
  .strict();

export type ExperimentTimeSeriesBlockInterface = z.infer<
  typeof experimentTimeSeriesBlockInterface
>;
const legacyExperimentTimeSeriesBlockInterface =
  experimentTimeSeriesBlockInterface.omit({ sliceTagsFilter: true }).extend({
    metricSelector: z
      .enum([
        "experiment-goal",
        "experiment-secondary",
        "experiment-guardrail",
        "custom",
      ] as [string, ...string[]])
      .optional(),
    pinSource: z.enum(pinSources).optional(),
    pinnedMetricSlices: z.array(z.string()).optional(),
    sliceTagsFilter: z.array(z.string()).nullable().optional(),
  });

const sqlExplorerBlockInterface = baseBlockInterface
  .extend({
    type: z.literal("sql-explorer"),
    savedQueryId: z.string(),
    dataVizConfigIndex: z.number().optional(), // Deprecated with the release of product analytics dashboards as we now allow users to show multiple visualizations
    blockConfig: z.array(z.string()),
  })
  .strict();

const legacySqlExplorerBlockInterface = sqlExplorerBlockInterface
  .omit({ blockConfig: true })
  .extend({
    blockConfig: z.array(z.string()).optional(),
  });

export type SqlExplorerBlockInterface = z.infer<
  typeof sqlExplorerBlockInterface
>;

// Period comparison for a dashboard block. `enabled` turns the comparison on;
// `previousTimeFrame` is only persisted for fixed windows (custom date ranges) —
// predefined/rolling primaries re-derive (and roll) the previous period on each
// refresh. Kept as a structured object so a future dashboard-wide compare toggle
// can resolve to the same shape (see resolveBlockComparison).
export const blockComparisonValidator = z.object({
  enabled: z.boolean(),
  previousTimeFrame: explorationDateRangeValidator.optional(),
});
export type BlockComparison = z.infer<typeof blockComparisonValidator>;

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
    // Compare-to-previous-period. The metric-explorer uses a rolling lookback,
    // so we intentionally don't reserve a `comparison.previousTimeFrame` — the
    // previous window is derived from the current one on each refresh. The id of
    // that derived analysis is tracked here so it can be fetched and rendered.
    comparison: blockComparisonValidator.optional(),
    comparisonMetricAnalysisId: z.preprocess(
      (value) => (value === null ? undefined : value),
      z.string().optional(),
    ),
  })
  .strict();

const apiMetricExplorerBlockInterface = metricExplorerBlockInterface
  .omit({ analysisSettings: true })
  .safeExtend({ analysisSettings: metricAnalysisSettingsStringDatesValidator });

export type MetricExplorerBlockInterface = z.infer<
  typeof metricExplorerBlockInterface
>;

const globalControlSettingsValidator = z
  .object({
    dateRange: z.boolean().optional(),
  })
  .strict();

// Fields shared by every product-analytics exploration block. `comparison` and
// `comparisonExplorerAnalysisId` are optional so pre-existing blocks read as
// "no comparison".
const explorationBlockCommon = {
  explorerAnalysisId: z.string(),
  comparison: blockComparisonValidator.optional(),
  comparisonExplorerAnalysisId: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().optional(),
  ),
  globalControlSettings: globalControlSettingsValidator.optional(),
};

const metricExplorationBlockInterface = baseBlockInterface.extend({
  type: z.literal("metric-exploration"),
  ...explorationBlockCommon,
  config: metricExplorationConfigValidator,
});

const factTableExplorationBlockInterface = baseBlockInterface.extend({
  type: z.literal("fact-table-exploration"),
  ...explorationBlockCommon,
  config: factTableExplorationConfigValidator,
});

const dataSourceExplorationBlockInterface = baseBlockInterface.extend({
  type: z.literal("data-source-exploration"),
  ...explorationBlockCommon,
  config: dataSourceExplorationConfigValidator,
});

/**
 * The effective comparison for an exploration block. Today this is just the
 * block's own setting (saved from the explorer). The `dashboard` arg is the
 * forward-compat seam: a future dashboard-wide compare toggle
 * (`dashboard.comparison`) takes precedence here, so refresh/render code that
 * calls this never has to change. Returns null when comparison is off.
 */
export function resolveBlockComparison(
  block: { comparison?: BlockComparison },
  dashboard?: { comparison?: BlockComparison } | null,
): BlockComparison | null {
  if (dashboard?.comparison?.enabled) return dashboard.comparison;
  if (block.comparison?.enabled) return block.comparison;
  return null;
}

export type MetricExplorationBlockInterface = z.infer<
  typeof metricExplorationBlockInterface
>;
export type FactTableExplorationBlockInterface = z.infer<
  typeof factTableExplorationBlockInterface
>;
export type DataSourceExplorationBlockInterface = z.infer<
  typeof dataSourceExplorationBlockInterface
>;
// Blocks that are the same for both the standard interface and the api interface
const standardAndApiCommonBlocks = [
  markdownBlockInterface,
  experimentMetadataBlockInterface,
  experimentMetricBlockInterface,
  experimentDimensionBlockInterface,
  experimentTimeSeriesBlockInterface,
  experimentTrafficBlockInterface,
  sqlExplorerBlockInterface,
  metricExplorationBlockInterface,
  factTableExplorationBlockInterface,
  dataSourceExplorationBlockInterface,
];

export const dashboardBlockInterface = z.discriminatedUnion("type", [
  metricExplorerBlockInterface,
  ...standardAndApiCommonBlocks,
]);
export const apiDashboardBlockInterface = z.discriminatedUnion("type", [
  apiMetricExplorerBlockInterface,
  ...standardAndApiCommonBlocks,
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
  legacySqlExplorerBlockInterface,
]);

export type DashboardBlockInterface = z.infer<typeof dashboardBlockInterface>;
export type ApiDashboardBlockInterface = z.infer<
  typeof apiDashboardBlockInterface
>;
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
  metricExplorationBlockInterface.omit(createOmits),
  factTableExplorationBlockInterface.omit(createOmits),
  dataSourceExplorationBlockInterface.omit(createOmits),
]);
export const apiCreateDashboardBlockInterface = z.discriminatedUnion("type", [
  markdownBlockInterface.omit(createOmits),
  experimentMetadataBlockInterface.omit(createOmits),
  experimentMetricBlockInterface.omit(createOmits),
  experimentDimensionBlockInterface.omit(createOmits),
  experimentTimeSeriesBlockInterface.omit(createOmits),
  experimentTrafficBlockInterface.omit(createOmits),
  sqlExplorerBlockInterface.omit(createOmits),
  apiMetricExplorerBlockInterface.omit(createOmits),
  metricExplorationBlockInterface.omit(createOmits),
  factTableExplorationBlockInterface.omit(createOmits),
  dataSourceExplorationBlockInterface.omit(createOmits),
]);
export type CreateDashboardBlockInterface = z.infer<
  typeof createDashboardBlockInterface
>;
export type ApiCreateDashboardBlockInterface = z.infer<
  typeof apiCreateDashboardBlockInterface
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
  metricExplorationBlockInterface
    .omit(createOmits)
    .partial()
    .required({ type: true }),
  factTableExplorationBlockInterface
    .omit(createOmits)
    .partial()
    .required({ type: true }),
  dataSourceExplorationBlockInterface
    .omit(createOmits)
    .partial()
    .required({ type: true }),
]);

export type DashboardBlockData<T extends DashboardBlockInterface> =
  DistributiveOmit<T, "id" | "uid" | "organization">;

export type DashboardBlockInterfaceOrData<T extends DashboardBlockInterface> =
  | T
  | DashboardBlockData<T>;
