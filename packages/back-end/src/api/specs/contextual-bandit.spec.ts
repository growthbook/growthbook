import {
  apiContextualBanditLifecycleReturn,
  apiContextualBanditRefreshReturn,
  apiContextualBanditRefreshValidator,
  apiContextualBanditStartValidator,
  apiContextualBanditStopValidator,
  apiContextualBanditUpdateVariationsValidator,
  apiContextualBanditVariationsReturn,
  apiContextualBanditValidator,
  apiCreateContextualBanditBody,
  apiListContextualBanditsValidator,
  apiUpdateContextualBanditBody,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

/** REST API surface for Contextual Bandits under `/api/v1/contextual-bandits/*`. */

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

export const updateVariationsContextualBanditEndpoint = {
  pathFragment: "/:id/variations",
  verb: "post" as const,
  operationId: "updateContextualBanditVariations",
  validator: apiContextualBanditUpdateVariationsValidator,
  zodReturnObject: apiContextualBanditVariationsReturn,
  summary: "Add or remove Contextual Bandit variations",
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
  crudActions: ["get", "create", "list", "update"],
  crudValidatorOverrides: {
    list: apiListContextualBanditsValidator,
  },
  customEndpoints: [
    startContextualBanditEndpoint,
    stopContextualBanditEndpoint,
    refreshContextualBanditEndpoint,
    updateVariationsContextualBanditEndpoint,
  ],
  navAfterTag: "experiments",
} satisfies OpenApiModelSpec;
export default contextualBanditApiSpec;
