import { z } from "zod";
import { ownerField, ownerInputField } from "./owner-field";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

import { namedSchema } from "./openapi-helpers";

// Corresponds to schemas/Metric.yaml
export const apiMetricValidator = namedSchema(
  "Metric",
  z
    .object({
      id: z.string(),
      managedBy: z
        .enum(["", "api", "config", "admin"])
        .describe(
          "Where this metric must be managed from. If not set (empty string), it can be managed from anywhere.",
        ),
      dateCreated: z.string(),
      dateUpdated: z.string(),
      owner: ownerField,
      datasourceId: z.string(),
      name: z.string(),
      description: z.string(),
      type: z.enum(["binomial", "count", "duration", "revenue"]),
      tags: z.array(z.string()),
      projects: z.array(z.string()),
      archived: z.boolean(),
      behavior: z.object({
        goal: z.enum(["increase", "decrease"]),
        cappingSettings: z
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
          .describe("Controls how outliers are handled")
          .optional(),
        cap: z.coerce.number().optional().meta({ deprecated: true }),
        capping: z
          .enum(["absolute", "percentile"])
          .nullable()
          .optional()
          .meta({ deprecated: true }),
        capValue: z.coerce.number().optional().meta({ deprecated: true }),
        windowSettings: z
          .object({
            type: z.enum(["none", "conversion", "lookback"]),
            delayValue: z.coerce
              .number()
              .describe(
                "Wait this long after experiment exposure before counting conversions",
              )
              .optional(),
            delayUnit: z.enum(["minutes", "hours", "days", "weeks"]).optional(),
            windowValue: z.coerce.number().optional(),
            windowUnit: z
              .enum(["minutes", "hours", "days", "weeks"])
              .optional(),
          })
          .describe("Controls the conversion window for the metric"),
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
            mean: z.coerce
              .number()
              .describe(
                "The mean of the prior distribution of relative effects in proportion terms (e.g. 0.01 is 1%)",
              ),
            stddev: z.coerce
              .number()
              .describe(
                "Must be > 0. The standard deviation of the prior distribution of relative effects in proportion terms.",
              ),
          })
          .describe("Controls the bayesian prior for the metric.")
          .optional(),
        conversionWindowStart: z.coerce
          .number()
          .optional()
          .meta({ deprecated: true }),
        conversionWindowEnd: z.coerce
          .number()
          .optional()
          .meta({ deprecated: true }),
        riskThresholdSuccess: z.coerce.number(),
        riskThresholdDanger: z.coerce.number(),
        minPercentChange: z.coerce.number(),
        maxPercentChange: z.coerce.number(),
        minSampleSize: z.coerce.number(),
        targetMDE: z.coerce.number(),
      }),
      sql: z
        .object({
          identifierTypes: z.array(z.string()),
          conversionSQL: z.string(),
          userAggregationSQL: z.string(),
          denominatorMetricId: z.string(),
        })
        .optional(),
      sqlBuilder: z
        .object({
          identifierTypeColumns: z.array(
            z.object({
              identifierType: z.string(),
              columnName: z.string(),
            }),
          ),
          tableName: z.string(),
          valueColumnName: z.string(),
          timestampColumnName: z.string(),
          conditions: z.array(
            z.object({
              column: z.string(),
              operator: z.string(),
              value: z.string(),
            }),
          ),
        })
        .optional(),
      mixpanel: z
        .object({
          eventName: z.string(),
          eventValue: z.string(),
          userAggregation: z.string(),
          conditions: z.array(
            z.object({
              property: z.string(),
              operator: z.string(),
              value: z.string(),
            }),
          ),
        })
        .optional(),
    })
    .strict(),
);

export type ApiMetric = z.infer<typeof apiMetricValidator>;

