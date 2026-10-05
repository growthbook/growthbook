import {
  apiCreatePopulationBody,
  apiPopulationValidator,
  apiUpdatePopulationBody,
} from "shared/validators";
import { OpenApiModelSpec } from "shared/api-model";

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
  crudActions: ["create"],
  navDisplayName: "Populations",
  navDescription:
    "Populations define a set of units by the steps they must complete, such as appearing in a fact table.",
} satisfies OpenApiModelSpec;
export default populationApiSpec;
