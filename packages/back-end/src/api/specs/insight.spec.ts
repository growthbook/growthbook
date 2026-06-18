import { z } from "zod";
import {
  apiCreateInsightBody,
  apiInsightValidator,
  apiListInsightsQuery,
  apiSearchInsightsBody,
  apiSearchInsightsResponse,
  apiUpdateInsightBody,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

// Add filter query params to the default list endpoint.
export const apiListInsightsValidator = {
  paramsSchema: z.never(),
  bodySchema: z.never(),
  querySchema: apiListInsightsQuery,
};

export const searchInsightsEndpoint = {
  pathFragment: "/search",
  verb: "post" as const,
  operationId: "searchInsights",
  validator: {
    paramsSchema: z.never(),
    bodySchema: apiSearchInsightsBody,
    querySchema: z.never(),
  },
  zodReturnObject: apiSearchInsightsResponse,
  summary: "Semantically search saved insights (learnings) by a query",
};

export const insightApiSpec = {
  modelSingular: "insight",
  modelPlural: "insights",
  pathBase: "/insights",
  apiInterface: apiInsightValidator,
  schemas: {
    createBody: apiCreateInsightBody,
    updateBody: apiUpdateInsightBody,
  },
  includeDefaultCrud: true,
  crudValidatorOverrides: {
    list: apiListInsightsValidator,
  },
  customEndpoints: [searchInsightsEndpoint],
  navDisplayName: "Insights",
  navDescription:
    "Saved learnings captured across experiments, including AI-discovered patterns.",
} satisfies OpenApiModelSpec;
export default insightApiSpec;
