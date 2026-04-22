import { z } from "zod";
import { ownerEmailField, ownerField, ownerInputField } from "./owner-field";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

import { namedSchema } from "./openapi-helpers";

// Shared sub-schemas for fact metric column references

const apiRowFilterValidator = z.object({
  operator: z.enum([
    "=",
    "!=",
    ">",
    "<",
    ">=",
    "<=",
    "in",
    "not_in",
    "is_null",
    "not_null",
    "is_true",
    "is_false",
    "contains",
    "not_contains",
    "starts_with",
    "ends_with",
    "sql_expr",
    "saved_filter",
  ]),
  values: z
    .array(z.string())
    .describe(
      "Not required for is_null, not_null, is_true, is_false operators.",
    )
    .optional(),
  column: z
    .string()
    .describe("Required for all operators except sql_expr and saved_filter.")
    .optional(),
});

const apiNumeratorRef = z.object({
  factTableId: z.string(),
  column: z.string(),
  aggregation: z.enum(["sum", "max", "count distinct"]).optional(),
  filters: z
    .array(z.string())
    .describe(
      "Array of Fact Table Filter Ids. Deprecated, use rowFilters instead.",
    )
    .optional()
    .meta({ deprecated: true }),
  inlineFilters: z
    .record(z.string(), z.array(z.string()))
    .describe(
      "Inline filters to apply to the fact table. Keys are column names, values are arrays of values to filter by. Deprecated, use rowFilters instead.",
    )
    .optional()
    .meta({ deprecated: true }),
  rowFilters: z
    .array(apiRowFilterValidator)
    .describe(
      "Filters to apply to the rows of the fact table before aggregation.",
    )
    .optional(),
  aggregateFilterColumn: z
    .string()
    .describe(
      "Column to use to filter users after aggregation. Either '$$count' of rows or the name of a numeric column that will be summed by user. Must specify `aggregateFilter` if using this. Only can be used with 'retention' and 'proportion' metrics.",
    )
    .optional(),
  aggregateFilter: z
    .string()
    .describe(
      "Simple comparison operator and value to apply after aggregation (e.g. '= 10' or '>= 1'). Requires `aggregateFilterColumn`.",
    )
    .optional(),
});

const apiDenominatorRef = z.object({
  factTableId: z.string(),
  column: z.string(),
  filters: z
    .array(z.string())
    .describe(
      "Array of Fact Table Filter Ids. Deprecated, use rowFilters instead.",
    )
    .optional()
    .meta({ deprecated: true }),
  inlineFilters: z
    .record(z.string(), z.array(z.string()))
    .describe(
      "Inline filters to apply to the fact table. Keys are column names, values are arrays of values to filter by. Deprecated, use rowFilters instead.",
    )
    .optional()
    .meta({ deprecated: true }),
  rowFilters: z
    .array(apiRowFilterValidator)
    .describe(
      "Filters to apply to the rows of the fact table before aggregation.",
    )
    .optional(),
});

const apiQuantileSettings = z
  .object({
    type: z
      .enum(["event", "unit"])
      .describe(
        "Whether the quantile is over unit aggregations or raw event values",
      ),
    ignoreZeros: z
      .boolean()
      .describe(
        "If true, zero values will be ignored when calculating the quantile",
      ),
    quantile: z.coerce
      .number()
      .multipleOf(0.001)
      .gte(0.001)
      .lte(0.999)
      .describe("The quantile value (from 0.001 to 0.999)"),
  })
  .describe(
    'Controls the settings for quantile metrics (mandatory if metricType is "quantile")',
  );

const apiCappingSettings = z
  .object({
    type: z.enum(["none", "absolute", "percentile"]),
    value: z.coerce
      .number()
      .describe(
        "When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0).",
      )
      .optional(),
    ignoreZeros: z
      .boolean()
      .describe(
        "If true and capping is `percentile`, zeros will be ignored when calculating the percentile.",
      )
      .optional(),
  })
  .describe("Controls how outliers are handled");

