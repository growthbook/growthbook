import { z } from "zod";
import { OpenApiModelSpec } from "../api-model";
import {
  apiCreatePopulationBody,
  apiPopulationValidator,
  apiUpdatePopulationBody,
} from "./population";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";

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
  navDisplayName: "Populations",
  navDescription:
    "**Beta** — these endpoints are new and may change in backwards-incompatible ways.\n\nPopulations define a set of units by the steps they must complete, such as appearing in a fact table. Populations are not yet used in analysis.",
} as const satisfies OpenApiModelSpec;
export default populationApiSpec;
