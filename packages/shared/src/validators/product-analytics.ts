import { z } from "zod";
import { apiBaseSchema } from "./base-model";
import { queryPointerValidator } from "./queries";
import { rowFilterValidator, funnelStepValidator } from "./fact-table";

import { namedSchema } from "./openapi-helpers";

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

export type DatasetType = "metric" | "fact_table" | "data_source" | "funnel";

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

// Funnels
/** Y-axis scaling for the funnel bar chart.
 *  - `count`: raw user counts per step.
 *  - `percent`: each series is normalized so step 1 is 100%, surfacing
 *    cross-dimension conversion rates directly.
 *  Optional for backward compatibility; read sites default to "percent". */
export const funnelYAxisScaleValidator = z.enum(["count", "percent"]);
export type FunnelYAxisScale = z.infer<typeof funnelYAxisScaleValidator>;

const funnelDatasetValidator = z
  .object({
    type: z.literal("funnel"),
    // The user identifier type to count. Must exist on every step's fact
    // table. Nullable so a default-state config can exist before the user
    // has picked anything.
    unit: z.string().nullable(),
    steps: z.array(funnelStepValidator),
    // Seconds of out-of-order tolerance applied between adjacent steps.
    // Defaults to 0 (strict chronological ordering).
    concurrencyWindowSeconds: z.number().int().min(0).optional(),
    yAxisScale: funnelYAxisScaleValidator.optional(),
  })
  .strict();
export type FunnelDataset = z.infer<typeof funnelDatasetValidator>;

