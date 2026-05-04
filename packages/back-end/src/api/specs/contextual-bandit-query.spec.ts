import {
  apiAddCbaqAttributeValidator,
  apiContextualBanditQueryValidator,
  apiCreateContextualBanditQueryBody,
  apiDeleteCbaqAttributeValidator,
  apiRefreshTopValuesValidator,
  apiTestContextualBanditQueryValidator,
  apiUpdateCbaqAttributeValidator,
  apiUpdateContextualBanditQueryBody,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

/**
 * Custom endpoints for ContextualBanditQuery (CBAQ) — wired into the model
 * via `customHandlers` in `ContextualBanditQueryModel.ts`. Defining the
 * spec here lets the OpenAPI generator pick them up while still letting
 * the model own the runtime handler bodies.
 */
export const testCbaqEndpoint = {
  pathFragment: "/:id/test",
  verb: "post" as const,
  operationId: "testContextualBanditQuery",
  validator: apiTestContextualBanditQueryValidator,
  zodReturnObject: apiTestContextualBanditQueryValidator.responseSchema,
  summary: "Test a contextual bandit query against its datasource",
};

export const refreshCbaqTopValuesEndpoint = {
  pathFragment: "/:id/refresh-top-values",
  verb: "post" as const,
  operationId: "refreshContextualBanditQueryTopValues",
  validator: apiRefreshTopValuesValidator,
  zodReturnObject: apiRefreshTopValuesValidator.responseSchema,
  summary: "Queue an immediate refresh of cached top values for a CBAQ",
};

export const addCbaqAttributeEndpoint = {
  pathFragment: "/:id/attributes",
  verb: "post" as const,
  operationId: "addContextualBanditQueryAttribute",
  validator: apiAddCbaqAttributeValidator,
  zodReturnObject: apiAddCbaqAttributeValidator.responseSchema,
  summary: "Append a contextual attribute to a CBAQ",
};

export const updateCbaqAttributeEndpoint = {
  pathFragment: "/:id/attributes/:column",
  verb: "put" as const,
  operationId: "updateContextualBanditQueryAttribute",
  validator: apiUpdateCbaqAttributeValidator,
  zodReturnObject: apiUpdateCbaqAttributeValidator.responseSchema,
  summary: "Update a contextual attribute on a CBAQ",
};

export const deleteCbaqAttributeEndpoint = {
  pathFragment: "/:id/attributes/:column",
  verb: "delete" as const,
  operationId: "deleteContextualBanditQueryAttribute",
  validator: apiDeleteCbaqAttributeValidator,
  zodReturnObject: apiDeleteCbaqAttributeValidator.responseSchema,
  summary: "Soft-delete a contextual attribute on a CBAQ",
};

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
  navDisplayName: "Contextual Bandit Queries",
  navDescription:
    "Per-datasource SQL definitions used by the contextual bandit pipeline.",
  customEndpoints: [
    testCbaqEndpoint,
    refreshCbaqTopValuesEndpoint,
    addCbaqAttributeEndpoint,
    updateCbaqAttributeEndpoint,
    deleteCbaqAttributeEndpoint,
  ],
} satisfies OpenApiModelSpec;

export default contextualBanditQueryApiSpec;
