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
  includeDefaultCrud: true,
  navDisplayName: "Populations",
  navDescription:
    "Multi-step analytics audiences built from fact tables, experiments, or features.",
} satisfies OpenApiModelSpec;
export default populationApiSpec;
