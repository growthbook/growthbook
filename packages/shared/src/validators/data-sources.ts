import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";
import { apiInformationSchemaTableValidator } from "./information-schema-tables";

import { namedSchema } from "./openapi-helpers";
import { PROJECTS_DESCRIPTION } from "./api-field-descriptions";

export const schemaFormatValidator = z.enum([
  "segment",
  "snowplow",
  "jitsu",
  "freshpaint",
  "ga4",
  "fullstory",
  "matomo",
  "heap",
  "rudderstack",
  "amplitude",
  "mparticle",
  "mixpanel",
  "firebase",
  "keen",
  "clevertap",
  "langfuse",
  "phoenix",
  "eventForwarder",
  "custom",
]);

// Only remapped roles are stored; the rest use their canonical names
export const exposureQueryColumnMappingValidator = z.object({
  experimentIdColumn: z.string().optional(),
  variationIdColumn: z.string().optional(),
  timestampColumn: z.string().optional(),
  userIdColumns: z
    .record(z.string(), z.string())
    .optional()
    .describe("Column for each identifier type, keyed by type"),
  // Only read when hasNameCol is set
  experimentNameColumn: z.string().optional(),
  variationNameColumn: z.string().optional(),
});

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
  maxConcurrentQueries: z.number().int().nonnegative().optional(),
  queryCacheTTLMins: z.number().int().nonnegative().optional(),
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
          identifierTypes: z.array(z.string()),
          identifierType: z.string().meta({ deprecated: true }),
          sql: z.string(),
          includesNameColumns: z.boolean(),
          dimensionColumns: z.array(z.string()),
          projects: z.array(z.string()),
          columnMapping: exposureQueryColumnMappingValidator
            .optional()
            .describe(
              "The column `sql` returns for each role, where it isn't the canonical name (`experiment_id`, `variation_id`, `timestamp`, `experiment_name`, `variation_name`, or the identifier type's own name). Roles not listed use the canonical name.",
            ),
          error: z
            .string()
            .optional()
            .describe("Why the last validation of this query failed"),
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
  eventTracker: schemaFormatValidator
    .optional()
    .describe("`eventForwarder` is only accepted unchanged"),
  identifierTypes: z
    .array(
      z.object({
        id: z.string(),
        description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
      }),
    )
    .optional()
    .describe(
      'Replaces the list. An entry matching an existing id keeps its description if left out; send `""` to clear it.',
    ),
  assignmentQueries: z
    .array(
      z.object({
        id: z.string().optional().describe("Omit to create a new query"),
        name: z.string(),
        description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
        identifierTypes: z
          .array(z.string())
          .min(1)
          .optional()
          .describe("Required for a new query unless identifierType is set"),
        identifierType: z
          .string()
          .optional()
          .describe(
            "Deprecated: use identifierTypes, which wins if both are set",
          )
          .meta({ deprecated: true }),
        sql: z.string(),
        includesNameColumns: z.boolean().optional(),
        dimensionColumns: z.array(z.string()).optional(),
        projects: z.array(z.string()).optional().describe(PROJECTS_DESCRIPTION),
        columnMapping: exposureQueryColumnMappingValidator
          .strict()
          .optional()
          .describe(
            "Columns `sql` returns under a non-canonical name, by role. Replaces the stored mapping; send `{}` to clear it.",
          ),
      }),
    )
    .optional()
    .describe(
      'Replaces the list. An entry with an existing `id` keeps `description`, `identifierTypes`, `includesNameColumns`, `dimensionColumns`, `projects` and `columnMapping` if left out; clear the others with `""`, `false` or `[]`. Each query is validated against the warehouse.',
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
  pipelineSettings: pipelineSettingsValidator
    .partial()
    .extend({
      includedExperimentIds: z.array(z.string()).nullable().optional(),
    })
    .optional()
    .describe(
      "Merged into the stored settings: fields left out keep their values, but any change must leave `allowWriting`, `mode`, `writeDataset` and `unitsTableRetentionHours` set, with a non-empty `writeDataset` when `allowWriting` is true. Send `[]` to clear `excludedExperimentIds` or `incrementalOptInExperimentIds`, and `includedExperimentIds: null` to apply the mode to every experiment again (`[]` applies it to none).",
    ),
};

