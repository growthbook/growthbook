import { z } from "zod";
import { OpenApiModelSpec } from "../api-model";
import {
  apiCreatePopulationBody,
  apiGetPopulationAnalysisValidator,
  apiLatestPopulationAnalysisReturn,
  apiPopulationAnalysisReturn,
  apiPopulationValidator,
  apiRefreshPopulationValidator,
  apiUpdatePopulationBody,
} from "./population";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

export const refreshPopulationEndpoint = {
  pathFragment: "/:id/refresh",
  verb: "post" as const,
  confirmation: [],
  operationId: "refreshPopulation",
  validator: apiRefreshPopulationValidator,
  zodReturnObject: apiPopulationAnalysisReturn,
  summary: "Refresh a Population's membership",
  description:
    "Runs the queries that calculate the Population's members over the last year. Waits a few seconds for them to finish; if they're still running, returns the analysis with status `running`. Poll `getPopulationAnalysis` for the result.",
};

export const getPopulationAnalysisEndpoint = {
  pathFragment: "/:id/analysis",
  verb: "get" as const,
  operationId: "getPopulationAnalysis",
  validator: apiGetPopulationAnalysisValidator,
  zodReturnObject: apiLatestPopulationAnalysisReturn,
  summary: "Get a Population's latest membership analysis",
};

/** REST API surface for Populations under `/api/v1/populations/*`. */
export const populationApiSpec = {
  modelSingular: "population",
  modelPlural: "populations",
  pathBase: "/populations",
  apiInterface: apiPopulationValidator,
  schemas: {
    createBody: apiCreatePopulationBody,
    updateBody: apiUpdatePopulationBody,
  },
  includeDefaultCrud: false,
  crudActions: ["list", "get", "create", "update", "delete"],
  confirmation: {
    create: ["other.write"],
    update: ["other.write"],
    delete: ["other.write"],
  },
  crudValidatorOverrides: {
    list: {
      paramsSchema: z.never(),
      bodySchema: z.never(),
      // Omitted limit defaults to 10 and cannot exceed 100, matching the other
      // paginated list endpoints. Callers that need every population follow
      // nextOffset.
      querySchema: z.object(paginationQueryFields).strict(),
      responseSchema: apiPaginationFieldsValidator.safeExtend({
        populations: z.array(apiPopulationValidator),
      }),
    },
  },
  customEndpoints: [refreshPopulationEndpoint, getPopulationAnalysisEndpoint],
  navDisplayName: "Populations",
  navDescription:
    "**Beta** — these endpoints are new and may change in backwards-incompatible ways.\n\nPopulations define a set of units by the steps they must complete, such as appearing in a fact table. Populations are not yet used in analysis.",
} as const satisfies OpenApiModelSpec;
export default populationApiSpec;
