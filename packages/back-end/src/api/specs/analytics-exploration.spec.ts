import { z } from "zod";
import {
  apiExplorationValidator,
  apiMetricExplorationValidator,
  apiFactTableExplorationValidator,
  apiDataSourceExplorationValidator,
  metricExplorationConfigValidator,
  factTableExplorationConfigValidator,
  dataSourceExplorationConfigValidator,
  explorationCacheQuerySchema,
  apiBaseSchema,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

// Lightweight query shape for the API response (avoids circular dep with generated openapi.ts)
const apiQueryShape = z.object({
  id: z.string(),
  organization: z.string(),
  datasource: z.string(),
  language: z.string(),
  query: z.string(),
  queryType: z.string(),
  createdAt: z.string(),
  startedAt: z.string(),
  status: z.enum([
    "running",
    "queued",
    "failed",
    "partially-succeeded",
    "succeeded",
  ]),
  externalId: z.string(),
  dependencies: z.array(z.string()),
  runAtEnd: z.boolean(),
});

function makeExplorationEndpoint(
  explorationValidator: z.ZodTypeAny,
  bodyValidator: z.ZodTypeAny,
  opts: { pathFragment: string; operationId: string; summary: string },
) {
  return {
    pathFragment: opts.pathFragment,
    verb: "post" as const,
    operationId: opts.operationId,
    validator: {
      bodySchema: bodyValidator,
      querySchema: explorationCacheQuerySchema,
      paramsSchema: z.never(),
    },
    zodReturnObject: z.object({
      exploration: explorationValidator.nullable(),
      query: apiQueryShape.nullable(),
      message: z.string().optional(),
    }),
    summary: opts.summary,
  };
}

export const postMetricExplorationEndpoint = makeExplorationEndpoint(
  apiMetricExplorationValidator,
  metricExplorationConfigValidator,
  {
    pathFragment: "/metric-exploration",
    operationId: "postMetricExploration",
    summary: "Create a Metric based visualization",
  },
);

export const postFactTableExplorationEndpoint = makeExplorationEndpoint(
  apiFactTableExplorationValidator,
  factTableExplorationConfigValidator,
  {
    pathFragment: "/fact-table-exploration",
    operationId: "postFactTableExploration",
    summary: "Run a Fact Table based visualization",
  },
);

export const postDataSourceExplorationEndpoint = makeExplorationEndpoint(
  apiDataSourceExplorationValidator,
  dataSourceExplorationConfigValidator,
  {
    pathFragment: "/data-source-exploration",
    operationId: "postDataSourceExploration",
    summary: "Create a Data Source based visualization",
  },
);

export const analyticsExplorationApiSpec = {
  modelSingular: "analyticsExploration",
  modelPlural: "analyticsExplorations",
  pathBase: "/product-analytics",
  apiInterface: apiExplorationValidator.extend({
    dateCreated: apiBaseSchema.shape.dateCreated,
    dateUpdated: apiBaseSchema.shape.dateUpdated,
  }),
  schemas: {
    createBody: z.object({ id: z.string().optional() }),
    updateBody: z.object({}),
  },
  includeDefaultCrud: false,
  crudActions: [] as const,
  customEndpoints: [
    postMetricExplorationEndpoint,
    postFactTableExplorationEndpoint,
    postDataSourceExplorationEndpoint,
  ],
} satisfies OpenApiModelSpec;

export default analyticsExplorationApiSpec;
