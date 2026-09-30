import { OpenApiModelSpec } from "../api-model";
import {
  apiContextualBanditQueryValidator,
  apiCreateContextualBanditQueryBody,
  apiListContextualBanditQueriesValidator,
  apiUpdateContextualBanditQueryBody,
} from "./contextual-bandit-query";

/** REST API surface for Contextual Bandit Queries under `/api/v1/contextual-bandit-queries/*`. */
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
  crudValidatorOverrides: {
    list: apiListContextualBanditQueriesValidator,
  },
  navAfterTag: "experiments",
} as const satisfies OpenApiModelSpec;
export default contextualBanditQueryApiSpec;
