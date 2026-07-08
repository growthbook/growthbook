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
  navDisplayName: "Contextual Bandit Queries (Beta)",
  navDescription:
    "**Beta** — Part of the Contextual Bandits beta and not yet officially released. These endpoints may change in backwards-incompatible ways. Queries used to power Contextual Bandit analysis.",
} satisfies OpenApiModelSpec;
export default contextualBanditQueryApiSpec;
