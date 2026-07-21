import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { ownerEmailField, ownerField, ownerInputField } from "./owner-field";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

import { componentSchema, namedSchema } from "./openapi-helpers";
import {
  apiAggregatedTableRefreshTriggerValidator,
  apiAggregatedTableRunSummaryValidator,
  apiAggregatedTableRunValidator,
} from "./aggregated-fact-table-run";

// If you change these types, also update the factTableColumnTypeValidator to match
export const factTableColumnTypes = [
  "number",
  "string",
  "date",
  "boolean",
  "json",
  "binary",
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
  "binary",
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

// Stored shape: every JSON field carries a datatype (auto-detection fills ""
// until the type is known). This is the canonical persisted `JSONColumnFields`.
export const jsonColumnFieldsValidator = z.record(
  z.string(),
  z.object({
    datatype: factTableColumnTypeValidator,
  }),
);

// Input shape: a caller may omit a JSON field's datatype. buildColumnInterface
// normalizes an omitted value to "" so the stored shape's invariant holds.
export const jsonColumnFieldsInputValidator = z.record(
  z.string(),
  z.object({
    datatype: factTableColumnTypeValidator.optional(),
  }),
);

export const createColumnPropsValidator = z
  .object({
    column: z.string(),
    name: z.string().optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    numberFormat: numberFormatValidator.optional(),
    // Optional so an omitted datatype flows through as "auto-detect later"
    datatype: factTableColumnTypeValidator.optional(),
    jsonFields: jsonColumnFieldsInputValidator.optional(),
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
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    numberFormat: numberFormatValidator.optional(),
    datatype: factTableColumnTypeValidator.optional(),
    jsonFields: jsonColumnFieldsInputValidator.optional(),
    alwaysInlineFilter: z.boolean().optional(),
    topValues: z.array(z.string()).optional(),
    deleted: z.boolean().optional(),
    isAutoSliceColumn: z.boolean().optional(),
    autoSlices: z.array(z.string()).optional(),
    lockedAutoSlices: z.array(z.string()).optional(),
  })
  .strict();

export const aggregatedFactTableSettingsValidator = z
  .object({
    idTypes: z.array(z.string()),
    updateTime: z
      .object({
        time: z.string(),
        timezone: z.string(),
      })
      .strict(),
    lookbackWindow: z.number().int().positive(),
    // How many days each sequential INSERT covers when fullRestate rebuilds
    // the table. Smaller chunks keep each query's output inside the engine's
    // per-stage write budget on wide fact tables. Unset = no chunking (a single
    // full-window INSERT).
    restateChunkDays: z.number().int().min(1).max(7).optional(),
  })
  .strict();

export const createFactTablePropsValidator = z
  .object({
    name: z.string(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH),
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
    aggregatedFactTableSettings:
      aggregatedFactTableSettingsValidator.optional(),
    columnRefreshPending: z.boolean().optional(),
  })
  .strict();

export const updateFactTablePropsValidator = z
  .object({
    name: z.string().optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
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
    aggregatedFactTableSettings: aggregatedFactTableSettingsValidator
      .nullable()
      .optional(),
    columnRefreshPending: z.boolean().optional(),
  })
  .strict();

export const columnAggregationValidator = z.enum([
  "sum",
  "max",
  "count distinct",
  // The column is a pre-built HLL sketch (e.g. BigQuery BYTES from
  // HLL_COUNT.INIT). Per-user aggregation merges sketches and extracts the
  // cardinality; downstream stats treat it as a numeric value per user.
  "hll merge",
  // The column is a pre-built KLL sketch (e.g. BigQuery BYTES from
  // KLL_QUANTILES.INIT_*). Only valid for event-quantile metrics. Per-user
  // aggregation merges sketches; variation stats reuse the two-pass KLL path.
  "kll merge",
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
    ignoreZeros: z.boolean().nullable().optional(),
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
  // Override the source-column name used to recover per-row event counts for
  // 'kll merge' event-quantile metrics. When unset, the SQL pipeline falls
  // back to the convention `<sketch>_n_events` on the same fact table. Only
  // valid when numerator.aggregation === "kll merge"; the validator rejects
  // any other usage.
  quantileEventCountColumn: z.string().optional(),
});

export const priorSettingsValidator = z.object({
  override: z.boolean(),
  proper: z.boolean(),
  mean: z.number(),
  stddev: z.number().gt(0),
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
    description: z.string().max(MAX_DESCRIPTION_LENGTH),
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
    description: z.string().max(MAX_DESCRIPTION_LENGTH),
    value: z.string(),
    managedBy: z.enum(["", "api"]).optional(),
  })
  .strict();

export const updateFactFilterPropsValidator = z
  .object({
    name: z.string().optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
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
        "binary",
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
                "binary",
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
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
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

export const apiFactTableColumnInputValidator = componentSchema(
  "FactTableColumnInput",
  apiFactTableColumnValidator
    .extend({
      datatype: apiFactTableColumnValidator.shape.datatype
        .describe(
          'The column\'s data type. Omit (or send "") to have it auto-detected from the SQL.',
        )
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
      description: z.string().max(MAX_DESCRIPTION_LENGTH),
      owner: ownerField,
      ownerEmail: ownerEmailField,
      projects: z.array(z.string()),
      tags: z.array(z.string()),
      datasource: z.string(),
      userIdTypes: z.array(z.string()),
      aggregatedFactTableSettings: aggregatedFactTableSettingsValidator
        .describe(
          "Settings for maintaining shared daily aggregated tables (a subset of userIdTypes plus the daily update time and restate lookback window) used to speed up CUPED. Requires the data pipeline (pipeline-mode) feature.",
        )
        .optional(),
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
      description: z.string().max(MAX_DESCRIPTION_LENGTH),
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

// Materialization status of one shared daily aggregated table (one per id type).
export const apiAggregatedFactTableValidator = namedSchema(
  "AggregatedFactTable",
  z
    .object({
      idType: z
        .string()
        .describe("The id type this aggregated table is keyed by"),
      status: z
        .enum(["running", "error", "pending", "active"])
        .describe(
          "Materialization status: `pending` (not yet built), `running` (a refresh is in progress), `active` (materialized and queryable), or `error` (the last run failed).",
        ),
      tableFullName: z
        .string()
        .nullable()
        .describe(
          "Fully-qualified warehouse table name, or null if it has not been created yet",
        ),
      firstEventDate: z
        .string()
        .meta({ format: "date-time" })
        .nullable()
        .describe("Earliest event date covered by the materialized data"),
      lastEventDate: z
        .string()
        .meta({ format: "date-time" })
        .nullable()
        .describe("Latest event date covered by the materialized data"),
      lastMaxTimestamp: z
        .string()
        .meta({ format: "date-time" })
        .nullable()
        .describe(
          "Event-time high-water mark; the next incremental refresh appends events after this timestamp",
        ),
      lastError: z
        .string()
        .nullable()
        .describe("Error message from the last failed run, if any"),
      dateUpdated: z
        .string()
        .meta({ format: "date-time" })
        .nullable()
        .describe("When the aggregation metadata was last updated"),
      pendingRestate: z
        .boolean()
        .describe(
          "Whether the next run will be forced to drop and rebuild the table instead of appending incrementally",
        ),
      pendingRestateReason: z
        .enum(["incomplete-write", "schema-drift"])
        .nullable()
        .describe("Why a restate is pending, if `pendingRestate` is true"),
    })
    .strict(),
);

export type ApiAggregatedFactTable = z.infer<
  typeof apiAggregatedFactTableValidator
>;

// Corresponds to payload-schemas/PostFactTablePayload.yaml
const postFactTableBody = z
  .object({
    name: z.string(),
    description: z
      .string()
      .max(MAX_DESCRIPTION_LENGTH)
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
    aggregatedFactTableSettings: aggregatedFactTableSettingsValidator
      .describe(
        "Settings for maintaining shared daily aggregated tables (a subset of userIdTypes plus the daily update time and restate lookback window) used to speed up CUPED. Requires the data pipeline (pipeline-mode) feature.",
      )
      .optional(),
    sql: z.string().describe("The SQL query for this fact table"),
    eventName: z
      .string()
      .describe("The event name used in SQL template variables")
      .optional(),
    columns: z
      .array(apiFactTableColumnInputValidator)
      .describe(
        'Optional array of column definitions to store for this fact table. Supplied columns are stored as-is. Omit `datatype` (or send "") on a column to have it auto-detected from the SQL.',
      )
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
      .max(MAX_DESCRIPTION_LENGTH)
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
    aggregatedFactTableSettings: aggregatedFactTableSettingsValidator
      .describe(
        "Settings for maintaining shared daily aggregated tables (a subset of userIdTypes plus the daily update time and restate lookback window) used to speed up CUPED. Requires the data pipeline (pipeline-mode) feature.",
      )
      .optional(),
    sql: z.string().describe("The SQL query for this fact table").optional(),
    eventName: z
      .string()
      .describe("The event name used in SQL template variables")
      .optional(),
    columns: z
      .array(apiFactTableColumnInputValidator)
      .describe(
        'Optional array of columns to upsert by `column`: existing columns are patched, new columns are created, and columns not included are left unchanged. Omit `datatype` to leave an existing column\'s type untouched; send "" to reset it for auto-detection; new columns are auto-detected when `datatype` is omitted or "". Slice-related properties require an enterprise license.',
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
      .max(MAX_DESCRIPTION_LENGTH)
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
      .max(MAX_DESCRIPTION_LENGTH)
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

export const getAggregatedFactTablesValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      aggregatedFactTables: z.array(apiAggregatedFactTableValidator),
      nextScheduledUpdate: z
        .string()
        .meta({ format: "date-time" })
        .nullable()
        .describe(
          "When the next scheduled nightly refresh will run, or null if no schedule is configured",
        ),
    })
    .strict(),
  summary:
    "Get the materialization status of a fact table's shared daily aggregated tables",
  operationId: "getAggregatedFactTables",
  tags: ["fact-tables"],
  method: "get" as const,
  path: "/fact-tables/:id/aggregated-tables",
  exampleRequest: { params: { id: "abc123" } },
};

export const refreshAggregatedFactTableBody = z
  .object({
    idType: z
      .string()
      .optional()
      .describe(
        "Limit the refresh to a single id type. If omitted, all of the fact table's aggregatedFactTableSettings.idTypes are refreshed.",
      ),
    fullRestate: z
      .boolean()
      .optional()
      .describe(
        "Drop and recreate the table, re-scanning the retained window. This is significantly more expensive than the default incremental append (it scans ~2-3 months of history).",
      ),
  })
  .strict();

export const refreshAggregatedFactTableValidator = {
  bodySchema: refreshAggregatedFactTableBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      runs: z
        .array(apiAggregatedTableRefreshTriggerValidator)
        .describe("One entry per id type refreshed"),
    })
    .strict(),
  summary:
    "Force a refresh or full restate of a fact table's shared daily aggregated tables",
  operationId: "refreshAggregatedFactTable",
  tags: ["fact-tables"],
  method: "post" as const,
  path: "/fact-tables/:id/aggregated-tables/refresh",
  exampleRequest: {
    params: { id: "abc123" },
    body: { fullRestate: false },
  },
};

const aggregatedTableRunParams = z
  .object({
    id: z.string().describe("The id of the fact table"),
    runId: z
      .string()
      .describe("The id of the aggregated table run (e.g. aftr_...)"),
  })
  .strict();

export const getAggregatedTableRunValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: aggregatedTableRunParams,
  responseSchema: z
    .object({
      run: apiAggregatedTableRunValidator,
    })
    .strict(),
  summary: "Get a single aggregated table run",
  operationId: "getAggregatedTableRun",
  tags: ["fact-tables"],
  method: "get" as const,
  path: "/fact-tables/:id/aggregated-tables/runs/:runId",
  exampleRequest: { params: { id: "abc123", runId: "aftr_abc123" } },
};

export const listAggregatedTableRunsValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      idType: z
        .string()
        .describe(
          "Only return runs for this id type. When omitted, runs for all id types are returned.",
        )
        .optional(),
      ...paginationQueryFields,
    })
    .strict(),
  paramsSchema: idParams,
  responseSchema: z.intersection(
    z.object({
      runs: z
        .array(apiAggregatedTableRunSummaryValidator)
        .describe("A list of the aggregated table runs for the fact table"),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "List aggregated table runs",
  operationId: "listAggregatedTableRuns",
  tags: ["fact-tables"],
  method: "get" as const,
  path: "/fact-tables/:id/aggregated-tables/runs",
  exampleRequest: {
    params: { id: "ftb_123" },
    query: { idType: "user_id" },
  },
};
