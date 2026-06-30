import { z } from "zod";
import {
  apiAnalyticsExplorationValidator,
  apiMetricExplorationValidator,
  apiFactTableExplorationValidator,
  apiDataSourceExplorationValidator,
  metricExplorationConfigValidator,
  factTableExplorationConfigValidator,
  dataSourceExplorationConfigValidator,
  explorationCacheQuerySchema,
  apiBaseSchema,
  apiQueryValidator,
  type ApiAnalyticsExploration,
  type ExplorationConfig,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

export function makeExplorationEndpoint<
  Exp extends z.ZodType<ApiAnalyticsExploration>,
  Body extends z.ZodType<ExplorationConfig>,
>(
  explorationValidator: Exp,
  bodyValidator: Body,
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
      query: apiQueryValidator.nullable(),
      explorationUrl: z
        .string()
        .optional()
        .describe(
          "A direct link to view this exploration in the GrowthBook Application.",
        ),
      message: z
        .string()
        .describe(
          "Present when `exploration` is null, explaining why no result was returned.",
        )
        .optional(),
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
  apiInterface: apiAnalyticsExplorationValidator.extend({
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
