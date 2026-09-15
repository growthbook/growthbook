import {
  apiContextualBanditQueryValidator,
  apiCreateContextualBanditQueryBody,
  apiListContextualBanditQueriesValidator,
  apiUpdateContextualBanditQueryBody,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

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
} satisfies OpenApiModelSpec;
export default contextualBanditQueryApiSpec;
