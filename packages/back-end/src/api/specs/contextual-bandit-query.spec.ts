import { z } from "zod";
import {
  apiContextualBanditQueryValidator,
  apiCreateContextualBanditQueryBody,
  apiUpdateContextualBanditQueryBody,
} from "shared/validators";
import type { OpenApiModelSpec } from "back-end/src/api/ApiModel";

/**
 * Synchronously recomputes `topValues` for every non-deleted attribute on a
 * CBAQ. In MVP this runs inline on the request; Phase B will schedule it via
 * the weekly Agenda job (CB MVP plan §A3.2 / §A6.4).
 */
export const refreshContextualBanditQueryTopValuesEndpoint = {
  pathFragment: "/:id/refresh-top-values",
  verb: "post" as const,
  operationId: "refreshContextualBanditQueryTopValues",
  validator: {
    paramsSchema: z.strictObject({
      id: z.string().describe("The id of the requested resource"),
    }),
    bodySchema: z.never(),
    querySchema: z.never(),
  },
  zodReturnObject: z
    .object({
      contextualBanditQuery: apiContextualBanditQueryValidator,
    })
    .strict(),
  summary: "Refresh contextual bandit query top values",
};

export const contextualBanditQueryApiSpec = {
  modelSingular: "contextualBanditQuery",
  modelPlural: "contextualBanditQueries",
  pathBase: "/contextual-bandit-queries",
  apiInterface: apiContextualBanditQueryValidator,
  schemas: {
    createBody: apiCreateContextualBanditQueryBody,
    updateBody: apiUpdateContextualBanditQueryBody,
  },
  includeDefaultCrud: true,
  customEndpoints: [refreshContextualBanditQueryTopValuesEndpoint],
  navDisplayName: "Contextual Bandit Queries",
  navDescription:
    "Datasource-scoped queries that supply per-user contextual attributes for contextual-bandit experiments.",
} satisfies OpenApiModelSpec;
export default contextualBanditQueryApiSpec;
