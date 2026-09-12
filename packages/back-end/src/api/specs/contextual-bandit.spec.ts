import {
  apiContextualBanditCancelReturn,
  apiContextualBanditCancelValidator,
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
  description: `Replaces the full set of active variations on a Contextual Bandit. Send every variation you want to keep (by \`id\`) plus any new ones (omit \`id\` for the server to assign one); any active variation not in the request is deactivated and cannot be re-added. Weights are reconciled server-side. New arms require a value in \`newVariationValues\` for every linked feature; running CBs publish it, draft CBs stage it until start. Under an approval flow, unapproved drafts leave the added arm \`pending\` (zero weight, filtered from the SDK) until every linked feature's draft is live. Concurrent calls are safe — the server diffs under a CAS retry.`,
};

export const cancelContextualBanditEndpoint = {
  pathFragment: "/:id/cancel",
  verb: "post" as const,
  operationId: "cancelContextualBandit",
  validator: apiContextualBanditCancelValidator,
  zodReturnObject: apiContextualBanditCancelReturn,
  summary: "Cancel a running Contextual Bandit snapshot refresh",
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
    cancelContextualBanditEndpoint,
  ],
  navAfterTag: "experiments",
} satisfies OpenApiModelSpec;
export default contextualBanditApiSpec;