const apiWindowSettings = z
  .object({
    type: z.enum(["none", "conversion", "lookback"]),
    delayValue: z.coerce
      .number()
      .describe(
        "Wait this long after experiment exposure before counting conversions.",
      )
      .optional(),
    delayUnit: z.enum(["minutes", "hours", "days", "weeks"]).optional(),
    windowValue: z.coerce.number().optional(),
    windowUnit: z.enum(["minutes", "hours", "days", "weeks"]).optional(),
  })
  .describe("Controls the conversion window for the metric");

const apiRegressionAdjustmentSettings = z
  .object({
    override: z
      .boolean()
      .describe("If false, the organization default settings will be used"),
    enabled: z
      .boolean()
      .describe(
        "Controls whether or not regresion adjustment is applied to the metric",
      )
      .optional(),
    days: z.coerce
      .number()
      .describe(
        "Number of pre-exposure days to use for the regression adjustment",
      )
      .optional(),
  })
  .describe(
    "Controls the regression adjustment (CUPED) settings for the metric",
  );

const apiPriorSettings = z
  .object({
    override: z
      .boolean()
      .describe(
        "If false, the organization default settings will be used instead of the other settings in this object",
      ),
    proper: z
      .boolean()
      .describe(
        "If true, the `mean` and `stddev` will be used, otherwise we will use an improper flat prior.",
      ),
    mean: z
      .number()
      .describe(
        "The mean of the prior distribution of relative effects in proportion terms (e.g. 0.01 is 1%)",
      ),
    stddev: z
      .number()
      .describe(
        "Must be > 0. The standard deviation of the prior distribution of relative effects in proportion terms.",
      ),
  })
  .describe("Controls the bayesian prior for the metric");

const apiMetricTypeEnum = z.enum([
  "proportion",
  "retention",
  "mean",
  "quantile",
  "ratio",
  "dailyParticipation",
]);

// Corresponds to schemas/FactMetric.yaml
export const apiFactMetricValidator = namedSchema(
  "FactMetric",
  z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      owner: ownerField,
      ownerEmail: ownerEmailField,
      projects: z.array(z.string()),
      tags: z.array(z.string()),
      datasource: z.string(),
      metricType: apiMetricTypeEnum,
      numerator: apiNumeratorRef,
      denominator: apiDenominatorRef.optional(),
      inverse: z
        .boolean()
        .describe(
          "Set to true for things like Bounce Rate, where you want the metric to decrease",
        ),
      quantileSettings: apiQuantileSettings.optional(),
      cappingSettings: apiCappingSettings,
      windowSettings: apiWindowSettings,
      priorSettings: apiPriorSettings,
      regressionAdjustmentSettings: apiRegressionAdjustmentSettings,
      riskThresholdSuccess: z.coerce.number(),
      riskThresholdDanger: z.coerce.number(),
      displayAsPercentage: z
        .boolean()
        .describe(
          "If true and the metric is a ratio metric, variation means will be displayed as a percentage",
        )
        .optional(),
      minPercentChange: z.coerce.number(),
      maxPercentChange: z.coerce.number(),
      minSampleSize: z.coerce.number(),
      targetMDE: z.coerce.number(),
      managedBy: z
        .enum(["", "api", "admin"])
        .describe(
          "Where this fact metric must be managed from. If not set (empty string), it can be managed from anywhere.",
        ),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
      archived: z.boolean().optional(),
      metricAutoSlices: z
        .array(z.string())
        .describe(
          "Array of slice column names that will be automatically included in metric analysis. This is an enterprise feature.",
        )
        .optional(),
    })
    .strict(),
);

export type ApiFactMetric = z.infer<typeof apiFactMetricValidator>;

// Corresponds to schemas/MetricAnalysis.yaml
export const apiMetricAnalysisValidator = namedSchema(
  "MetricAnalysis",
  z
    .object({
      id: z.string().describe("The ID of the created metric analysis"),
      status: z
        .string()
        .describe(
          'The status of the analysis (e.g., "running", "completed", "error")',
        ),
      settings: z.record(z.string(), z.any()).optional(),
    })
    .strict(),
);

