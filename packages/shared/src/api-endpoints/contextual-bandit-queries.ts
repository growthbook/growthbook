import { crudEndpoint } from "../api-model";
import { contextualBanditQueryApiSpec } from "../validators/contextual-bandit-query.spec";

/**
 * Every REST route under `/api/v1/contextual-bandit-queries`. Each export is
 * one route, named after its operationId. ContextualBanditQueryModel mounts
 * them from contextualBanditQueryApiSpec, and `pnpm generate-openapi` fails on
 * any export the back-end does not mount, so nothing else belongs in this file.
 */

export const getContextualBanditQuery = crudEndpoint(
  contextualBanditQueryApiSpec,
  "get",
);
export const createContextualBanditQuery = crudEndpoint(
  contextualBanditQueryApiSpec,
  "create",
);
export const listContextualBanditQueries = crudEndpoint(
  contextualBanditQueryApiSpec,
  "list",
);
export const deleteContextualBanditQuery = crudEndpoint(
  contextualBanditQueryApiSpec,
  "delete",
);
export const updateContextualBanditQuery = crudEndpoint(
  contextualBanditQueryApiSpec,
  "update",
);
