import { z } from "zod";
import { ownerField, ownerInputField } from "./owner-field";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

import { namedSchema } from "./openapi-helpers";

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
    owner: ownerInputField.default(""),
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
    owner: ownerInputField.optional(),
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
  "dailyParticipation",
]);

export const factMetricValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    managedBy: z.enum(["", "api", "admin"]).optional(),
    owner: ownerField,
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

// ---- API Validators (migrated from openapi.ts) ----

// Corresponds to schemas/FactTableColumn.yaml
export const apiFactTableColumnValidator = namedSchema(
  "FactTableColumn",
  z
    .object({
      column: z
        .string()
        .describe("The actual column name in the database/SQL query"),
      datatype: z.enum([
        "number",
        "string",
        "date",
        "boolean",
        "json",
        "other",
        "",
      ]),
      numberFormat: z
        .enum([
          "",
          "currency",
          "time:seconds",
          "memory:bytes",
          "memory:kilobytes",
        ])
        .optional(),
      jsonFields: z
        .record(
          z.string(),
          z.object({
            datatype: z
              .enum([
                "number",
                "string",
                "date",
                "boolean",
                "json",
                "other",
                "",
              ])
              .optional(),
          }),
        )
        .describe("For JSON columns, defines the structure of nested fields")
        .optional(),
      name: z
        .string()
        .describe(
          "Display name for the column (can be different from the actual column name)",
        )
        .optional(),
      description: z.string().optional(),
      alwaysInlineFilter: z
        .boolean()
        .describe(
          "Whether this column should always be included as an inline filter in queries",
        )
        .optional()
        .meta({ default: false }),
      deleted: z.boolean().optional().meta({ default: false }),
      isAutoSliceColumn: z
        .boolean()
        .describe(
          "Whether this column can be used for auto slice analysis. This is an enterprise feature.",
        )
        .optional()
        .meta({ default: false }),
      autoSlices: z
        .array(z.string())
        .describe("Specific slices to automatically analyze for this column.")
        .optional(),
      lockedAutoSlices: z
        .array(z.string())
        .describe(
          "Locked slices that are protected from automatic updates. These will always be included in the slice levels even if they're not in the top values query results.",
        )
        .optional(),
      dateCreated: z
        .string()
        .meta({ format: "date-time" })
        .readonly()
        .optional(),
      dateUpdated: z
        .string()
        .meta({ format: "date-time" })
        .readonly()
        .optional(),
    })
    .strict(),
);

// Corresponds to schemas/FactTable.yaml
export const apiFactTableValidator = namedSchema(
  "FactTable",
  z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      owner: ownerField,
      projects: z.array(z.string()),
      tags: z.array(z.string()),
      datasource: z.string(),
      userIdTypes: z.array(z.string()),
      sql: z.string(),
      eventName: z
        .string()
        .describe("The event name used in SQL template variables")
        .optional(),
      columns: z
        .array(apiFactTableColumnValidator)
        .describe("Array of column definitions for this fact table")
        .optional(),
      columnsError: z
        .string()
        .nullable()
        .describe("Error message if there was an issue parsing the SQL schema")
        .optional(),
      archived: z.boolean().optional(),
      managedBy: z
        .enum(["", "api", "admin"])
        .describe(
          "Where this fact table must be managed from. If not set (empty string), it can be managed from anywhere.",
        ),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);

export type ApiFactTable = z.infer<typeof apiFactTableValidator>;

// Corresponds to schemas/FactTableFilter.yaml
export const apiFactTableFilterValidator = namedSchema(
  "FactTableFilter",
  z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      value: z.string(),
      managedBy: z
        .enum(["", "api"])
        .describe(
          "Where this fact table filter must be managed from. If not set (empty string), it can be managed from anywhere.",
        ),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);

export type ApiFactTableFilter = z.infer<typeof apiFactTableFilterValidator>;

// Corresponds to payload-schemas/PostFactTablePayload.yaml
const postFactTableBody = z
  .object({
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
    tags: z.array(z.string()).describe("List of associated tags").optional(),
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
      .describe('Set this to "api" to disable editing in the GrowthBook UI')
      .optional(),
  })
  .strict();

// Corresponds to payload-schemas/UpdateFactTablePayload.yaml
const updateFactTableBody = z
  .object({
    name: z.string().optional(),
    description: z
      .string()
      .describe("Description of the fact table")
      .optional(),
    owner: ownerInputField.optional(),
    projects: z
      .array(z.string())
      .describe("List of associated project ids")
      .optional(),
    tags: z.array(z.string()).describe("List of associated tags").optional(),
    userIdTypes: z
      .array(z.string())
      .describe(
        'List of identifier columns in this table. For example, "id" or "anonymous_id"',
      )
      .optional(),
    sql: z.string().describe("The SQL query for this fact table").optional(),
    eventName: z
      .string()
      .describe("The event name used in SQL template variables")
      .optional(),
    columns: z
      .array(apiFactTableColumnValidator)
      .describe(
        "Optional array of columns that you want to update. Only allows updating properties of existing columns. Cannot create new columns or delete existing ones. Columns cannot be added or deleted; column structure is determined by SQL parsing. Slice-related properties require an enterprise license.",
      )
      .optional(),
    columnsError: z
      .string()
      .nullable()
      .describe("Error message if there was an issue parsing the SQL schema")
      .optional(),
    managedBy: z
      .enum(["", "api", "admin"])
      .describe('Set this to "api" to disable editing in the GrowthBook UI')
      .optional(),
    archived: z.boolean().optional(),
  })
  .strict();