// Shared sub-schemas for post/update numerator and denominator

const postNumeratorRef = z.object({
  factTableId: z.string(),
  column: z
    .string()
    .describe(
      "Must be empty for proportion metrics and dailyParticipation metrics. Otherwise, the column name or one of the special values: '$$distinctUsers' or '$$count' (or '$$distinctDates' if metricType is 'mean' or 'ratio' or 'quantile' and quantileSettings.type is 'unit')",
    )
    .optional(),
  aggregation: z
    .enum(["sum", "max", "count distinct"])
    .describe(
      "User aggregation of selected column. Either sum or max for numeric columns; count distinct for string columns; ignored for special columns. Default: sum. If you specify a string column you must explicitly specify count distinct. Not used for proportion or event quantile metrics.",
    )
    .optional(),
  filters: z
    .array(z.string())
    .describe(
      "Array of Fact Table Filter Ids. Deprecated, use rowFilters instead.",
    )
    .optional()
    .meta({ deprecated: true }),
  inlineFilters: z
    .record(z.string(), z.array(z.string()))
    .describe(
      "Inline filters to apply to the fact table. Keys are column names, values are arrays of values to filter by. Deprecated, use rowFilters instead.",
    )
    .optional()
    .meta({ deprecated: true }),
  rowFilters: z
    .array(apiRowFilterValidator)
    .describe(
      "Filters to apply to the rows of the fact table before aggregation.",
    )
    .optional(),
  aggregateFilterColumn: z
    .string()
    .describe(
      "Column to use to filter users after aggregation. Either '$$count' of rows or the name of a numeric column that will be summed by user. Must specify `aggregateFilter` if using this. Only can be used with 'retention' and 'proportion' metrics.",
    )
    .optional(),
  aggregateFilter: z
    .string()
    .describe(
      "Simple comparison operator and value to apply after aggregation (e.g. '= 10' or '>= 1'). Requires `aggregateFilterColumn`.",
    )
    .optional(),
});

const postDenominatorRef = z
  .object({
    factTableId: z.string(),
    column: z
      .string()
      .describe(
        "The column name or one of the special values: '$$distinctUsers' or '$$count' (or '$$distinctDates' if metricType is 'mean' or 'ratio' or 'quantile' and quantileSettings.type is 'unit')",
      ),
    aggregation: z
      .enum(["sum", "max", "count distinct"])
      .describe(
        "User aggregation of selected column. Either sum or max for numeric columns; count distinct for string columns; ignored for special columns. Default: sum. If you specify a string column you must explicitly specify count distinct. Not used for proportion or event quantile metrics.",
      )
      .optional(),
    filters: z
      .array(z.string())
      .describe(
        "Array of Fact Table Filter Ids. Deprecated, use rowFilters instead.",
      )
      .optional()
      .meta({ deprecated: true }),
    inlineFilters: z
      .record(z.string(), z.array(z.string()))
      .describe(
        "Inline filters to apply to the fact table. Keys are column names, values are arrays of values to filter by. Deprecated, use rowFilters instead.",
      )
      .optional()
      .meta({ deprecated: true }),
    rowFilters: z
      .array(apiRowFilterValidator)
      .describe(
        "Filters to apply to the rows of the fact table before aggregation.",
      )
      .optional(),
  })
  .describe("Only when metricType is 'ratio'");

const postQuantileSettings = z
  .object({
    type: z
      .enum(["event", "unit"])
      .describe(
        "Whether the quantile is over unit aggregations or raw event values",
      ),
    ignoreZeros: z
      .boolean()
      .describe(
        "If true, zero values will be ignored when calculating the quantile",
      ),
    quantile: z
      .number()
      .multipleOf(0.001)
      .gte(0.001)
      .lte(0.999)
      .describe("The quantile value (from 0.001 to 0.999)"),
  })
  .describe(
    'Controls the settings for quantile metrics (mandatory if metricType is "quantile")',
  );

