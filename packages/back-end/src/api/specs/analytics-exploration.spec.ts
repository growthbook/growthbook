import { z } from "zod";
import {
  apiAnalyticsExplorationValidator,
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

const boundedId = z.string().min(1).max(255);
const boundedIds = z.array(boundedId).min(1).max(20);
const csvIds = z
  .string()
  .max(5_119)
  .transform((value) =>
    value
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  )
  .pipe(boundedIds)
  .meta({
    type: "array",
    items: { type: "string", minLength: 1, maxLength: 255 },
    explode: false,
  });
const columnSourceEnum = z.enum(["fact_table", "metric"]);

export const searchProductAnalyticsResourcesQuerySchema = z
  .object({
    query: z.string().max(200).optional().default(""),
    limit: z.coerce.number().int().min(1).max(20).optional().default(10),
    skip: z.coerce.number().int().min(0).max(10_000).optional().default(0),
    datasourceId: boundedId.optional(),
  })
  .strict();

const metricSearchResultValidator = z.object({
  kind: z.literal("metric"),
  explorerType: z.literal("metric"),
  id: z.string(),
  name: z.string(),
  type: z.string(),
  official: z.boolean(),
  description: z.string().nullable(),
  owner: z.string().nullable(),
  ownerEmail: z.string().optional(),
  tags: z.array(z.string()),
});

const factTableSearchResultValidator = z.object({
  kind: z.literal("fact_table"),
  explorerType: z.literal("fact_table"),
  id: z.string(),
  name: z.string(),
  official: z.boolean(),
  eventName: z.string().nullable(),
  columnCount: z.number().int(),
});

export const searchProductAnalyticsResourcesEndpoint = {
  pathFragment: "/search",
  verb: "get" as const,
  operationId: "searchProductAnalyticsResources",
  validator: {
    bodySchema: z.never(),
    querySchema: searchProductAnalyticsResourcesQuerySchema,
    paramsSchema: z.never(),
  },
  zodReturnObject: z.object({
    matches: z.array(
      z.discriminatedUnion("kind", [
        metricSearchResultValidator,
        factTableSearchResultValidator,
      ]),
    ),
    totalMetrics: z.number().int(),
    totalFactTables: z.number().int(),
    totalMatches: z.number().int(),
    skip: z.number().int(),
    limit: z.number().int(),
  }),
  summary: "Search Product Analytics resources",
};

function validColumnSource(value: {
  source: "fact_table" | "metric";
  factTableId?: string;
  metricIds?: string[];
}) {
  return value.source === "fact_table"
    ? Boolean(value.factTableId) && value.metricIds === undefined
    : Boolean(value.metricIds?.length) && value.factTableId === undefined;
}

export const getProductAnalyticsColumnsQuerySchema = z
  .object({
    source: columnSourceEnum,
    factTableId: boundedId.optional(),
    metricIds: csvIds.optional(),
  })
  .strict()
  .refine(validColumnSource, {
    message:
      "Provide only factTableId for a fact_table source or metricIds for a metric source.",
  });

const productAnalyticsColumnsResponseSchema = z.object({
  columns: z.array(
    z.object({
      column: z.string(),
      name: z.string(),
      datatype: z.string(),
    }),
  ),
  userIdTypes: z.array(z.string()),
  metrics: z
    .array(
      z.object({
        metricId: z.string(),
        metricType: z.string(),
        needsUnit: z.boolean(),
      }),
    )
    .optional(),
  unitNote: z.string(),
});

export const getProductAnalyticsColumnsEndpoint = {
  pathFragment: "/columns",
  verb: "get" as const,
  operationId: "getProductAnalyticsColumns",
  validator: {
    bodySchema: z.never(),
    querySchema: getProductAnalyticsColumnsQuerySchema,
    paramsSchema: z.never(),
  },
  zodReturnObject: productAnalyticsColumnsResponseSchema,
  summary: "List columns available to a Product Analytics exploration",
};

export const getProductAnalyticsColumnValuesBodySchema = z
  .object({
    source: columnSourceEnum,
    factTableId: boundedId.optional(),
    metricIds: boundedIds.optional(),
    columns: z.array(boundedId).min(1).max(5),
    searchTerm: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(50).optional().default(20),
  })
  .strict()
  .refine(validColumnSource, {
    message:
      "Provide only factTableId for a fact_table source or metricIds for a metric source.",
  });

export const getProductAnalyticsColumnValuesEndpoint = {
  pathFragment: "/column-values",
  verb: "post" as const,
  operationId: "getProductAnalyticsColumnValues",
  validator: {
    bodySchema: getProductAnalyticsColumnValuesBodySchema,
    querySchema: z.never(),
    paramsSchema: z.never(),
  },
  zodReturnObject: z.object({
    values: z.record(z.string(), z.array(z.string())),
    warnings: z.array(z.string()).optional(),
  }),
  summary: "Fetch values for Product Analytics string columns",
};

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

export const getProductAnalyticsExplorationEndpoint = {
  pathFragment: "/explorations/:id",
  verb: "get" as const,
  operationId: "getProductAnalyticsExploration",
  validator: {
    bodySchema: z.never(),
    querySchema: z.never(),
    paramsSchema: z.object({ id: boundedId }).strict(),
  },
  zodReturnObject: z.object({
    exploration: apiAnalyticsExplorationValidator,
    query: apiQueryValidator.nullable(),
    explorationUrl: z.string(),
  }),
  summary: "Get a Product Analytics exploration",
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
    postMetricExplorationEndpoint,
    postFactTableExplorationEndpoint,
    postDataSourceExplorationEndpoint,
    postFunnelExplorationEndpoint,
    searchProductAnalyticsResourcesEndpoint,
    getProductAnalyticsColumnsEndpoint,
    getProductAnalyticsColumnValuesEndpoint,
    getProductAnalyticsExplorationEndpoint,
  ],
} satisfies OpenApiModelSpec;

export default analyticsExplorationApiSpec;
