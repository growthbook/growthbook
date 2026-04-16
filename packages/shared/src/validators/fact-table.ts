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
    lockedAutoSlices: z.array(z.string()).optional(),
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
    lockedAutoSlices: z.array(z.string()).optional(),
  })
  .strict();

export const createFactTablePropsValidator = z
  .object({
    name: z.string(),
    description: z.string(),
    id: z.string().optional(),
    // Only being used in middleware for fact-table POST request so this is safe
    // Remove when we migrate FactTableModel to use the BaseModel and use defaultValues instead
    // eslint-disable-next-line no-restricted-syntax
    owner: z.string().default(""),
    projects: z.array(z.string()),
    tags: z.array(z.string()),
    datasource: z.string(),
    userIdTypes: z.array(z.string()),
    sql: z.string(),
    eventName: z.string(),
    columns: z.array(createColumnPropsValidator).optional(),
    managedBy: z.enum(["", "api", "admin"]).optional(),
    autoSliceUpdatesEnabled: z.boolean().optional(),
    columnRefreshPending: z.boolean().optional(),
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
    autoSliceUpdatesEnabled: z.boolean().optional(),
    columnRefreshPending: z.boolean().optional(),
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
  "not_contains",
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
    /**
     * Cap mode for both upper tail (`value`) and optional lower tail (`lowerValue`).
     * `""` means no capping.
     */
    type: cappingTypeValidator,
    value: z.number().optional(),
    ignoreZeros: z.boolean().optional(),
    /**
     * Lower tail uses the same `type` as upper.
     * Absolute: optional floor (omit when unused); 0 is a valid floor at zero; may be negative.
     * Percentile: must be strictly between 0 and 1 when set; 0 means no lower percentile cap.
     */
    lowerValue: z.number().optional(),
  })
  .strict();

/** Minimal shape for evaluating which capping tails are active (API, DB, forms). */
export type CappingSettingsTailInput = {
  type?: "" | "none" | "absolute" | "percentile" | null;
  value?: number | null;
  lowerValue?: number | null;
};

export type CappingTailState = {
  upperPercentileCapped: boolean;
  upperAbsoluteCapped: boolean;
  lowerPercentileCapped: boolean;
  lowerAbsoluteCapped: boolean;
  anyCap: boolean;
  usesPercentile: boolean;
};

function normalizeCappingTypeForTails(
  type: CappingSettingsTailInput["type"],
): "" | "absolute" | "percentile" {
  if (type == null || type === "" || type === "none") return "";
  return type;
}

/**
 * Per-tail activation for fact-metric style capping (same rules as post/update fact metric API).
 * Upper percentile: `value` ∈ (0,1). Upper absolute: `value` > 0.
 * Lower percentile: `lowerValue` ∈ (0,1). Lower absolute: finite `lowerValue` (incl. 0).
 */
export function getCappingTailState(
  cs: CappingSettingsTailInput | null | undefined,
): CappingTailState {
  if (!cs) {
    return {
      upperPercentileCapped: false,
      upperAbsoluteCapped: false,
      lowerPercentileCapped: false,
      lowerAbsoluteCapped: false,
      anyCap: false,
      usesPercentile: false,
    };
  }
  const type = normalizeCappingTypeForTails(cs.type);
  const value = cs.value;
  const lowerValue = cs.lowerValue;

  const upperPercentileCapped =
    type === "percentile" && value != null && value > 0 && value < 1;
  const upperAbsoluteCapped = type === "absolute" && value != null && value > 0;
  const lowerPercentileCapped =
    type === "percentile" &&
    lowerValue != null &&
    lowerValue > 0 &&
    lowerValue < 1;
  const lowerAbsoluteCapped =
    type === "absolute" && lowerValue != null && Number.isFinite(lowerValue);
  const anyCap =
    upperPercentileCapped ||
    upperAbsoluteCapped ||
    lowerPercentileCapped ||
    lowerAbsoluteCapped;
  const usesPercentile =
    type === "percentile" && (upperPercentileCapped || lowerPercentileCapped);

  return {
    upperPercentileCapped,
    upperAbsoluteCapped,
    lowerPercentileCapped,
    lowerAbsoluteCapped,
    anyCap,
    usesPercentile,
  };
}

/** Upper/lower capping ordering (shared by API model and fact metric UI). */
export function validateCappingSettingsOrdering(
  cs: z.infer<typeof cappingSettingsValidator>,
): void {
  const tails = getCappingTailState(cs);
  const lowerValue = cs.lowerValue;

  if (
    tails.upperAbsoluteCapped &&
    tails.lowerAbsoluteCapped &&
    cs.value != null &&
    lowerValue != null &&
    cs.value < lowerValue
  ) {
    throw new Error(
      "Absolute ceiling (value) must be greater than or equal to absolute floor (lowerValue).",
    );
  }

  if (
    cs.type === "percentile" &&
    lowerValue != null &&
    lowerValue !== 0 &&
    (lowerValue <= 0 || lowerValue >= 1 || !Number.isFinite(lowerValue))
  ) {
    throw new Error(
      "Percentile lower cap requires lowerValue greater than 0 and less than 1. Use 0 or omit for no lower cap.",
    );
  }
  if (
    tails.upperPercentileCapped &&
    tails.lowerPercentileCapped &&
    lowerValue != null &&
    cs.value != null &&
    lowerValue >= cs.value
  ) {
    throw new Error(
      "Lower percentile (lowerValue) must be less than upper percentile (value).",
    );
  }
}

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
  "dailyParticipation",
]);

export const factMetricValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    managedBy: z.enum(["", "api", "admin"]).optional(),
    owner: z.string(),
    datasource: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()),
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