const postCappingSettings = z
  .object({
    type: z.enum(["none", "absolute", "percentile"]),
    value: z
      .number()
      .describe(
        "When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0).",
      )
      .optional(),
    ignoreZeros: z
      .boolean()
      .describe(
        "If true and capping is `percentile`, zeros will be ignored when calculating the percentile.",
      )
      .optional(),
  })
  .describe("Controls how outliers are handled");

const postWindowSettings = z
  .object({
    type: z.enum(["none", "conversion", "lookback"]),
    delayHours: z
      .number()
      .describe(
        "Wait this many hours after experiment exposure before counting conversions. Ignored if delayValue is set.",
      )
      .optional()
      .meta({ deprecated: true }),
    delayValue: z
      .number()
      .describe(
        "Wait this long after experiment exposure before counting conversions.",
      )
      .optional(),
    delayUnit: z
      .enum(["minutes", "hours", "days", "weeks"])
      .describe("Default `hours`.")
      .optional(),
    windowValue: z.number().optional(),
    windowUnit: z
      .enum(["minutes", "hours", "days", "weeks"])
      .describe("Default `hours`.")
      .optional(),
  })
  .describe("Controls the conversion window for the metric");

const postPriorSettings = z
  .object({
    override: z
      .boolean()
      .describe(
        "If false, the organization default settings will be used instead of the other settings in this object",
      ),
    proper: z
      .boolean()
      .describe(
        "If true, the `mean` and `stddev` will be used, otherwise we will use an improper flat prior.",
      ),
    mean: z
      .number()
      .describe(
        "The mean of the prior distribution of relative effects in proportion terms (e.g. 0.01 is 1%)",
      ),
    stddev: z
      .number()
      .gt(0)
      .describe(
        "Must be > 0. The standard deviation of the prior distribution of relative effects in proportion terms.",
      ),
  })
  .describe(
    "Controls the bayesian prior for the metric. If omitted, organization defaults will be used.",
  );

const postRegressionAdjustmentSettings = z
  .object({
    override: z
      .boolean()
      .describe("If false, the organization default settings will be used"),
    enabled: z
      .boolean()
      .describe(
        "Controls whether or not regression adjustment is applied to the metric",
      )
      .optional(),
    days: z
      .number()
      .describe(
        "Number of pre-exposure days to use for the regression adjustment",
      )
      .optional(),
  })
  .describe(
    "Controls the regression adjustment (CUPED) settings for the metric",
  );

// Corresponds to payload-schemas/PostFactMetricPayload.yaml
const postFactMetricBody = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    owner: ownerInputField.optional(),
    projects: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    metricType: apiMetricTypeEnum,
    numerator: postNumeratorRef,
    denominator: postDenominatorRef.optional(),
    inverse: z
      .boolean()
      .describe(
        "Set to true for things like Bounce Rate, where you want the metric to decrease",
      )
      .optional(),
    quantileSettings: postQuantileSettings.optional(),
    cappingSettings: postCappingSettings.optional(),
    windowSettings: postWindowSettings.optional(),
    priorSettings: postPriorSettings.optional(),
    regressionAdjustmentSettings: postRegressionAdjustmentSettings.optional(),
    riskThresholdSuccess: z
      .number()
      .gte(0)
      .describe(
        "No longer used. Threshold for Risk to be considered low enough, as a proportion (e.g. put 0.0025 for 0.25%). <br/> Must be a non-negative number and must not be higher than `riskThresholdDanger`.",
      )
      .optional()
      .meta({ deprecated: true }),
    riskThresholdDanger: z
      .number()
      .gte(0)
      .describe(
        "No longer used. Threshold for Risk to be considered too high, as a proportion (e.g. put 0.0125 for 1.25%). <br/> Must be a non-negative number.",
      )
      .optional()
      .meta({ deprecated: true }),
    displayAsPercentage: z
      .boolean()
      .describe(
        "If true and the metric is a ratio or dailyParticipation metric, variation means will be displayed as a percentage. Defaults to true for dailyParticipation metrics and false for ratio metrics.",
      )
      .optional(),
    minPercentChange: z
      .number()
      .gte(0)
      .describe(
        "Minimum percent change to consider uplift significant, as a proportion (e.g. put 0.005 for 0.5%)",
      )
      .optional(),
    maxPercentChange: z
      .number()
      .gte(0)
      .describe(
        "Maximum percent change to consider uplift significant, as a proportion (e.g. put 0.5 for 50%)",
      )
      .optional(),
    minSampleSize: z.number().gte(0).optional(),
    targetMDE: z
      .number()
      .gte(0)
      .describe(
        'The percentage change that you want to reliably detect before ending an experiment, as a proportion (e.g. put 0.1 for 10%). This is used to estimate the "Days Left" for running experiments.',
      )
      .optional(),
    managedBy: z
      .enum(["", "api", "admin"])
      .describe('Set this to "api" to disable editing in the GrowthBook UI')
      .optional(),
    metricAutoSlices: z
      .array(z.string())
      .describe(
        "Array of slice column names that will be automatically included in metric analysis. This is an enterprise feature.",
      )
      .optional(),
  })
  .strict();

