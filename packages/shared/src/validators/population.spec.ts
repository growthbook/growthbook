import { OpenApiModelSpec } from "../api-model";
import {
  apiCreatePopulationBody,
  apiPopulationValidator,
  apiUpdatePopulationBody,
} from "./population";

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
  navDisplayName: "Populations",
  navDescription:
    "**Beta** — these endpoints are new and may change in backwards-incompatible ways.\n\nPopulations define a set of units by the steps they must complete, such as appearing in a fact table.",
} as const satisfies OpenApiModelSpec;
export default populationApiSpec;