export const explorationDatasetValidator = z.discriminatedUnion("type", [
  metricDatasetValidator,
  factTableDatasetValidator,
  dataSourceDatasetValidator,
  funnelDatasetValidator,
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
  // Unbounded so this can parse older saved/URL-encoded explorations too;
  // the editor enforces the 20-value cap.
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
  "yesterday",
  "last7Days",
  "last30Days",
  "last90Days",
  "last12Months",
  "lastCalendarYear",
  "customLookback",
  "customDateRange",
] as const;

export const lookbackUnit = ["hour", "day", "week", "month"] as const;

// Order drives the option order in the comparison-mode pickers.
export const comparisonMode = [
  "previousPeriod",
  "previousPeriodMatchDayOfWeek",
  "previousYear",
  "previousYearMatchDayOfWeek",
  "custom",
] as const;

export const comparisonModeValidator = z.enum(comparisonMode);
export type ComparisonMode = z.infer<typeof comparisonModeValidator>;

export const showAsValidator = z.enum(["total", "per_unit"]);
export type ShowAs = z.infer<typeof showAsValidator>;

export const explorationDateRangeValidator = z.object({
  predefined: z.enum(dateRangePredefined),
  lookbackValue: z.number().nullish(),
  lookbackUnit: z.enum(lookbackUnit).nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
});
export type ExplorationDateRange = z.infer<
  typeof explorationDateRangeValidator
>;

export const baseExplorationConfigValidator = z.object({
  datasource: z.string().describe("ID of the datasource to query"),
  dimensions: z.array(dimensionValidator),
  chartType: z.enum(chartTypes),
  dateRange: explorationDateRangeValidator,
  // Controls how values with a denominator are rendered at the chart level.
  // "total"    -> render the raw numerator (e.g. total events)
  // "per_unit" -> divide numerator by denominator (e.g. events per unit)
  // Ratio metrics are self-contained and always render as numerator/denominator
  // regardless of this setting.
  // Optional for backward compatibility; read sites default to "total".
  showAs: showAsValidator.optional(),
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

export const funnelExplorationConfigValidator =
  baseExplorationConfigValidator.extend({
    type: z.literal("funnel"),
    dataset: funnelDatasetValidator,
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

// One per-step entry on a funnel result row. The dataset.type determines
// whether a row carries `values` (metric/fact_table/data_source) or `steps`
// (funnel); they're never both populated.
export const productAnalyticsFunnelStepResultValidator = z.object({
  count: z.number(),
  // Sum and sum-of-squares over time-from-previous-step (in hours),
  // restricted to users who completed both this step and its predecessor.
  // null when the step is the first or when no users converted.
  timeFromPrevSumHrs: z.number().nullable(),
  timeFromPrevSumSquaresHrs: z.number().nullable(),
});

// The shape of the final result data from the warehouse / API
export const productAnalyticsResultRowValidator = z.object({
  dimensions: z.array(z.string().nullable()),
  values: z
    .array(
      z.object({
        metricId: z.string(),
        numerator: z.number().nullable(),
        denominator: z.number().nullable(),
      }),
    )
    .optional(),
  steps: z.array(productAnalyticsFunnelStepResultValidator).optional(),
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
    funnelExplorationConfigValidator,
  ]),
  result: productAnalyticsResultValidator,
  dateStart: z.string(),
  dateEnd: z.string(),
  runStarted: z.date().nullable(),
  status: z.enum(["running", "success", "error"]),
  error: z.string().nullable().optional(),
  queries: z.array(queryPointerValidator),
});

export const explorationCacheQuerySchema = z.object({
  cache: z
    .enum(["preferred", "required", "never"])
    .describe(
      "Controls cache behavior for this exploration: " +
        "`preferred` (default) returns a cached result if one exists, otherwise runs a new query; " +
        "`never` always runs a new query, ignoring any cached results; " +
        "`required` only returns a cached result, if none exists returns exploration: null with a message",
    )
    .optional(),
});

export type ExplorationCacheQuery = z.infer<typeof explorationCacheQuerySchema>;

export type BaseExplorationConfig = z.infer<
  typeof baseExplorationConfigValidator
>;

export const explorationConfigValidator = z.discriminatedUnion("type", [
  metricExplorationConfigValidator,
  factTableExplorationConfigValidator,
  dataSourceExplorationConfigValidator,
  funnelExplorationConfigValidator,
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
export type FunnelExplorationConfig = z.infer<
  typeof funnelExplorationConfigValidator
>;

export type MetricDataset = z.infer<typeof metricDatasetValidator>;
export type FactTableDataset = z.infer<typeof factTableDatasetValidator>;
export type DataSourceDataset = z.infer<typeof dataSourceDatasetValidator>;
export type ExplorationDataset = z.infer<typeof explorationDatasetValidator>;
export type ProductAnalyticsFunnelStepResult = z.infer<
  typeof productAnalyticsFunnelStepResultValidator
>;

export type ProductAnalyticsDimension = z.infer<typeof dimensionValidator>;
export type ProductAnalyticsDynamicDimension = z.infer<
  typeof dynamicDimensionValidator
>;
export type ProductAnalyticsStaticDimension = z.infer<
  typeof staticDimensionValidator
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

export const productAnalyticsRunRequestBodyValidator = z
  .object({
    config: explorationConfigValidator,
    previousTimeFrame: explorationDateRangeValidator.optional(),
    // The client sends the already-resolved window, so this is only used to pick
    // how the two periods' rows are paired.
    comparisonMode: comparisonModeValidator.optional(),
  })
  .strict();

export type ProductAnalyticsRunRequestBody = z.infer<
  typeof productAnalyticsRunRequestBodyValidator
>;

const bigNumberComparisonTrendComputedValidator = z
  .object({
    currentValue: z.number(),
    previousValue: z.number(),
    /** Signed fractional change, e.g. -0.12 for −12%. */
    pctChangeFraction: z.number(),
    /** Same change as a percentage, rounded to 2 decimals. */
    pctChangePercent: z.number(),
  })
  .nullable();

export const productAnalyticsRunComparisonPayloadValidator = z.object({
  exploration: productAnalyticsExplorationValidator.nullable(),
  previousPeriod: z.object({
    startDate: z.string(),
    endDate: z.string(),
  }),
  bigNumberTrends: z.array(bigNumberComparisonTrendComputedValidator),
  tableTrendsByRow: z.array(z.record(z.string(), z.number().nullable())),
});

export type ProductAnalyticsRunComparisonPayload = z.infer<
  typeof productAnalyticsRunComparisonPayloadValidator
>;

export const apiExplorationBaseValidator = apiBaseSchema.safeExtend({
  datasource: z.string(),
  status: z.enum(["running", "success", "error"]),
  dateStart: z.string(),
  dateEnd: z.string(),
  error: z.string().nullable().optional(),
  result: productAnalyticsResultValidator,
});

export const apiMetricExplorationValidator =
  apiExplorationBaseValidator.safeExtend({
    config: metricExplorationConfigValidator,
  });

export const apiFactTableExplorationValidator =
  apiExplorationBaseValidator.safeExtend({
    config: factTableExplorationConfigValidator,
  });

export const apiDataSourceExplorationValidator =
  apiExplorationBaseValidator.safeExtend({
    config: dataSourceExplorationConfigValidator,
  });

export const apiFunnelExplorationValidator =
  apiExplorationBaseValidator.safeExtend({
    config: funnelExplorationConfigValidator,
  });

export const apiAnalyticsExplorationValidator = namedSchema(
  "AnalyticsExploration",
  apiExplorationBaseValidator.safeExtend({
    config: explorationConfigValidator,
  }),
);

export type ApiAnalyticsExploration = z.infer<
  typeof apiAnalyticsExplorationValidator
>;

// ---------------------------------------------------------------------------
// Discovery: search, columns, column values
//
// One definition per input, shared by the product-analytics chat agent's tools
// and the REST endpoints that expose the same three lookups. Numbers and the
// id list are query-encoded on the REST side, so they coerce from strings;
// defaults live in `meta()` rather than `.default()` and are applied by the
// caller, matching `paginationQueryFields`.
// ---------------------------------------------------------------------------

export const PRODUCT_ANALYTICS_SEARCH_DEFAULT_LIMIT = 10;
export const PRODUCT_ANALYTICS_COLUMN_VALUES_DEFAULT_LIMIT = 20;

export const productAnalyticsSearchQuerySchema = z.strictObject({
  query: z
    .string()
    .describe(
      "Search term matched against metric and fact table names, descriptions, owners, tags, and IDs. " +
        "Omit or pass an empty string to browse everything available.",
    )
    .optional(),
  datasourceId: z
    .string()
    .describe(
      "Scope results to a single Data Source. Omit to search across the whole organization.",
    )
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .describe("The number of results to return")
    .optional()
    .meta({ default: PRODUCT_ANALYTICS_SEARCH_DEFAULT_LIMIT }),
  skip: z.coerce
    .number()
    .int()
    .min(0)
    .describe("How many results to skip (use with limit to paginate)")
    .optional()
    .meta({ default: 0 }),
});

export type ProductAnalyticsSearchQuery = z.infer<
  typeof productAnalyticsSearchQuerySchema
>;

export const productAnalyticsColumnSources = ["fact_table", "metric"] as const;
export type ProductAnalyticsColumnSource =
  (typeof productAnalyticsColumnSources)[number];

/**
 * A `metric` source needs `metricIds`, a `fact_table` source needs
 * `factTableId`. Enforced by refinement rather than a discriminated union so
 * the same object shape works as a flat query string.
 */
export function productAnalyticsColumnSourceIsValid(v: {
  source: string;
  factTableId?: string;
  metricIds?: string[];
}): boolean {
  switch (v.source) {
    case "fact_table":
      return !!v.factTableId;
    case "metric":
      return !!v.metricIds?.length;
    default:
      return false;
  }
}

const COLUMN_SOURCE_REFINEMENT = {
  message: "Provide the ID field matching the selected source",
} as const;

/** Comma-separated metric ids, e.g. `?metricIds=fact__a,fact__b`. */
const metricIdsQueryField = z
  .string()
  .describe(
    "Comma-separated metric IDs — required when source is `metric`. Returns the " +
      "intersection of columns across the underlying fact tables of every metric listed.",
  )
  .meta({
    type: "array",
    items: { type: "string" },
    explode: false,
  })
  .optional();

export function parseMetricIdsQueryField(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Which dataset the lookup runs against, shared by both endpoints. Only
 * `metricIds` differs between them — comma-separated in a query string, a real
 * array in a JSON body — so it is supplied per schema.
 */
const columnSourceFields = {
  source: z
    .enum(productAnalyticsColumnSources)
    .describe(
      "The exploration type — determines which ID field is required: " +
        "`fact_table` needs `factTableId`, `metric` needs `metricIds`.",
    ),
  factTableId: z
    .string()
    .describe("Fact Table ID — required when source is `fact_table`")
    .optional(),
};

export const productAnalyticsColumnsQuerySchema = z
  .strictObject({ ...columnSourceFields, metricIds: metricIdsQueryField })
  .refine(
    (v) =>
      productAnalyticsColumnSourceIsValid({
        ...v,
        metricIds: parseMetricIdsQueryField(v.metricIds),
      }),
    COLUMN_SOURCE_REFINEMENT,
  );

export const productAnalyticsColumnValuesBodySchema = z
  .strictObject({
    ...columnSourceFields,
    metricIds: z
      .array(z.string())
      .describe(
        "Metric IDs — required when source is `metric`. The fact table behind the " +
          "first metric with one is queried.",
      )
      .optional(),
    columns: z
      .array(z.string())
      .min(1)
      .max(5)
      .describe(
        "Column names to fetch values for. Only string-typed columns are queryable; " +
          "anything else is reported back in `warnings`.",
      ),
    searchTerm: z
      .string()
      .describe(
        "Case-insensitive substring filter, for when you have a partial guess of the " +
          "value — e.g. `US` to find `United States`.",
      )
      .optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .describe("Maximum values to return per column")
      .optional()
      .meta({ default: PRODUCT_ANALYTICS_COLUMN_VALUES_DEFAULT_LIMIT }),
  })
  .refine(productAnalyticsColumnSourceIsValid, COLUMN_SOURCE_REFINEMENT);

export type ProductAnalyticsColumnValuesBody = z.infer<
  typeof productAnalyticsColumnValuesBodySchema
>;

// The three discovery lookups return already-shaped JSON payloads whose keys
// vary by branch (a metric-source column lookup carries per-metric unit flags a
// fact-table one has no notion of), so the response contract is intentionally
// open rather than a union that would have to be widened on every tweak.
export const productAnalyticsDiscoveryResultSchema = z.record(
  z.string(),
  z.unknown(),
);