// Corresponds to payload-schemas/UpdateFactMetricPayload.yaml
const updateFactMetricBody = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    owner: ownerInputField.optional(),
    projects: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    metricType: apiMetricTypeEnum.optional(),
    numerator: postNumeratorRef.optional(),
    denominator: postDenominatorRef.optional(),
    inverse: z
      .boolean()
      .describe(
        "Set to true for things like Bounce Rate, where you want the metric to decrease",
      )
      .optional(),
    quantileSettings: postQuantileSettings.optional(),
    cappingSettings: postCappingSettings.optional(),
    windowSettings: postWindowSettings.optional(),
    priorSettings: postPriorSettings.optional(),
    regressionAdjustmentSettings: postRegressionAdjustmentSettings.optional(),
    riskThresholdSuccess: z
      .number()
      .gte(0)
      .describe(
        "No longer used. Threshold for Risk to be considered low enough, as a proportion (e.g. put 0.0025 for 0.25%). <br/> Must be a non-negative number and must not be higher than `riskThresholdDanger`.",
      )
      .optional()
      .meta({ deprecated: true }),
    riskThresholdDanger: z
      .number()
      .gte(0)
      .describe(
        "No longer used. Threshold for Risk to be considered too high, as a proportion (e.g. put 0.0125 for 1.25%). <br/> Must be a non-negative number.",
      )
      .optional()
      .meta({ deprecated: true }),
    displayAsPercentage: z
      .boolean()
      .describe(
        "If true and the metric is a ratio or dailyParticipation metric, variation means will be displayed as a percentage. Defaults to true for dailyParticipation metrics and false for ratio metrics.",
      )
      .optional(),
    minPercentChange: z
      .number()
      .gte(0)
      .describe(
        "Minimum percent change to consider uplift significant, as a proportion (e.g. put 0.005 for 0.5%)",
      )
      .optional(),
    maxPercentChange: z
      .number()
      .gte(0)
      .describe(
        "Maximum percent change to consider uplift significant, as a proportion (e.g. put 0.5 for 50%)",
      )
      .optional(),
    minSampleSize: z.number().gte(0).optional(),
    targetMDE: z.number().gte(0).optional(),
    managedBy: z
      .enum(["", "api", "admin"])
      .describe('Set this to "api" to disable editing in the GrowthBook UI')
      .optional(),
    archived: z.boolean().optional(),
    metricAutoSlices: z
      .array(z.string())
      .describe(
        "Array of slice column names that will be automatically included in metric analysis. This is an enterprise feature.",
      )
      .optional(),
  })
  .strict();