// Corresponds to payload-schemas/PostFactTableFilterPayload.yaml
const postFactTableFilterBody = z
  .object({
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
  })
  .strict();

// Corresponds to payload-schemas/UpdateFactTableFilterPayload.yaml
const updateFactTableFilterBody = z
  .object({
    name: z.string().optional(),
    description: z
      .string()
      .describe("Description of the fact table filter")
      .optional(),
    value: z
      .string()
      .describe("The SQL expression for this filter.")
      .meta({ example: "country = 'US'" })
      .optional(),
    managedBy: z
      .enum(["", "api"])
      .describe(
        'Set this to "api" to disable editing in the GrowthBook UI. Before you do this, the Fact Table itself must also be marked as "api"',
      )
      .optional(),
  })
  .strict();

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

const factTableIdParams = z
  .object({
    factTableId: z.string().describe("Specify a specific fact table"),
  })
  .strict();

const factTableIdAndIdParams = z
  .object({
    factTableId: z.string().describe("Specify a specific fact table"),
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const listFactTablesValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      datasourceId: z.string().describe("Filter by Data Source").optional(),
      projectId: z.string().describe("Filter by project id").optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      factTables: z.array(apiFactTableValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all fact tables",
  operationId: "listFactTables",
  tags: ["fact-tables"],
  method: "get" as const,
  path: "/fact-tables",
};

export const postFactTableValidator = {
  bodySchema: postFactTableBody,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z
    .object({
      factTable: apiFactTableValidator,
    })
    .strict(),
  summary: "Create a single fact table",
  operationId: "postFactTable",
  tags: ["fact-tables"],
  method: "post" as const,
  path: "/fact-tables",
  exampleRequest: {
    body: {
      name: "Orders",
      datasource: "ds_abc123",
      userIdTypes: ["id"],
      sql: "SELECT * FROM orders",
    },
  },
};

export const getFactTableValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      factTable: apiFactTableValidator,
    })
    .strict(),
  summary: "Get a single fact table",
  operationId: "getFactTable",
  tags: ["fact-tables"],
  method: "get" as const,
  path: "/fact-tables/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const updateFactTableValidator = {
  bodySchema: updateFactTableBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      factTable: apiFactTableValidator,
    })
    .strict(),
  summary: "Update a single fact table",
  operationId: "updateFactTable",
  tags: ["fact-tables"],
  method: "post" as const,
  path: "/fact-tables/:id",
  exampleRequest: {
    params: { id: "abc123" },
    body: { name: "New Fact Table Name" },
  },
};

export const deleteFactTableValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      deletedId: z
        .string()
        .describe("The ID of the deleted fact table")
        .meta({ example: "ftb_123abc" }),
    })
    .strict(),
  summary: "Deletes a single fact table",
  operationId: "deleteFactTable",
  tags: ["fact-tables"],
  method: "delete" as const,
  path: "/fact-tables/:id",
  exampleRequest: { params: { id: "abc123" } },
};

export const listFactTableFiltersValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
    })
    .strict(),
  paramsSchema: factTableIdParams,
  responseSchema: z.intersection(
    z.object({
      factTableFilters: z.array(apiFactTableFilterValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all filters for a fact table",
  operationId: "listFactTableFilters",
  tags: ["fact-tables"],
  method: "get" as const,
  path: "/fact-tables/:factTableId/filters",
  exampleRequest: { params: { factTableId: "abc123" } },
};

export const postFactTableFilterValidator = {
  bodySchema: postFactTableFilterBody,
  querySchema: z.never(),
  paramsSchema: factTableIdParams,
  responseSchema: z
    .object({
      factTableFilter: apiFactTableFilterValidator,
    })
    .strict(),
  summary: "Create a single fact table filter",
  operationId: "postFactTableFilter",
  tags: ["fact-tables"],
  method: "post" as const,
  path: "/fact-tables/:factTableId/filters",
  exampleRequest: {
    params: { factTableId: "abc123" },
    body: { name: "High Value Order", value: "amount>100" },
  },
};

export const getFactTableFilterValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: factTableIdAndIdParams,
  responseSchema: z
    .object({
      factTableFilter: apiFactTableFilterValidator,
    })
    .strict(),
  summary: "Get a single fact filter",
  operationId: "getFactTableFilter",
  tags: ["fact-tables"],
  method: "get" as const,
  path: "/fact-tables/:factTableId/filters/:id",
  exampleRequest: { params: { factTableId: "abc123", id: "abc123" } },
};

export const updateFactTableFilterValidator = {
  bodySchema: updateFactTableFilterBody,
  querySchema: z.never(),
  paramsSchema: factTableIdAndIdParams,
  responseSchema: z
    .object({
      factTableFilter: apiFactTableFilterValidator,
    })
    .strict(),
  summary: "Update a single fact table filter",
  operationId: "updateFactTableFilter",
  tags: ["fact-tables"],
  method: "post" as const,
  path: "/fact-tables/:factTableId/filters/:id",
  exampleRequest: {
    params: { factTableId: "abc123", id: "abc123" },
    body: { value: "amount > 50" },
  },
};

export const deleteFactTableFilterValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: factTableIdAndIdParams,
  responseSchema: z
    .object({
      deletedId: z
        .string()
        .describe("The ID of the deleted fact filter")
        .meta({ example: "flt_123abc" }),
    })
    .strict(),
  summary: "Deletes a single fact table filter",
  operationId: "deleteFactTableFilter",
  tags: ["fact-tables"],
  method: "delete" as const,
  path: "/fact-tables/:factTableId/filters/:id",
  exampleRequest: { params: { factTableId: "abc123", id: "abc123" } },
};
