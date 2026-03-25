import { z } from "zod";
import { queryPointerValidator } from "./queries";
import { rowFilterValidator } from "./fact-table";

const baseValueValidator = z.object({
  name: z.string(),
  rowFilters: z.array(rowFilterValidator),
});

// Metrics
const metricValueValidator = baseValueValidator.extend({
  type: z.literal("metric"),
  metricId: z.string(),
  unit: z.string().nullable(),
  denominatorUnit: z.string().nullable(),
});
export type MetricValue = z.infer<typeof metricValueValidator>;

export type DatasetType = "metric" | "fact_table" | "data_source";

const metricDatasetValidator = z
  .object({
    type: z.literal("metric"),
    values: z.array(metricValueValidator),
  })
  .strict();

// Fact Tables
const valueType = ["unit_count", "count", "sum"] as const;

const factTableValueValidator = baseValueValidator.extend({
  type: z.literal("fact_table"),
  valueType: z.enum(valueType),
  valueColumn: z.string().nullable(),
  unit: z.string().nullable(),
});
export type FactTableValue = z.infer<typeof factTableValueValidator>;

const factTableDatasetValidator = z
  .object({
    type: z.literal("fact_table"),
    factTableId: z.string().nullable(),
    values: z.array(factTableValueValidator),
  })
  .strict();

// Database
const dataSourceValueValidator = baseValueValidator.extend({
  type: z.literal("data_source"),
  valueType: z.enum(valueType),
  valueColumn: z.string().nullable(),
  unit: z.string().nullable(),
});
export type DataSourceValue = z.infer<typeof dataSourceValueValidator>;

const dataSourceDatasetValidator = z
  .object({
    type: z.literal("data_source"),
    table: z.string(),
    path: z.string(),
    timestampColumn: z.string(),
    columnTypes: z.record(
      z.string(),
      z.enum(["string", "number", "date", "boolean", "other"]),
    ),
    values: z.array(dataSourceValueValidator),
  })
  .strict();

export const explorationDatasetValidator = z.discriminatedUnion("type", [
  metricDatasetValidator,
  factTableDatasetValidator,
  dataSourceDatasetValidator,
]);

const _valueValidator = z.discriminatedUnion("type", [
  metricValueValidator,
  factTableValueValidator,
  dataSourceValueValidator,
]);
export type ProductAnalyticsValue = z.infer<typeof _valueValidator>;

export const dateGranularity = [
  "auto",
  "hour",
  "day",
  "week",
  "month",
  "year",
] as const;

export const dateDimensionValidator = z.object({
  dimensionType: z.literal("date"),
  column: z.string().nullable(),
  dateGranularity: z.enum(dateGranularity),
});

export const dynamicDimensionValidator = z.object({
  dimensionType: z.literal("dynamic"),
  column: z.string().nullable(),
  maxValues: z.number(),
});

export const staticDimensionValidator = z.object({
  dimensionType: z.literal("static"),
  column: z.string(),
  values: z.array(z.string()),
});

export const sliceDimensionValidator = z.object({
  dimensionType: z.literal("slice"),
  slices: z.array(
    z.object({
      name: z.string(),
      filters: z.array(rowFilterValidator),
    }),
  ),
});

export const dimensionValidator = z.discriminatedUnion("dimensionType", [
  dateDimensionValidator,
  dynamicDimensionValidator,
  staticDimensionValidator,
  sliceDimensionValidator,
]);

export const chartTypes = [
  "line",
  "area",
  "timeseries-table",
  "table",
  "bar",
  "stackedBar",
  "horizontalBar",
  "stackedHorizontalBar",
  "bigNumber",
] as const;

export const dateRangePredefined = [
  "today",
  "last7Days",
  "last30Days",
  "last90Days",
  "customLookback",
  "customDateRange",
] as const;

export const lookbackUnit = ["hour", "day", "week", "month"] as const;