// Corresponds to payload-schemas/PostFactMetricAnalysisPayload.yaml
const postFactMetricAnalysisBody = z
  .object({
    userIdType: z
      .string()
      .describe(
        "The identifier type to use for the analysis. If not provided, defaults to the first available identifier type in the fact table.",
      )
      .optional(),
    lookbackDays: z
      .number()
      .gte(1)
      .lte(999999)
      .describe("Number of days to look back for the analysis. Defaults to 30.")
      .optional(),
    populationType: z
      .enum(["factTable", "segment"])
      .describe(
        "The type of population to analyze. Defaults to 'factTable', meaning the analysis will return the metric value for all units found in the fact table.",
      )
      .optional(),
    populationId: z
      .string()
      .nullable()
      .describe(
        "The ID of the population (e.g., segment ID) when populationType is not 'factTable'. Defaults to null.",
      )
      .optional(),
    additionalNumeratorFilters: z
      .array(z.string())
      .describe(
        "We support passing in adhoc filters for an analysis that don't live on the metric itself. These are in addition to the metric's filters. To use this, you can pass in an array of Fact Table Filter Ids.",
      )
      .optional(),
    additionalDenominatorFilters: z
      .array(z.string())
      .describe(
        "We support passing in adhoc filters for an analysis that don't live on the metric itself. These are in addition to the metric's filters. To use this, you can pass in an array of Fact Table Filter Ids.",
      )
      .optional(),
    useCache: z
      .boolean()
      .describe(
        "Whether to use a cached query if one exists. Defaults to true.",
      )
      .optional(),
  })
  .strict();

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

const analysisIdParams = z
  .object({
    id: z.string().describe("The fact metric id to analyze"),
  })
  .strict();

export const listFactMetricsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      datasourceId: z.string().describe("Filter by Data Source").optional(),
      projectId: z.string().describe("Filter by project id").optional(),
      factTableId: z
        .string()
        .describe(
          "Filter by Fact Table Id (for ratio metrics, we only look at the numerator)",
        )
        .optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      factMetrics: z.array(apiFactMetricValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all fact metrics",
  operationId: "listFactMetrics",
  tags: ["fact-metrics"],
  method: "get" as const,
  path: "/fact-metrics",
};

export const postFactMetricValidator = {
  bodySchema: postFactMetricBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      factMetric: apiFactMetricValidator,
    })
    .strict(),
  summary: "Create a single fact metric",
  operationId: "postFactMetric",
  tags: ["fact-metrics"],
  method: "post" as const,
  path: "/fact-metrics",
  exampleRequest: {
    body: {
      name: "Purchased",
      metricType: "proportion" as const,
      numerator: {
        factTableId: "ftb_abc123",
        column: "$$distinctUsers",
        filters: [] as string[],
      },
      priorSettings: {
        override: false,
        proper: false,
        mean: 0,
        stddev: 0.3,
      },
    },
  },
};

export const getFactMetricValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      factMetric: apiFactMetricValidator,
    })
    .strict(),
  summary: "Get a single fact metric",
  operationId: "getFactMetric",
  tags: ["fact-metrics"],
  method: "get" as const,
  path: "/fact-metrics/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const updateFactMetricValidator = {
  bodySchema: updateFactMetricBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      factMetric: apiFactMetricValidator,
    })
    .strict(),
  summary: "Update a single fact metric",
  operationId: "updateFactMetric",
  tags: ["fact-metrics"],
  method: "post" as const,
  path: "/fact-metrics/:id",
  exampleRequest: {
    params: { id: "abc123" },
    body: { name: "Updated Metric Name" },
  },
};

export const deleteFactMetricValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      deletedId: z
        .string()
        .describe("The ID of the deleted fact metric")
        .meta({ example: "fact__123abc" }),
    })
    .strict(),
  summary: "Deletes a single fact metric",
  operationId: "deleteFactMetric",
  tags: ["fact-metrics"],
  method: "delete" as const,
  path: "/fact-metrics/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const postFactMetricAnalysisValidator = {
  bodySchema: postFactMetricAnalysisBody.optional(),
  querySchema: z.never(),
  paramsSchema: analysisIdParams,
  responseSchema: z
    .object({
      metricAnalysis: apiMetricAnalysisValidator,
    })
    .strict(),
  summary: "Create a fact metric analysis",
  operationId: "postFactMetricAnalysis",
  tags: ["fact-metrics"],
  method: "post" as const,
  path: "/fact-metrics/:id/analysis",
  exampleRequest: { body: { lookbackDays: 90 } },
};
