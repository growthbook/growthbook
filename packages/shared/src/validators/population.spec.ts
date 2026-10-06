import { OpenApiModelSpec } from "../api-model";
import {
  apiCreatePopulationBody,
  apiPopulationValidator,
  apiUpdatePopulationBody,
} from "./population";
import {
  cancelPopulationRefreshEndpoint,
  refreshPopulationEndpoint,
} from "./population-snapshot";

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
  customEndpoints: [refreshPopulationEndpoint, cancelPopulationRefreshEndpoint],
  navDisplayName: "Populations",
  navDescription:
    "Populations define a set of units by the steps they must complete, such as appearing in a fact table.",
} as const satisfies OpenApiModelSpec;
export default populationApiSpec;
