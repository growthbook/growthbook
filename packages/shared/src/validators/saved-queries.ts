import { z } from "zod";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import { factTableColumnTypeValidator } from "./fact-table";
import { namedSchema } from "./openapi-helpers";

const dateAggregationEnum = z.enum([
  "none",
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "year",
]);

const xAxisConfigurationValidator = z.object({
  fieldName: z.string(),
  type: z.enum(["string", "number", "date"]),
  sort: z.enum(["none", "asc", "desc", "valueAsc", "valueDesc"]),
  dateAggregationUnit: dateAggregationEnum.optional(),
});
export type xAxisDateAggregationUnit = z.infer<typeof dateAggregationEnum>;
export type xAxisConfiguration = z.infer<typeof xAxisConfigurationValidator>;

const aggregationEnum = z.enum([
  "none",
  "min",
  "max",
  "first",
  "last",
  "sum",
  "count",
  "countDistinct",
  "average",
]);

const yAxisConfigurationValidator = z.object({
  fieldName: z.string(),
  type: z.enum(["string", "number", "date"]),
  aggregation: aggregationEnum,
});
export type yAxisConfiguration = z.infer<typeof yAxisConfigurationValidator>;
export type yAxisAggregationType = z.infer<typeof aggregationEnum>;

const baseDimensionAxisConfigurationValidator = z.object({
  fieldName: z.string(),
  display: z.enum(["grouped"]),
  maxValues: z.number().optional(),
});
export type baseDimensionAxisConfiguration = z.infer<
  typeof baseDimensionAxisConfigurationValidator
>;

const extendedDimensionAxisConfigurationValidator =
  baseDimensionAxisConfigurationValidator.extend({
    display: z.enum(["stacked", "grouped"]),
  });
export type extendedDimensionAxisConfiguration = z.infer<
  typeof extendedDimensionAxisConfigurationValidator
>;

// Union type for all dimension axis configurations
export type dimensionAxisConfiguration =
  | baseDimensionAxisConfiguration
  | extendedDimensionAxisConfiguration;

const filterConfigurationValidator = z.union([
  // Date filters
  z.object({
    column: z.string(),
    columnType: z.literal("date"),
    filterMethod: z.literal("dateRange"),
    config: z
      .object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
      })
      .refine((data) => data.startDate || data.endDate, {
        message: "At least one of startDate or endDate is required",
      }),
  }),
  z.object({
    column: z.string(),
    columnType: z.literal("date"),
    filterMethod: z.enum(["today", "last7Days", "last30Days"]),
    config: z.object({}).optional(), // No config needed
  }),

  // Number filters
  z.object({
    column: z.string(),
    columnType: z.literal("number"),
    filterMethod: z.literal("numberRange"),
    config: z
      .object({
        min: z.union([z.string(), z.number()]).optional(),
        max: z.union([z.string(), z.number()]).optional(),
      })
      .refine((data) => data.min !== undefined || data.max !== undefined, {
        message: "At least one of min or max is required",
      }),
  }),
  z.object({
    column: z.string(),
    columnType: z.literal("number"),
    filterMethod: z.enum([
      "greaterThan",
      "lessThan",
      "equalTo",
      "greaterThanOrEqualTo",
      "lessThanOrEqualTo",
    ]),
    config: z.object({
      value: z.union([z.string(), z.number()]),
    }),
  }),

  // String filters
  z.object({
    column: z.string(),
    columnType: z.literal("string"),
    filterMethod: z.literal("contains"),
    config: z.object({
      value: z.string(),
    }),
  }),
  z.object({
    column: z.string(),
    columnType: z.literal("string"),
    filterMethod: z.literal("includes"),
    config: z.object({
      values: z.array(z.string()),
    }),
  }),
]);

export type FilterConfiguration = z.infer<typeof filterConfigurationValidator>;

const formatEnum = z.enum([
  "shortNumber",
  "longNumber",
  "currency",
  "percentage",
  "accounting",
]);

