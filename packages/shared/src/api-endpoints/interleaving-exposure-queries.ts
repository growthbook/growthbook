import { crudEndpoint } from "../api-model";
import { interleavingExposureQueryApiSpec } from "../validators/interleaving-exposure-query.spec";

/**
 * Every REST route under `/api/v1/interleaving-exposure-queries`. Each export is one
 * route, named after its operationId. InterleavingExposureQueryModel mounts them from
 * interleavingExposureQueryApiSpec, and `pnpm generate-openapi` fails on any export
 * the back-end does not mount, so nothing else belongs in this file.
 */

export const getInterleavingExposureQuery = crudEndpoint(
  interleavingExposureQueryApiSpec,
  "get",
);
export const createInterleavingExposureQuery = crudEndpoint(
  interleavingExposureQueryApiSpec,
  "create",
);
export const listInterleavingExposureQueries = crudEndpoint(
  interleavingExposureQueryApiSpec,
  "list",
);
export const deleteInterleavingExposureQuery = crudEndpoint(
  interleavingExposureQueryApiSpec,
  "delete",
);
export const updateInterleavingExposureQuery = crudEndpoint(
  interleavingExposureQueryApiSpec,
  "update",
);
