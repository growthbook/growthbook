import { z } from "zod";
import {
  apiCreateLearningBody,
  apiLearningValidator,
  apiListLearningsQuery,
  apiSearchLearningsBody,
  apiSearchLearningsResponse,
  apiUpdateLearningBody,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

// Add filter query params to the default list endpoint.
export const apiListLearningsValidator = {
  paramsSchema: z.never(),
  bodySchema: z.never(),
  querySchema: apiListLearningsQuery,
};

export const searchLearningsEndpoint = {
  pathFragment: "/search",
  verb: "post" as const,
  operationId: "searchLearnings",
  validator: {
    paramsSchema: z.never(),
    bodySchema: apiSearchLearningsBody,
    querySchema: z.never(),
  },
  zodReturnObject: apiSearchLearningsResponse,
  summary: "Semantically search saved learnings (learnings) by a query",
};

export const learningApiSpec = {
  modelSingular: "learning",
  modelPlural: "learnings",
  pathBase: "/learnings",
  apiInterface: apiLearningValidator,
  schemas: {
    createBody: apiCreateLearningBody,
    updateBody: apiUpdateLearningBody,
  },
  includeDefaultCrud: true,
  crudValidatorOverrides: {
    list: apiListLearningsValidator,
  },
  customEndpoints: [searchLearningsEndpoint],
  navDisplayName: "Learnings",
  navDescription:
    "Saved learnings captured across experiments, including AI-discovered patterns.",
} satisfies OpenApiModelSpec;
export default learningApiSpec;
