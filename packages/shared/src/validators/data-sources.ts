import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

import { namedSchema } from "./openapi-helpers";

const pipelineSettingsValidator = z
  .object({
    allowWriting: z
      .boolean()
      .describe("Let GrowthBook write temporary tables to speed up analysis"),
    mode: z.enum(["ephemeral", "incremental"]),
    writeDatabase: z.string().optional(),
    writeDataset: z.string().describe("Schema (or dataset) to write tables to"),
    unitsTableRetentionHours: z.number().positive(),
    unitsTableDeletion: z.boolean().optional(),
    includedExperimentIds: z.array(z.string()).optional(),
    excludedExperimentIds: z.array(z.string()).optional(),
    incrementalOptInExperimentIds: z.array(z.string()).optional(),
  })
  .strict();

// Returned by GET and accepted on create/update.
const apiDataSourceExtraFields = {
  pipelineSettings: pipelineSettingsValidator.optional(),
  maxConcurrentQueries: z.number().optional(),
  queryCacheTTLMins: z.number().optional(),
};

// Corresponds to schemas/DataSource.yaml
export const apiDataSourceValidator = namedSchema(
  "DataSource",
  z
    .object({
      id: z.string(),
      dateCreated: z.string().meta({ format: "date-time" }),
      dateUpdated: z.string().meta({ format: "date-time" }),
      type: z.string(),
      name: z.string(),
      description: z.string().max(MAX_DESCRIPTION_LENGTH),
      projectIds: z.array(z.string()),
      eventTracker: z.string(),
      identifierTypes: z.array(
        z.object({
          id: z.string(),
          description: z.string().max(MAX_DESCRIPTION_LENGTH),
        }),
      ),
      assignmentQueries: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().max(MAX_DESCRIPTION_LENGTH),
          identifierType: z.string(),
          sql: z.string(),
          includesNameColumns: z.boolean(),
          dimensionColumns: z.array(z.string()),
        }),
      ),
      identifierJoinQueries: z.array(
        z.object({
          identifierTypes: z.array(z.string()),
          sql: z.string(),
        }),
      ),
      mixpanelSettings: z
        .object({
          viewedExperimentEventName: z.string(),
          experimentIdProperty: z.string(),
          variationIdProperty: z.string(),
          extraUserIdProperty: z.string(),
        })
        .optional(),
      ...apiDataSourceExtraFields,
    })
    .strict(),
);

export type ApiDataSource = z.infer<typeof apiDataSourceValidator>;

const idParams = z
  .object({
    id: z.string().describe("The id of the requested resource"),
  })
  .strict();

export const listDataSourcesValidator = {
  bodySchema: z.never(),
  querySchema: z
    .object({
      ...paginationQueryFields,
      projectId: z.string().describe("Filter by project id").optional(),
    })
    .strict(),
  paramsSchema: z.never(),
  responseSchema: z.intersection(
    z.object({
      dataSources: z.array(apiDataSourceValidator),
    }),
    apiPaginationFieldsValidator,
  ),
  summary: "Get all data sources",
  operationId: "listDataSources",
  tags: ["data-sources"],
  method: "get" as const,
  path: "/data-sources",
};

export const getDataSourceValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      dataSource: apiDataSourceValidator,
    })
    .strict(),
  summary: "Get a single data source",
  operationId: "getDataSource",
  tags: ["data-sources"],
  method: "get" as const,
  path: "/data-sources/:id",
};