// Base chart components for composition
const baseChartConfig = z.object({
  id: z.string().optional(), // UUID for referencing in blockConfig - optional as this was added after the initial release
  title: z.string().optional(),
  yAxis: z.array(yAxisConfigurationValidator).nonempty(),
  filters: z.array(filterConfigurationValidator).optional(),
});

const withXAxis = z.object({
  xAxis: xAxisConfigurationValidator,
});

const withXAxes = z.object({
  xAxes: z.array(xAxisConfigurationValidator).nonempty(),
});

const withBaseDimensions = z.object({
  dimension: z
    .array(baseDimensionAxisConfigurationValidator)
    .nonempty()
    .optional(),
});

const withExtendedDimensions = z.object({
  dimension: z
    .array(extendedDimensionAxisConfigurationValidator)
    .nonempty()
    .optional(),
});

const withFormat = z.object({
  format: formatEnum,
});

// Chart type definitions using composition
const barChartValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("bar") }))
  .merge(withXAxis)
  .merge(withExtendedDimensions);

const lineChartValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("line") }))
  .merge(withXAxis)
  .merge(withBaseDimensions)
  .extend({
    displaySettings: z.object({
      anchorYAxisToZero: z.boolean(),
    }),
  });

const areaChartValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("area") }))
  .merge(withXAxis)
  .merge(withExtendedDimensions);

const scatterChartValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("scatter") }))
  .merge(withXAxis)
  .merge(withBaseDimensions)
  .extend({
    displaySettings: z.object({
      anchorYAxisToZero: z.boolean(),
    }),
  });

const bigValueChartValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("big-value") }))
  .merge(withFormat);

const pivotTableValidator = baseChartConfig
  .merge(z.object({ chartType: z.literal("pivot-table") }))
  .merge(withXAxes)
  .merge(withBaseDimensions);

// Union of all chart type validators
export const dataVizConfigValidator = z.discriminatedUnion("chartType", [
  barChartValidator,
  lineChartValidator,
  areaChartValidator,
  scatterChartValidator,
  bigValueChartValidator,
  pivotTableValidator,
]);

// Type helpers for better TypeScript inference
export type BarChart = z.infer<typeof barChartValidator>;
export type LineChart = z.infer<typeof lineChartValidator>;
export type AreaChart = z.infer<typeof areaChartValidator>;
export type ScatterChart = z.infer<typeof scatterChartValidator>;
export type BigValueChart = z.infer<typeof bigValueChartValidator>;
export type BigValueFormat = z.infer<typeof formatEnum>;
export type PivotTable = z.infer<typeof pivotTableValidator>;

export const testQueryRowSchema = z.record(z.string(), z.any());

export const jsonFieldsColumnDataValidator = z.object({
  name: z.string(),
  dataType: factTableColumnTypeValidator.optional(),
});

export const queryResponseColumnDataValidator = z.object({
  name: z.string(),
  dataType: factTableColumnTypeValidator.optional(),
  fields: z.array(jsonFieldsColumnDataValidator).optional(),
});

export const queryExecutionResultValidator = z.object({
  results: z.array(testQueryRowSchema),
  error: z.string().nullable().optional(),
  duration: z.number().optional(),
  sql: z.string().optional(),
  columns: z.array(queryResponseColumnDataValidator).optional(),
});

export const savedQueryValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    datasourceId: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    name: z.string(),
    dateLastRan: z.date(),
    sql: z.string(),
    dataVizConfig: z.array(dataVizConfigValidator).optional(),
    results: queryExecutionResultValidator,
    linkedDashboardIds: z.array(z.string()).optional(),
  })
  .strict();

export type SavedQuery = z.infer<typeof savedQueryValidator>;
export type SavedQueryCreateProps = CreateProps<SavedQuery>;
export type SavedQueryUpdateProps = UpdateProps<SavedQuery>;
export type DataVizConfig = z.infer<typeof dataVizConfigValidator>;
export type QueryExecutionResult = z.infer<
  typeof queryExecutionResultValidator
