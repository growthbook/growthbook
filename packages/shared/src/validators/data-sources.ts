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
