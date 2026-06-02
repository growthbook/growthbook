import {
  apiContextualBanditValidator,
  apiCreateContextualBanditBody,
  apiListContextualBanditsValidator,
  apiUpdateContextualBanditBody,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

/**
 * REST API surface for Contextual Bandits.
 *
 * PR-4 of the CB experiment-decoupling plan: introduces
 * `/api/v1/contextual-bandits/*` so customers don't have to author CBs
 * through the legacy `/api/v1/experiments/:id/contextual-bandit/*`
 * indirection. Only the standard CRUD endpoints are exposed in this PR;
 * custom endpoints (start, stop, refresh, snapshots, events) follow in
 * a later commit and the legacy nested routes stay alive for compat.
 *
 * `navAfterTag: "experiments"` so the docs render CB right under
 * Experiments in the sidebar — matches the in-app sidebar ordering.
 */
export const contextualBanditApiSpec = {
  modelSingular: "contextualBandit",
  modelPlural: "contextualBandits",
  pathBase: "/contextual-bandits",
  apiInterface: apiContextualBanditValidator,
  schemas: {
    createBody: apiCreateContextualBanditBody,
    updateBody: apiUpdateContextualBanditBody,
  },
  includeDefaultCrud: true,
  crudValidatorOverrides: {
    list: apiListContextualBanditsValidator,
  },
  navAfterTag: "experiments",
} satisfies OpenApiModelSpec;
export default contextualBanditApiSpec;
