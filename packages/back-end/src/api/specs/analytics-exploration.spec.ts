import { z } from "zod";
import {
  apiAnalyticsExplorationValidator,
  productAnalyticsColumnValuesBodySchema,
  productAnalyticsColumnsQuerySchema,
  productAnalyticsDiscoveryResultSchema,
  productAnalyticsSearchQuerySchema,
  apiMetricExplorationValidator,
  apiFactTableExplorationValidator,
  apiDataSourceExplorationValidator,
  apiFunnelExplorationValidator,
  metricExplorationConfigValidator,
  factTableExplorationConfigValidator,
  dataSourceExplorationConfigValidator,
  funnelExplorationConfigValidator,
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

export const postFunnelExplorationEndpoint = makeExplorationEndpoint(
  apiFunnelExplorationValidator,
  funnelExplorationConfigValidator,
  {
    pathFragment: "/funnel-exploration",
    operationId: "postFunnelExploration",
    summary: "Run a Funnel based visualization",
  },
);

// The three lookups before an exploration. Column values is a POST only because
// the column list and search term don't belong in a URL; nothing is written.

export const getProductAnalyticsSearchEndpoint = {
  pathFragment: "/search",
  verb: "get" as const,
  operationId: "searchProductAnalytics",
  validator: {
    bodySchema: z.never(),
    querySchema: productAnalyticsSearchQuerySchema,
    paramsSchema: z.never(),
  },
  zodReturnObject: productAnalyticsDiscoveryResultSchema,
  summary: "Search Metrics and Fact Tables for product analytics",
};

export const getProductAnalyticsColumnsEndpoint = {
  pathFragment: "/columns",
  verb: "get" as const,
  operationId: "getProductAnalyticsColumns",
  validator: {
    bodySchema: z.never(),
    querySchema: productAnalyticsColumnsQuerySchema,
    paramsSchema: z.never(),
  },
  zodReturnObject: productAnalyticsDiscoveryResultSchema,
  summary: "Get the columns available to a product analytics exploration",
};

export const postProductAnalyticsColumnValuesEndpoint = {
  pathFragment: "/column-values",
  verb: "post" as const,
  operationId: "postProductAnalyticsColumnValues",
  validator: {
    bodySchema: productAnalyticsColumnValuesBodySchema,
    querySchema: z.never(),
    paramsSchema: z.never(),
  },
  zodReturnObject: productAnalyticsDiscoveryResultSchema,
  summary: "Get the stored values of one or more string columns",
};

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
    getProductAnalyticsSearchEndpoint,
    getProductAnalyticsColumnsEndpoint,
    postProductAnalyticsColumnValuesEndpoint,
    postMetricExplorationEndpoint,
    postFactTableExplorationEndpoint,
    postDataSourceExplorationEndpoint,
    postFunnelExplorationEndpoint,
  ],
} satisfies OpenApiModelSpec;

export default analyticsExplorationApiSpec;
