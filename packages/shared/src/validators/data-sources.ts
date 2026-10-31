import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

import { namedSchema } from "./openapi-helpers";

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

const nonEmptyString = z.string().min(1);

export const putDataSourceSettingsBody = z
  .object({
    identifierTypes: z
      .array(
        z
          .object({
            id: nonEmptyString,
            description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
          })
          .strict(),
      )
      .optional()
      .describe(
        "The whole list, in order. Replaces the stored list. A stored identifier type, matched by `id`, only changes its `description`.",
      ),
    assignmentQueries: z
      .array(
        z
          .object({
            id: nonEmptyString,
            name: nonEmptyString,
            description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
            identifierTypes: z.array(nonEmptyString).min(1),
            sql: nonEmptyString,
            includesNameColumns: z.boolean().optional(),
            dimensionColumns: z.array(z.string()).optional(),
            projects: z.array(z.string()).optional(),
            columnMapping: exposureQueryColumnMappingValidator.optional(),
            identifierType: z
              .string()
              .optional()
              .describe("Read-only. Accepted and ignored."),
            error: z
              .string()
              .nullable()
              .optional()
              .describe("Read-only. Accepted and ignored."),
          })
          .strict(),
      )
      .optional()
      .describe(
        "Added or updated by `id`. Stored queries not listed are kept. A field left out keeps its stored value. If you can't edit the whole Data Source, an added query gets a new id, returned in the response.",
      ),
    identifierJoinQueries: z
      .array(
        z
          .object({
            identifierTypes: z.array(nonEmptyString).min(2),
            sql: nonEmptyString,
          })
          .strict(),
      )
      .optional()
      .describe("The whole list, in order. Replaces the stored list."),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        "Run every check and test, and return what would be saved, without saving.",
      ),
  })
  .strict();

export type PutDataSourceSettingsBody = z.infer<
  typeof putDataSourceSettingsBody
>;

export const putDataSourceSettingsValidator = {
  bodySchema: putDataSourceSettingsBody,
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z
    .object({
      dataSource: apiDataSourceValidator,
      changed: z
        .boolean()
        .describe(
          "Whether this call saved a change, or with `dryRun` would have.",
        ),
    })
    .strict(),
  summary: "Set a data source's identifier types, joins and assignment queries",
  description:
    "Each list is optional, and a list left out stays as it is. Every assignment query or identifier join query the request adds or changes is first run against the warehouse, reading no rows. If one fails, nothing is saved and the error names the query.",
  operationId: "putDataSourceSettings",
  tags: ["data-sources"],
  method: "put" as const,
  path: "/data-sources/:id/settings",
};
