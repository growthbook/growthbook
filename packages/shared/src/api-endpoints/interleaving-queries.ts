import { crudEndpoint } from "../api-model";
import { interleavingQueryApiSpec } from "../validators/interleaving-query.spec";

/**
 * Every REST route under `/api/v1/interleaving-queries`. Each export is one
 * route, named after its operationId. InterleavingQueryModel mounts them from
 * interleavingQueryApiSpec, and `pnpm generate-openapi` fails on any export
 * the back-end does not mount, so nothing else belongs in this file.
 */

export const getInterleavingQuery = crudEndpoint(
  interleavingQueryApiSpec,
  "get",
);
export const createInterleavingQuery = crudEndpoint(
  interleavingQueryApiSpec,
  "create",
);
export const listInterleavingQueries = crudEndpoint(
  interleavingQueryApiSpec,
  "list",
);
export const deleteInterleavingQuery = crudEndpoint(
  interleavingQueryApiSpec,
  "delete",
);
export const updateInterleavingQuery = crudEndpoint(
  interleavingQueryApiSpec,
  "update",
);
