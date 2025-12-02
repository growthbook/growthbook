import { z } from "zod";

// If you change these types, also update the factTableColumnTypeValidator to match
export const factTableColumnTypes = [
  "number",
  "string",
  "date",
  "boolean",
  "json",
  "other",
  "",
];
// Duplicate of the above as we can't use `as const` without breaking imports in the frontend
export const factTableColumnTypeValidator = z.enum([
  "number",
  "string",
  "date",
  "boolean",
  "json",
  "other",
  "",
]);

export const numberFormatValidator = z.enum([
  "",
  "currency",
  "time:seconds",
  "memory:bytes",
  "memory:kilobytes",
]);

export const jsonColumnFieldsValidator = z.record(
  z.string(),
  z.object({
    datatype: factTableColumnTypeValidator,
  }),
);

export const createColumnPropsValidator = z
  .object({
    column: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    numberFormat: numberFormatValidator.optional(),
    datatype: factTableColumnTypeValidator,
    jsonFields: jsonColumnFieldsValidator.optional(),
    deleted: z.boolean().optional(),
    alwaysInlineFilter: z.boolean().optional(),
    topValues: z.array(z.string()).optional(),
    isAutoSliceColumn: z.boolean().optional(),
    autoSlices: z.array(z.string()).optional(),
  })
  .strict();

export const updateColumnPropsValidator = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    numberFormat: numberFormatValidator.optional(),
    datatype: factTableColumnTypeValidator.optional(),
    jsonFields: jsonColumnFieldsValidator.optional(),
    alwaysInlineFilter: z.boolean().optional(),
    topValues: z.array(z.string()).optional(),
    deleted: z.boolean().optional(),
    isAutoSliceColumn: z.boolean().optional(),
    autoSlices: z.array(z.string()).optional(),
  })
  .strict();

export const createFactTablePropsValidator = z
  .object({
    name: z.string(),
    description: z.string(),
    id: z.string().optional(),
    owner: z.string().default(""),
    projects: z.array(z.string()),
    tags: z.array(z.string()),
    datasource: z.string(),
    userIdTypes: z.array(z.string()),
    sql: z.string(),
    eventName: z.string(),
    columns: z.array(createColumnPropsValidator).optional(),
    managedBy: z.enum(["", "api", "admin"]).optional(),
  })
  .strict();

export const updateFactTablePropsValidator = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    owner: z.string().optional(),
    projects: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    userIdTypes: z.array(z.string()).optional(),
    sql: z.string().optional(),
    eventName: z.string().optional(),
    columns: z.array(createColumnPropsValidator).optional(),
    managedBy: z.enum(["", "api", "admin"]).optional(),
    columnsError: z.string().nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict();

export const columnAggregationValidator = z.enum([
  "sum",
  "max",
  "count distinct",
]);

export const rowFilterOperators = [
  "=",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "in",
  "not_in",
  "contains",
  "starts_with",
  "ends_with",
  "is_null",
  "not_null",
  "is_true",
  "is_false",
  "sql_expr",
  "saved_filter",
] as const;

export const rowFilterValidator = z.object({
  operator: z.enum(rowFilterOperators),
  column: z.string().optional(),
  values: z.array(z.string()).optional(),
});

export const columnRefValidator = z
  .object({
    factTableId: z.string(),
    column: z.string(),
    aggregation: columnAggregationValidator.optional(),
    rowFilters: z.array(rowFilterValidator).optional(),
    aggregateFilter: z.string().optional(),
    aggregateFilterColumn: z.string().optional(),
  })
  .strict();

export const cappingTypeValidator = z.enum(["absolute", "percentile", ""]);
export const conversionWindowUnitValidator = z.enum([
  "weeks",
  "days",
  "hours",
  "minutes",
]);
export const windowTypeValidator = z.enum(["conversion", "lookback", ""]);

export const cappingSettingsValidator = z
  .object({
    type: cappingTypeValidator,
    value: z.number(),
    ignoreZeros: z.boolean().optional(),
  })
  .strict();

export const legacyWindowSettingsValidator = z.object({
  type: windowTypeValidator.optional(),
  delayHours: z.coerce.number().optional(),
  delayValue: z.coerce.number().optional(),
  delayUnit: conversionWindowUnitValidator.optional(),
  windowValue: z.number().optional(),
  windowUnit: conversionWindowUnitValidator.optional(),
});

export const windowSettingsValidator = z.object({
  type: windowTypeValidator,
  delayValue: z.coerce.number(),
  delayUnit: conversionWindowUnitValidator,
  windowValue: z.number(),
  windowUnit: conversionWindowUnitValidator,
});

export const quantileSettingsValidator = z.object({
  quantile: z.number(),
  type: z.enum(["unit", "event"]),
  ignoreZeros: z.boolean(),
});

export const priorSettingsValidator = z.object({
  override: z.boolean(),
  proper: z.boolean(),
  mean: z.number(),
  stddev: z.number(),
});

export const metricTypeValidator = z.enum([
  "ratio",
  "mean",
  "proportion",
  "retention",
  "quantile",
]);

export const factMetricValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    managedBy: z.enum(["", "api", "admin"]).optional(),
    owner: z.string().default(""),
    datasource: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()).default([]),
    projects: z.array(z.string()),
    inverse: z.boolean(),
    archived: z.boolean().optional(),

    metricType: metricTypeValidator,
    numerator: columnRefValidator,
    denominator: columnRefValidator.nullable(),

    cappingSettings: cappingSettingsValidator,
    windowSettings: windowSettingsValidator,
    priorSettings: priorSettingsValidator,

    maxPercentChange: z.number(),
    minPercentChange: z.number(),
    minSampleSize: z.number(),
    targetMDE: z.number().optional(),
    displayAsPercentage: z.boolean().optional(),

    winRisk: z.number(),
    loseRisk: z.number(),

    regressionAdjustmentOverride: z.boolean(),
    regressionAdjustmentEnabled: z.boolean(),
    regressionAdjustmentDays: z.number(),

    metricAutoSlices: z.array(z.string()).optional(),

    quantileSettings: quantileSettingsValidator.nullable(),
  })
  .strict();

export const createFactFilterPropsValidator = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    description: z.string(),
    value: z.string(),
    managedBy: z.enum(["", "api"]).optional(),
  })
  .strict();

export const updateFactFilterPropsValidator = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    value: z.string().optional(),
    managedBy: z.enum(["", "api"]).optional(),
  })
  .strict();

export const testFactFilterPropsValidator = z
  .object({
    value: z.string(),
  })
  .strict();
