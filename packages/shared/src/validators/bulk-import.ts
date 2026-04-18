import { z } from "zod";
import { ownerInputField } from "./owner-field";

// Corresponds to payload-schemas/BulkImportFactsPayload.yaml
// The body references PostFactTablePayload, PostFactTableFilterPayload, and PostFactMetricPayload
const postBulkImportFactsBody = z
  .object({
    factTables: z
      .array(
        z.object({
          id: z.string(),
          data: z.object({
            name: z.string(),
            description: z
              .string()
              .describe("Description of the fact table")
              .optional(),
            owner: ownerInputField.optional(),
            projects: z
              .array(z.string())
              .describe("List of associated project ids")
              .optional(),
            tags: z
              .array(z.string())
              .describe("List of associated tags")
              .optional(),
            datasource: z.string().describe("The datasource id"),
            userIdTypes: z
              .array(z.string())
              .describe(
                'List of identifier columns in this table. For example, "id" or "anonymous_id"',
              ),
            sql: z.string().describe("The SQL query for this fact table"),
            eventName: z
              .string()
              .describe("The event name used in SQL template variables")
              .optional(),
            managedBy: z
              .enum(["", "api", "admin"])
              .describe(
                'Set this to "api" to disable editing in the GrowthBook UI',
              )
              .optional(),
          }),
        }),
      )
      .optional(),
    factTableFilters: z
      .array(
        z.object({
          factTableId: z.string(),
          id: z.string(),
          data: z.object({
            name: z.string(),
            description: z
              .string()
              .describe("Description of the fact table filter")
              .optional(),
            value: z
              .string()
              .describe("The SQL expression for this filter.")
              .meta({ example: "country = 'US'" }),
            managedBy: z
              .enum(["", "api"])
              .describe(
                'Set this to "api" to disable editing in the GrowthBook UI. Before you do this, the Fact Table itself must also be marked as "api"',
              )
              .optional(),
          }),
        }),
      )
      .optional(),
    factMetrics: z
      .array(
        z.object({
          id: z.string(),
          data: z.object({
            name: z.string(),
            description: z.string().optional(),
            owner: ownerInputField.optional(),
            projects: z.array(z.string()).optional(),
            tags: z.array(z.string()).optional(),
            metricType: z.enum([
              "proportion",
              "retention",
              "mean",
              "quantile",
              "ratio",
              "dailyParticipation",
            ]),
            numerator: z.object({
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
                .array(
                  z.object({
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
                      .describe(
                        "Required for all operators except sql_expr and saved_filter.",
                      )
                      .optional(),
                  }),
                )
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
            }),
            denominator: z
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
                  .array(
                    z.object({
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
                        .describe(
                          "Required for all operators except sql_expr and saved_filter.",
                        )
                        .optional(),
                    }),
                  )
                  .describe(
                    "Filters to apply to the rows of the fact table before aggregation.",
                  )
                  .optional(),
              })
              .describe("Only when metricType is 'ratio'")
              .optional(),
            inverse: z
              .boolean()
              .describe(
                "Set to true for things like Bounce Rate, where you want the metric to decrease",
              )
              .optional(),
            quantileSettings: z
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
              )
              .optional(),
            cappingSettings: z
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
              .describe("Controls how outliers are handled")
              .optional(),
            windowSettings: z
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
              .describe("Controls the conversion window for the metric")
              .optional(),
            priorSettings: z
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
              )
              .optional(),
            regressionAdjustmentSettings: z
              .object({
                override: z
                  .boolean()
                  .describe(
                    "If false, the organization default settings will be used",
                  ),
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
              )
              .optional(),
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
              .describe(
                'Set this to "api" to disable editing in the GrowthBook UI',
              )
              .optional(),
            metricAutoSlices: z
              .array(z.string())
              .describe(
                "Array of slice column names that will be automatically included in metric analysis. This is an enterprise feature.",
              )
              .optional(),
          }),
        }),
      )
      .optional(),
  })
  .strict();

export const postBulkImportFactsValidator = {
  bodySchema: postBulkImportFactsBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      success: z.boolean(),
      factTablesAdded: z.coerce.number().int(),
      factTablesUpdated: z.coerce.number().int(),
      factTableFiltersAdded: z.coerce.number().int(),
      factTableFiltersUpdated: z.coerce.number().int(),
      factMetricsAdded: z.coerce.number().int(),
      factMetricsUpdated: z.coerce.number().int(),
    })
    .strict(),
  summary: "Bulk import fact tables, filters, and metrics",
  operationId: "postBulkImportFacts",
  tags: ["fact-tables"],
  method: "post" as const,
  path: "/bulk-import/facts",
  exampleRequest: {
    body: { factTables: [], factTableFilters: [], factMetrics: [] },
  },
};
