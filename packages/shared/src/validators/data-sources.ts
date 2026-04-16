import { z } from "zod";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

import { namedSchema } from "./openapi-helpers";

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
      description: z.string(),
      projectIds: z.array(z.string()),
      eventTracker: z.string(),
      identifierTypes: z.array(
        z.object({
          id: z.string(),
          description: z.string(),
        }),
      ),
      assignmentQueries: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
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