// Corresponds to schemas/MetricUsage.yaml
export const apiMetricUsageValidator = namedSchema(
  "MetricUsage",
  z
    .object({
      metricId: z.string().describe("The metric ID"),
      error: z
        .string()
        .describe(
          "Set when the metric does not exist or the caller has no permission to read it.",
        )
        .optional(),
      experiments: z
        .array(
          z.object({
            experimentId: z.string().describe("The experiment ID"),
            experimentStatus: z
              .enum(["draft", "running", "stopped"])
              .describe("The current status of the experiment"),
            lastSnapshotAttempt: z
              .string()
              .meta({ format: "date-time" })
              .nullable()
              .describe(
                "The last time a snapshot was attempted for this experiment",
              ),
          }),
        )
        .describe("List of experiments using this metric")
        .optional(),
      lastSnapshotAttempt: z
        .string()
        .meta({ format: "date-time" })
        .nullable()
        .describe(
          "The most recent snapshot attempt across all experiments using this metric",
        )
        .optional(),
    })
    .strict(),
);

export type ApiMetricUsage = z.infer<typeof apiMetricUsageValidator>;

// Corresponds to payload-schemas/PostMetricPayload.yaml
const postMetricBody = z
  .object({
    datasourceId: z
      .string()
      .describe("ID for the [DataSource](#tag/DataSource_model)"),
    managedBy: z
      .enum(["", "api"])
      .describe(
        'Where this metric must be managed from. If not set (empty string), it can be managed from anywhere. If set to "api", it can be managed via the API only.',
      )
      .optional(),
    owner: ownerInputField.optional(),
    name: z.string().describe("Name of the metric"),
    description: z.string().describe("Description of the metric").optional(),
    type: z
      .enum(["binomial", "count", "duration", "revenue"])
      .describe(
        "Type of metric. See [Metrics documentation](/app/metrics/legacy)",
      ),
    tags: z.array(z.string()).describe("List of tags").optional(),
    projects: z
      .array(z.string())
      .describe("List of project IDs for projects that can access this metric")
      .optional(),
    archived: z.boolean().optional(),
    behavior: z
      .object({
        goal: z.enum(["increase", "decrease"]).optional(),
        cappingSettings: z
          .object({
            type: z.enum(["none", "absolute", "percentile"]).nullable(),
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
        cap: z
          .number()
          .gte(0)
          .describe(
            "(deprecated, use cappingSettings instead) This should be non-negative",
          )
          .optional()
          .meta({ deprecated: true }),
        capping: z
          .enum(["absolute", "percentile"])
          .nullable()
          .describe(
            '(deprecated, use cappingSettings instead) Used in conjunction with `capValue` to set the capping (winsorization). Do not specify or set to null for no capping. "absolute" will cap user values at the `capValue` if it is greater than 0. "percentile" will cap user values at the percentile of user values in an experiment using the `capValue` for the percentile, if greater than 0. <br/>  If `behavior.capping` is non-null, you must specify `behavior.capValue`.',
          )
          .optional()
          .meta({ deprecated: true }),
        capValue: z
          .number()
          .gte(0)
          .describe(
            "(deprecated, use cappingSettings instead) This should be non-negative. <br/> Must specify `behavior.capping` when setting `behavior.capValue`.",
          )
          .optional()
          .meta({ deprecated: true }),
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
              .optional(),
          })
          .describe("Controls the conversion window for the metric")
          .optional(),
        conversionWindowStart: z
          .number()
          .describe(
            "The start of a Conversion Window relative to the exposure date, in hours. This is equivalent to the [Conversion Delay](/app/metrics/legacy/#conversion-delay). <br/> Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither.",
          )
          .optional()
          .meta({ deprecated: true }),
        conversionWindowEnd: z
          .number()
          .describe(
            "The end of a [Conversion Window](/app/metrics/legacy/#conversion-window) relative to the exposure date, in hours. This is equivalent to the [Conversion Delay](/app/metrics/legacy/#conversion-delay) + Conversion Window Hours settings in the UI. In other words, if you want a 48 hour window starting after 24 hours, you would set conversionWindowStart to 24 and conversionWindowEnd to 72 (24+48). <br/> Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither.",
          )
          .optional()
          .meta({ deprecated: true }),
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
      })
      .optional(),
    sql: z
      .object({
        identifierTypes: z.array(z.string()),
        conversionSQL: z.string(),
        userAggregationSQL: z
          .string()
          .describe(
            "Custom user level aggregation for your metric (default: `SUM(value)`)",
          )
          .optional(),
        denominatorMetricId: z
          .string()
          .describe(
            "The metric ID for a [denominator metric for funnel and ratio metrics](/app/metrics/legacy/#denominator-ratio--funnel-metrics)",
          )
          .optional(),
      })
      .describe(
        "Preferred way to define SQL. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed, and at least one must be specified.",
      )
      .optional(),
    sqlBuilder: z
      .object({
        identifierTypeColumns: z.array(
          z.object({
            identifierType: z.string(),
            columnName: z.string(),
          }),
        ),
        tableName: z.string(),
        valueColumnName: z.string().optional(),
        timestampColumnName: z.string(),
        conditions: z
          .array(
            z.object({
              column: z.string(),
              operator: z.string(),
              value: z.string(),
            }),
          )
          .optional(),
      })
      .describe(
        "An alternative way to specify a SQL metric, rather than a full query. Using `sql` is preferred to `sqlBuilder`. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed, and at least one must be specified.",
      )
      .optional(),
    mixpanel: z
      .object({
        eventName: z.string(),
        eventValue: z.string().optional(),
        userAggregation: z.string(),
        conditions: z
          .array(
            z.object({
              property: z.string(),
              operator: z.string(),
              value: z.string(),
            }),
          )
          .optional(),
      })
      .describe(
        "Only use for MixPanel (non-SQL) Data Sources. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed, and at least one must be specified.",
      )
      .optional(),
  })
  .strict();