export const baseExplorationConfigValidator = z.object({
  datasource: z.string(),
  dimensions: z.array(dimensionValidator),
  chartType: z.enum(chartTypes),
  dateRange: z.object({
    predefined: z.enum(dateRangePredefined),
    lookbackValue: z.number().nullable(),
    lookbackUnit: z.enum(lookbackUnit).nullable(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
  }),
});

export const metricExplorationConfigValidator =
  baseExplorationConfigValidator.extend({
    type: z.literal("metric"),
    dataset: metricDatasetValidator,
  });

export const factTableExplorationConfigValidator =
  baseExplorationConfigValidator.extend({
    type: z.literal("fact_table"),
    dataset: factTableDatasetValidator,
  });

export const dataSourceExplorationConfigValidator =
  baseExplorationConfigValidator.extend({
    type: z.literal("data_source"),
    dataset: dataSourceDatasetValidator,
  });

// For SQL datasets, we need to know the column types
// This is the shape of the response from the warehouse / API
const columnType = ["string", "number", "date", "boolean", "other"] as const;
export const sqlDatasetColumnResponseRowValidator = z.object({
  column: z.string(),
  type: z.enum(columnType),
});
export const sqlDatasetColumnResponseValidator = z.object({
  columns: z.array(sqlDatasetColumnResponseRowValidator),
});

// The shape of the final result data from the warehouse / API
export const productAnalyticsResultRowValidator = z.object({
  dimensions: z.array(z.string().nullable()),
  values: z.array(
    z.object({
      metricId: z.string(),
      numerator: z.number().nullable(),
      denominator: z.number().nullable(),
    }),
  ),
});
export const productAnalyticsResultValidator = z.object({
  rows: z.array(productAnalyticsResultRowValidator),
});

export const productAnalyticsExplorationValidator = z.object({
  id: z.string(),
  organization: z.string(),
  dateCreated: z.date(),
  dateUpdated: z.date(),
  datasource: z.string(),
  configHash: z.string(),
  valueHashes: z.array(z.string()),
  config: z.discriminatedUnion("type", [
    metricExplorationConfigValidator,
    factTableExplorationConfigValidator,
    dataSourceExplorationConfigValidator,
  ]),
  result: productAnalyticsResultValidator,
  dateStart: z.string(),
  dateEnd: z.string(),
  runStarted: z.date().nullable(),
  status: z.enum(["running", "success", "error"]),
  error: z.string().nullable().optional(),
  queries: z.array(queryPointerValidator),
});

export type BaseExplorationConfig = z.infer<
  typeof baseExplorationConfigValidator
>;

export const explorationConfigValidator = z.discriminatedUnion("type", [
  metricExplorationConfigValidator,
  factTableExplorationConfigValidator,
  dataSourceExplorationConfigValidator,
]);
export type ExplorationConfig = z.infer<typeof explorationConfigValidator>;

export type MetricExplorationConfig = z.infer<
  typeof metricExplorationConfigValidator
>;
export type FactTableExplorationConfig = z.infer<
  typeof factTableExplorationConfigValidator
>;
export type DataSourceExplorationConfig = z.infer<
  typeof dataSourceExplorationConfigValidator
>;

export type MetricDataset = z.infer<typeof metricDatasetValidator>;
export type FactTableDataset = z.infer<typeof factTableDatasetValidator>;
export type DataSourceDataset = z.infer<typeof dataSourceDatasetValidator>;
export type ExplorationDataset = z.infer<typeof explorationDatasetValidator>;

export type ProductAnalyticsDimension = z.infer<typeof dimensionValidator>;
export type ProductAnalyticsDynamicDimension = z.infer<
  typeof dynamicDimensionValidator
>;
export type ProductAnalyticsResult = z.infer<
  typeof productAnalyticsResultValidator
>;
export type ProductAnalyticsResultRow = z.infer<
  typeof productAnalyticsResultRowValidator
>;
export type ProductAnalyticsExploration = z.infer<
  typeof productAnalyticsExplorationValidator
>;

// User Journey validators

const minuteTimeframeValidator = z.object({
  value: z.number().int().min(1).max(1440),
  unit: z.literal("minute"),
});

const hourTimeframeValidator = z.object({
  value: z.number().int().min(1).max(24),
  unit: z.literal("hour"),
});

// Path spine step. Alternative: forwardPath could be z.array(z.string()) (spine only);
const pathStepValidator = z.object({
  event: z.string(),
  filters: z.array(rowFilterValidator),
});

export const userJourneyConfigValidator = z.object({
  datasource: z.string(),
  dimensions: z
    .array(
      z.discriminatedUnion("dimensionType", [
        dynamicDimensionValidator,
        staticDimensionValidator,
        sliceDimensionValidator,
      ]),
    )
    .max(1)
    .optional(),
  factTableId: z.string(),
  startingEvent: z.array(rowFilterValidator),
  globalFilters: z.array(rowFilterValidator),
  userIdType: z.string(),
  conversionWindow: z.discriminatedUnion("unit", [
    minuteTimeframeValidator,
    hourTimeframeValidator,
  ]),
  measurementType: z.enum(["total", "unique"]),
  dateRange: z.object({
    predefined: z.enum(dateRangePredefined),
    lookbackValue: z.number().nullable(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
  }),
  forwardPath: z.array(pathStepValidator),
  numOfEventsPerStep: z.number().int().min(1).max(10), // Controls how many paths are rendered per step
  // Additional properties to consider:
  // - backwardPath: z.array(pathStepValidator),
  // - sampling: z.object({
  // enabled: z.boolean(),
  // percentage: z.number().int().min(1).max(100),
  //})
  // - excludePathsWithTheseEvents: z.array(z.string()),
  // - cohorts - I think this can be accomplished with our filters, but would probably be good eventually so a user can define a cohort, and then use filters to exclude
});

// Path row shape that scales to N steps: ordered sequence of events + count + optional timing between steps
export const userJourneyPathRowValidator = z.object({
  steps: z.array(z.string()).min(2),
  unit_count: z.number(),
  avg_secs_between_steps: z.array(z.number()).optional(), // length = steps.length - 1
});

export type UserJourneyPathRow = z.infer<typeof userJourneyPathRowValidator>;

const userJourneyResultValidator = z.object({
  rows: z.array(userJourneyPathRowValidator),
});

// This is what we'll persist in the userjourneyexploration collection (once it's built)
export const userJourneyExplorationValidator = z.object({
  id: z.string(),
  organization: z.string(),
  dateCreated: z.date(),
  dateUpdated: z.date(),
  config: userJourneyConfigValidator,
  result: userJourneyResultValidator,
  dateStart: z.string(),
  dateEnd: z.string(),
  runStarted: z.date().nullable(),
  status: z.enum(["running", "success", "error"]),
  error: z.string().nullable().optional(),
  queries: z.array(queryPointerValidator), // Placeholder for now - not sure if we'll need this
});

export type UserJourneyConfig = z.infer<typeof userJourneyConfigValidator>;
export type UserJourneyResult = z.infer<typeof userJourneyResultValidator>;
export type UserJourney = z.infer<typeof userJourneyExplorationValidator>;

// The above is a roughed out set of validators for the user journey feature.

// These validators are based on the following assumptions:
// - We are using the fact table for the user journey
// - We want to be able to run a full config as a single query
// - When a user is building a journey, they'll start with a starting event, and we'll run a query to get the paths for that event + 2 steps forward
// the user can then add additional steps, and we'll run a query to get the next 2 steps for that full path.
// -