export const updateDataSourceValidator = {
  bodySchema: z
    .object({
      name: z.string().min(1).optional(),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
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
  description:
    'Fields left out keep their current values. To clear one, send an explicit empty value (`[]`, `""` or `false`). Connection settings are changed in the app.',
  confirmation: ["settings.dataSources"] as const,
  operationId: "updateDataSource",
  tags: ["data-sources"],
  method: "post" as const,
  path: "/data-sources/:id",
};

const tlsFields = {
  ssl: z.boolean().optional(),
  caCert: z.string().optional(),
  clientCert: z.string().optional(),
  clientKey: z.string().optional(),
};

const postgresFields = {
  host: z.string(),
  port: z.number().int(),
  database: z.string(),
  user: z.string(),
  password: z.string(),
  defaultSchema: z.string().optional(),
  ...tlsFields,
};

const connection = <T extends string, S extends z.ZodRawShape>(
  type: T,
  name: string,
  shape: S,
) =>
  namedSchema(
    `${name}Connection`,
    z.strictObject({ type: z.literal(type), ...shape }),
  );

// Every warehouse the app can connect to except the Managed Warehouse and Google Analytics.
export const apiDataSourceConnectionValidator = z.discriminatedUnion("type", [
  connection("postgres", "Postgres", postgresFields),
  connection("redshift", "Redshift", postgresFields),
  connection("vertica", "Vertica", postgresFields),
  connection("mysql", "Mysql", {
    host: z.string(),
    port: z.number().int(),
    database: z.string(),
    user: z.string(),
    password: z.string(),
    ...tlsFields,
  }),
  connection("mssql", "Mssql", {
    server: z.string(),
    port: z.number().int(),
    database: z.string(),
    user: z.string(),
    password: z.string(),
    defaultSchema: z.string().optional(),
    requestTimeout: z.number().int().optional(),
    options: z
      .strictObject({
        encrypt: z.boolean().optional(),
        trustServerCertificate: z.boolean().optional(),
      })
      .optional(),
  }),
  connection("snowflake", "Snowflake", {
    account: z.string(),
    accessUrl: z.string().optional(),
    username: z.string(),
    password: z.string().optional().describe("For `password` auth"),
    database: z.string(),
    schema: z.string(),
    role: z.string().optional(),
    warehouse: z.string().optional(),
    authMethod: z
      .enum(["password", "key-pair", "workload-identity"])
      .optional(),
    privateKey: z.string().optional(),
    privateKeyPassword: z.string().optional(),
    workloadIdentityProvider: z.enum(["AWS", "AZURE", "GCP"]).optional(),
  }),
  connection("bigquery", "BigQuery", {
    authType: z
      .enum(["auto", "json"])
      .optional()
      .describe("`auto` uses the server's own credentials: self-hosted only"),
    projectId: z.string().optional(),
    clientEmail: z.string().optional(),
    privateKey: z.string().optional(),
    apiEndpoint: z.string().optional(),
    reservation: z.string().optional(),
    defaultProject: z.string(),
    defaultDataset: z.string(),
  }),
  connection("athena", "Athena", {
    authType: z
      .enum(["auto", "accessKey", "assumeRole"])
      .optional()
      .describe("`auto` uses the server's own credentials: self-hosted only"),
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
    assumeRoleARN: z.string().optional(),
    roleSessionName: z.string().optional(),
    durationSeconds: z.number().int().optional(),
    externalId: z.string().optional(),
    region: z.string(),
    database: z.string().optional(),
    bucketUri: z.string(),
    workGroup: z.string().optional(),
    catalog: z.string().optional(),
    resultReuseMaxAgeInMinutes: z.string().optional(),
  }),
  connection("presto", "Presto", {
    engine: z.enum(["presto", "trino"]),
    authType: z
      .enum(["basicAuth", "none", "customAuth", "kerberos"])
      .optional(),
    host: z.string(),
    port: z.number().int(),
    user: z.string().optional().describe("Presto only"),
    trinoUser: z.string().optional().describe("Trino only"),
    username: z.string().optional().describe("For basicAuth"),
    password: z.string().optional().describe("For basicAuth"),
    customAuth: z.string().optional(),
    kerberosServicePrincipal: z.string().optional(),
    kerberosClientPrincipal: z.string().optional(),
    kerberosUser: z.string().optional(),
    source: z.string().optional(),
    catalog: z.string(),
    schema: z.string(),
    requestTimeout: z.number().int().optional(),
    ...tlsFields,
  }),
  connection("databricks", "Databricks", {
    authType: z.enum(["pat", "oauth-m2m"]),
    token: z.string().optional().describe("For pat"),
    oauthClientId: z.string().optional().describe("For oauth-m2m"),
    oauthClientSecret: z.string().optional().describe("For oauth-m2m"),
    host: z.string(),
    port: z.number().int(),
    path: z.string(),
    catalog: z.string(),
  }),
  connection("clickhouse", "ClickHouse", {
    url: z.string(),
    port: z.number().int(),
    username: z.string().optional(),
    password: z.string(),
    database: z.string(),
    maxExecutionTime: z.number().int().optional(),
    ...tlsFields,
    caCertPath: z.string().optional(),
    clientCertPath: z.string().optional(),
    clientKeyPath: z.string().optional(),
    clientCertChainPath: z
      .string()
      .optional()
      .describe(
        "The `*Path` fields read PEM files on the GrowthBook server: self-hosted with a single organization only",
      ),
  }),
  connection("mixpanel", "Mixpanel", {
    username: z.string(),
    secret: z.string(),
    projectId: z.string(),
    server: z.enum(["standard", "eu"]).optional(),
  }),
  connection(
    "adobe_experience_platform_query_service",
    "AdobeExperiencePlatformQueryService",
    {
      host: z.string(),
      port: z.number().int(),
      database: z.string(),
      username: z.string(),
      technicalAccountId: z.string(),
      credential: z.string(),
    },
  ),
]);

export const postDataSourceValidator = {
  bodySchema: z
    .object({
      name: z.string().min(1),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
      projectIds: z.array(z.string()).optional(),
      connection: apiDataSourceConnectionValidator.describe(
        "Credentials are stored encrypted and never returned",
      ),
      ...dataSourceSettingsInput,
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.object({ dataSource: apiDataSourceValidator }).strict(),
  summary: "Create a data source",
  description:
    "Tests the connection and validates each assignment query against the warehouse before saving. The Managed Warehouse, Google Analytics and Event Forwarders are set up in the app.",
  confirmation: ["settings.dataSources"] as const,
  // Kept encrypted, and hidden on the confirm page, while the request is held.
  secretBodyFields: ["connection"] as const,
  operationId: "postDataSource",
  tags: ["data-sources"],
  method: "post" as const,
  path: "/data-sources",
};

export const deleteDataSourceValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z.object({ deletedId: z.string() }).strict(),
  summary: "Delete a data source",
  description:
    "Refused while it's the organization default, metrics, fact metrics, fact tables, segments or dimensions still use it, or it has an Event Forwarder.",
  confirmation: ["settings.dataSources"] as const,
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
    "Queues a background job that re-reads the warehouse's tables, creating the schema if there isn't one yet. A table already read before is only re-read when its column count changed; refresh it on its own to pick up renamed or retyped columns.",
  confirmation: ["other.write"] as const,
  operationId: "postDataSourceInformationSchemaRefresh",
  tags: ["data-sources"],
  method: "post" as const,
  path: "/data-sources/:id/information-schema/refresh",
};

export const postInformationSchemaTableRefreshValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ tableId: z.string() }).strict(),
  responseSchema: z
    .object({ informationSchemaTable: apiInformationSchemaTableValidator })
    .strict(),
  summary: "Refresh one table's columns",
  description:
    "Re-reads the table's columns from the warehouse and returns the updated table. A failed read returns an error and leaves the stored columns as they were.",
  confirmation: ["other.write"] as const,
  operationId: "postInformationSchemaTableRefresh",
  tags: ["information-schema-tables"],
  method: "post" as const,
  path: "/information-schema-tables/:tableId/refresh",
};