>;

// Result rows are only returned by the refresh endpoint, to keep listings small.
export const apiSavedQueryValidator = namedSchema(
  "SavedQuery",
  z
    .object({
      id: z.string(),
      datasourceId: z.string(),
      name: z.string(),
      sql: z.string(),
      dataVizConfig: z.array(dataVizConfigValidator),
      linkedDashboardIds: z.array(z.string()),
      dateLastRan: z.string().meta({ format: "date-time" }),
      lastRun: z.object({
        rowCount: z.number(),
        error: z.string().nullable(),
        duration: z.number().nullable(),
      }),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);

const savedQueryFields = {
  name: z.string().min(1),
  sql: z.string().min(1),
  dataVizConfig: z
    .array(dataVizConfigValidator)
    .optional()
    .describe("Charts to draw from the results"),
};

const savedQueryIdParams = z.object({ id: z.string() }).strict();
const savedQueryResponse = z
  .object({ savedQuery: apiSavedQueryValidator })
  .strict();
const savedQueryGate =
  "Requires the saved SQL Explorer queries feature and permission to run SQL Explorer queries on the Data Source.";

export const listSavedQueriesValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ datasourceId: z.string().optional() }).strict(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({ savedQueries: z.array(apiSavedQueryValidator) })
    .strict(),
  summary: "Get all saved SQL Explorer queries",
  operationId: "listSavedQueries",
  tags: ["saved-queries"],
  method: "get" as const,
  path: "/saved-queries",
};

export const getSavedQueryValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: savedQueryIdParams,
  responseSchema: savedQueryResponse,
  summary: "Get a single saved query",
  operationId: "getSavedQuery",
  tags: ["saved-queries"],
  method: "get" as const,
  path: "/saved-queries/:id",
};

export const postSavedQueryValidator = {
  bodySchema: z
    .object({
      datasourceId: z.string(),
      ...savedQueryFields,
      runNow: z
        .boolean()
        .optional()
        .describe("Run the query after saving it (default true)"),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: savedQueryResponse,
  summary: "Create a saved query",
  description: `${savedQueryGate} Use its id in a Dashboard's SQL Explorer block.`,
  operationId: "postSavedQuery",
  tags: ["saved-queries"],
  method: "post" as const,
  path: "/saved-queries",
  exampleRequest: {
    body: {
      datasourceId: "ds_abc123",
      name: "Signups by day",
      sql: "SELECT date, COUNT(*) AS signups FROM users GROUP BY date",
    },
  },
};

export const updateSavedQueryValidator = {
  bodySchema: z.object(savedQueryFields).partial().strict(),
  querySchema: z.never(),
  paramsSchema: savedQueryIdParams,
  responseSchema: savedQueryResponse,
  summary: "Update a saved query",
  description: `${savedQueryGate} Changing \`sql\` doesn't re-run it; call the refresh endpoint.`,
  operationId: "updateSavedQuery",
  tags: ["saved-queries"],
  method: "post" as const,
  path: "/saved-queries/:id",
};

export const deleteSavedQueryValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: savedQueryIdParams,
  responseSchema: z.object({ deletedId: z.string() }).strict(),
  summary: "Delete a saved query",
  operationId: "deleteSavedQuery",
  tags: ["saved-queries"],
  method: "delete" as const,
  path: "/saved-queries/:id",
};

export const postSavedQueryRefreshValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: savedQueryIdParams,
  responseSchema: z
    .object({
      savedQuery: apiSavedQueryValidator,
      results: z
        .array(z.record(z.string(), z.unknown()))
        .describe("Up to 1000 rows"),
      error: z.string().nullable(),
    })
    .strict(),
  summary: "Re-run a saved query",
  description: `${savedQueryGate} A failed run is reported in \`error\` and the previous results are kept.`,
  operationId: "postSavedQueryRefresh",
  tags: ["saved-queries"],
  method: "post" as const,
  path: "/saved-queries/:id/refresh",
};