// Corresponds to payload-schemas/PutMetricRequestPayload.yaml
const putMetricBody = z
  .object({
    managedBy: z
      .enum(["", "api", "admin"])
      .describe(
        'Where this metric must be managed from. If not set (empty string), it can be managed from anywhere. If set to "api", it can be managed via the API only. Please note that we have deprecated support for setting the managedBy property to "admin". Your existing Legacy Metrics with this value will continue to work, but we suggest migrating to Fact Metrics instead.',
      )
      .optional(),
    owner: ownerInputField.optional(),
    name: z.string().describe("Name of the metric").optional(),
    description: z.string().describe("Description of the metric").optional(),
    type: z
      .enum(["binomial", "count", "duration", "revenue"])
      .describe(
        "Type of metric. See [Metrics documentation](/app/metrics/legacy)",
      )
      .optional(),
    tags: z.array(z.string()).describe("List of tags").optional(),
    projects: z
      .array(z.string())
      .describe("List of project IDs for projects that can access this metric")
      .optional(),
    archived: z.boolean().optional(),
    behavior: z
      .object({
        goal: z.enum(["increase", "decrease"]).optional(),
        cappingSettings: z
          .object({
            type: z.enum(["none", "absolute", "percentile"]).nullable(),
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
        cap: z
          .number()
          .gte(0)
          .describe(
            "(deprecated, use cappingSettings instead) This should be non-negative",
          )
          .optional()
          .meta({ deprecated: true }),
        capping: z
          .enum(["absolute", "percentile"])
          .nullable()
          .describe(
            '(deprecated, use cappingSettings instead) Used in conjunction with `capValue` to set the capping (winsorization). Do not specify or set to null for no capping. "absolute" will cap user values at the `capValue` if it is greater than 0. "percentile" will cap user values at the percentile of user values in an experiment using the `capValue` for the percentile, if greater than 0. <br/>  If `behavior.capping` is non-null, you must specify `behavior.capValue`.',
          )
          .optional()
          .meta({ deprecated: true }),
        capValue: z
          .number()
          .gte(0)
          .describe(
            "(deprecated, use cappingSettings instead) This should be non-negative. <br/> Must specify `behavior.capping` when setting `behavior.capValue`.",
          )
          .optional()
          .meta({ deprecated: true }),
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
              .optional(),
          })
          .describe("Controls the conversion window for the metric")
          .optional(),
        conversionWindowStart: z
          .number()
          .describe(
            "The start of a Conversion Window relative to the exposure date, in hours. This is equivalent to the [Conversion Delay](/app/metrics/legacy/#conversion-delay). <br/> Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither.",
          )
          .optional()
          .meta({ deprecated: true }),
        conversionWindowEnd: z
          .number()
          .describe(
            "The end of a [Conversion Window](/app/metrics/legacy/#conversion-window) relative to the exposure date, in hours. This is equivalent to the [Conversion Delay](/app/metrics/legacy/#conversion-delay) + Conversion Window Hours settings in the UI. In other words, if you want a 48 hour window starting after 24 hours, you would set conversionWindowStart to 24 and conversionWindowEnd to 72 (24+48). <br/> Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither.",
          )
          .optional()
          .meta({ deprecated: true }),
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
      })
      .optional(),
    sql: z
      .object({
        identifierTypes: z.array(z.string()).optional(),
        conversionSQL: z.string().optional(),
        userAggregationSQL: z
          .string()
          .describe(
            "Custom user level aggregation for your metric (default: `SUM(value)`)",
          )
          .optional(),
        denominatorMetricId: z
          .string()
          .describe(
            "The metric ID for a [denominator metric for funnel and ratio metrics](/app/metrics/legacy/#denominator-ratio--funnel-metrics)",
          )
          .optional(),
      })
      .describe(
        "Preferred way to define SQL. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed.",
      )
      .optional(),
    sqlBuilder: z
      .object({
        identifierTypeColumns: z
          .array(
            z.object({
              identifierType: z.string(),
              columnName: z.string(),
            }),
          )
          .optional(),
        tableName: z.string().optional(),
        valueColumnName: z.string().optional(),
        timestampColumnName: z.string().optional(),
        conditions: z
          .array(
            z.object({
              column: z.string(),
              operator: z.string(),
              value: z.string(),
            }),
          )
          .optional(),
      })
      .describe(
        "An alternative way to specify a SQL metric, rather than a full query. Using `sql` is preferred to `sqlBuilder`. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed",
      )
      .optional(),
    mixpanel: z
      .object({
        eventName: z.string().optional(),
        eventValue: z.string().optional(),
        userAggregation: z.string().optional(),
        conditions: z
          .array(
            z.object({
              property: z.string(),
              operator: z.string(),
              value: z.string(),
            }),
          )
          .optional(),
      })
      .describe(
        "Only use for MixPanel (non-SQL) Data Sources. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed.",
      )
      .optional(),
  })
  .strict();

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const listMetricsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      projectId: z.string().describe("Filter by project id").optional(),
      datasourceId: z.string().describe("Filter by Data Source").optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      metrics: z.array(apiMetricValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all metrics",
  operationId: "listMetrics",
  tags: ["metrics"],
  method: "get" as const,
  path: "/metrics",
};

