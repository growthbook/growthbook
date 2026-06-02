import {
  apiContextualBanditLifecycleReturn,
  apiContextualBanditRefreshReturn,
  apiContextualBanditRefreshValidator,
  apiContextualBanditStartValidator,
  apiContextualBanditStopValidator,
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
 * indirection. Standard CRUD + lifecycle (start / stop) ship here;
 * heavier endpoints (refresh, snapshots, events) follow in a later
 * commit and the legacy nested routes stay alive for compat.
 *
 * `navAfterTag: "experiments"` so the docs render CB right under
 * Experiments in the sidebar — matches the in-app sidebar ordering.
 */

export const startContextualBanditEndpoint = {
  pathFragment: "/:id/start",
  verb: "post" as const,
  operationId: "startContextualBandit",
  validator: apiContextualBanditStartValidator,
  zodReturnObject: apiContextualBanditLifecycleReturn,
  summary: "Start a Contextual Bandit",
};

export const stopContextualBanditEndpoint = {
  pathFragment: "/:id/stop",
  verb: "post" as const,
  operationId: "stopContextualBandit",
  validator: apiContextualBanditStopValidator,
  zodReturnObject: apiContextualBanditLifecycleReturn,
  summary: "Stop a Contextual Bandit",
};

export const refreshContextualBanditEndpoint = {
  pathFragment: "/:id/refresh",
  verb: "post" as const,
  operationId: "refreshContextualBandit",
  validator: apiContextualBanditRefreshValidator,
  zodReturnObject: apiContextualBanditRefreshReturn,
  summary: "Trigger a Contextual Bandit snapshot refresh",
};

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
  customEndpoints: [
    startContextualBanditEndpoint,
    stopContextualBanditEndpoint,
    refreshContextualBanditEndpoint,
  ],
  navAfterTag: "experiments",
} satisfies OpenApiModelSpec;
export default contextualBanditApiSpec;
