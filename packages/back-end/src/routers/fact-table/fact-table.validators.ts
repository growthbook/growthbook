import { z } from "zod";

export const factTableColumnTypeValidator = z.enum([
  "number",
  "string",
  "date",
  "boolean",
  "other",
  "",
]);

export const numberFormatValidator = z.enum(["", "currency", "time:seconds"]);

export const createColumnPropsValidator = z
  .object({
    column: z.string(),
    name: z.string(),
    description: z.string(),
    numberFormat: numberFormatValidator,
    datatype: factTableColumnTypeValidator,
    deleted: z.boolean().optional(),
  })
  .strict();

export const updateColumnPropsValidator = z
  .object({
    name: z.string(),
    description: z.string(),
    numberFormat: numberFormatValidator,
    datatype: factTableColumnTypeValidator,
    deleted: z.boolean().optional(),
  })
  .strict();

export const createFactTablePropsValidator = z
  .object({
    name: z.string(),
    description: z.string(),
    id: z.string().optional(),
    owner: z.string().optional(),
    projects: z.array(z.string()),
    tags: z.array(z.string()),
    datasource: z.string(),
    userIdTypes: z.array(z.string()),
    sql: z.string(),
    eventName: z.string(),
    columns: z.array(createColumnPropsValidator),
    managedBy: z.enum(["", "api"]).optional(),
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
    managedBy: z.enum(["", "api"]).optional(),
    columnsError: z.string().nullable().optional(),
  })
  .strict();

export const columnRefValidator = z
  .object({
    factTableId: z.string(),
    column: z.string(),
    filters: z.array(z.string()),
  })
  .strict();

export const metricTypeValidator = z.enum(["ratio", "mean", "proportion"]);
export const cappingValidator = z.enum(["absolute", "percentile", ""]);
export const conversionWindowUnitValidator = z.enum(["weeks", "days", "hours"]);

export const createFactMetricPropsValidator = z.object({
  id: z.string().optional(),
  owner: z.string().optional(),
  datasource: z.string(),
  name: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  projects: z.array(z.string()),
  managedBy: z.enum(["", "api"]).optional(),

  metricType: metricTypeValidator,
  numerator: columnRefValidator,
  denominator: columnRefValidator.nullable(),

  capping: cappingValidator,
  capValue: z.number(),
  inverse: z.boolean(),

  maxPercentChange: z.number(),
  minPercentChange: z.number(),
  minSampleSize: z.number(),
  winRisk: z.number(),
  loseRisk: z.number(),

  regressionAdjustmentOverride: z.boolean(),
  regressionAdjustmentEnabled: z.boolean(),
  regressionAdjustmentDays: z.number(),

  conversionDelayHours: z.number(),
  hasConversionWindow: z.boolean(),
  conversionWindowValue: z.number(),
  conversionWindowUnit: conversionWindowUnitValidator,
});

export const updateFactMetricPropsValidator = z.object({
  owner: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  projects: z.array(z.string()).optional(),
  managedBy: z.enum(["", "api"]).optional(),

  metricType: metricTypeValidator.optional(),
  numerator: columnRefValidator.optional(),
  denominator: columnRefValidator.nullable().optional(),

  capping: cappingValidator.optional(),
  capValue: z.number().optional(),
  inverse: z.boolean().optional(),

  maxPercentChange: z.number().optional(),
  minPercentChange: z.number().optional(),
  minSampleSize: z.number().optional(),
  winRisk: z.number().optional(),
  loseRisk: z.number().optional(),

  regressionAdjustmentOverride: z.boolean().optional(),
  regressionAdjustmentEnabled: z.boolean().optional(),
  regressionAdjustmentDays: z.number().optional(),

  conversionDelayHours: z.number().optional(),
  hasConversionWindow: z.boolean().optional(),
  conversionWindowValue: z.number().optional(),
  conversionWindowUnit: conversionWindowUnitValidator.optional(),
});

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