// Same names as the GET response, so a read can be edited and sent back.
const dataSourceSettingsInput = {
  eventTracker: z.string().optional(),
  identifierTypes: z
    .array(
      z.object({
        id: z.string(),
        description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
      }),
    )
    .optional()
    .describe("Replaces the list"),
  assignmentQueries: z
    .array(
      z.object({
        id: z.string().optional().describe("Omit to create a new query"),
        name: z.string(),
        description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
        identifierType: z.string(),
        sql: z.string(),
        includesNameColumns: z.boolean().optional(),
        dimensionColumns: z.array(z.string()).optional(),
      }),
    )
    .optional()
    .describe(
      "Replaces the list. Each query is validated against the warehouse.",
    ),
  identifierJoinQueries: z
    .array(z.object({ identifierTypes: z.array(z.string()), sql: z.string() }))
    .optional()
    .describe("Replaces the list"),
  mixpanelSettings: z
    .object({
      viewedExperimentEventName: z.string().optional(),
      experimentIdProperty: z.string().optional(),
      variationIdProperty: z.string().optional(),
      extraUserIdProperty: z.string().optional(),
    })
    .optional(),
  ...apiDataSourceExtraFields,
};

const paramsField = z
  .record(z.string(), z.unknown())
  .describe(
    "Connection settings for the data source type, the same fields as its connection form. Write-only: never returned.",
  );

export const postDataSourceValidator = {
  bodySchema: z
    .object({
      name: z.string().min(1),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
      type: z.enum([
        "redshift",
        "athena",
        "snowflake",
        "postgres",
        "mysql",
        "mssql",
        "bigquery",
        "clickhouse",
        "presto",
        "databricks",
        "mixpanel",
        "vertica",
        "adobe_experience_platform_query_service",
      ]),
      params: paramsField,
      projectIds: z.array(z.string()).optional(),
      ...dataSourceSettingsInput,
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.object({ dataSource: apiDataSourceValidator }).strict(),
  summary: "Create a data source",
  description:
    "Tests the connection before saving. Google Analytics and the managed warehouse are set up in the app.",
  operationId: "postDataSource",
  tags: ["data-sources"],
  method: "post" as const,
  path: "/data-sources",
  exampleRequest: {
    body: {
      name: "Warehouse",
      type: "postgres" as const,
      params: {
        host: "db.example.com",
        port: 5432,
        database: "analytics",
        user: "growthbook",
        password: "********",
      },
    },
  },
};

export const updateDataSourceValidator = {
  bodySchema: z
    .object({
      name: z.string().min(1).optional(),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
      params: paramsField
        .optional()
        .describe(
          "Merged into the stored connection settings and re-tested. Needs permission to edit the connection.",
        ),
      projectIds: z.array(z.string()).optional(),
      ...dataSourceSettingsInput,
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      dataSource: apiDataSourceValidator,
      eventForwarderWarning: z
        .string()
        .optional()
        .describe(
          "Set if the update saved but syncing the Event Forwarder failed",
        ),
    })
    .strict(),
  summary: "Update a data source",
  operationId: "updateDataSource",
  tags: ["data-sources"],
  method: "post" as const,
  path: "/data-sources/:id",
};

export const deleteDataSourceValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z.object({ deletedId: z.string() }).strict(),
  summary: "Delete a data source",
  description:
    "Refused while it's the organization default or metrics, segments or dimensions still use it.",
  operationId: "deleteDataSource",
  tags: ["data-sources"],
  method: "delete" as const,
  path: "/data-sources/:id",
};

export const postDataSourceInformationSchemaRefreshValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z.object({ queued: z.literal(true) }).strict(),
  summary: "Refresh a data source's information schema",
  description:
    "Queues a background job that re-reads the warehouse's tables and columns, creating the schema if there isn't one yet.",
  operationId: "postDataSourceInformationSchemaRefresh",
  tags: ["data-sources"],
  method: "post" as const,
  path: "/data-sources/:id/information-schema/refresh",
};

export const postInformationSchemaTableRefreshValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ tableId: z.string() }).strict(),
  responseSchema: z.object({ queued: z.literal(true) }).strict(),
  summary: "Refresh one table's columns",
  operationId: "postInformationSchemaTableRefresh",
  tags: ["information-schema-tables"],
  method: "post" as const,
  path: "/information-schema-tables/:tableId/refresh",
};