export const postMetricValidator = {
  bodySchema: postMetricBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      metric: apiMetricValidator,
    })
    .strict(),
  summary: "Create a single metric",
  operationId: "postMetric",
  tags: ["metrics"],
  method: "post" as const,
  path: "/metrics",
};

export const getMetricValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      metric: apiMetricValidator,
    })
    .strict(),
  summary: "Get a single metric",
  operationId: "getMetric",
  tags: ["metrics"],
  method: "get" as const,
  path: "/metrics/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const putMetricValidator = {
  bodySchema: putMetricBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      updatedId: z.string(),
    })
    .strict(),
  summary: "Update a metric",
  operationId: "putMetric",
  tags: ["metrics"],
  method: "put" as const,
  path: "/metrics/:id",
  exampleRequest: {
    params: { id: "abc123" },
    body: {
      name: "net revenue",
      description: "revenue minus lacroix spend",
    },
  },
};

export const deleteMetricValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      deletedId: z.string(),
    })
    .strict(),
  summary: "Deletes a metric",
  operationId: "deleteMetric",
  tags: ["metrics"],
  method: "delete" as const,
  path: "/metrics/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const getMetricUsageValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ids: z
        .string()
        .describe(
          "List of comma-separated metric IDs (both fact and legacy) to get usage for, e.g. ids=met_123,fact_456",
        ),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      metricUsage: z.array(apiMetricUsageValidator),
    })
    .strict(),
  summary: "Get metric usage across experiments",
  description:
    "Returns usage information for one or more legacy or fact metrics, showing which experiments use each metric\nand some usage statistics. If a metric is part of a metric group, then usage of that metric group counts as\nusage of all metrics in the group. Warning: only includes experiments that you have access to! If you do not have admin\naccess or read access to experiments across all projects, this endpoint may not return the latest usage data across\nall experiments. \n",
  operationId: "getMetricUsage",
  tags: ["usage"],
  method: "get" as const,
  path: "/usage/metrics",
};
