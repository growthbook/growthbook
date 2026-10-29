import { crudEndpoint, customEndpoint } from "../api-model";
import {
  interleavingApiSpec,
  startInterleavingEndpoint,
  stopInterleavingEndpoint,
} from "../validators/interleaving.spec";

/**
 * Every REST route under `/api/v1/interleavings`, mounted by InterleavingModel.
 * `pnpm generate-openapi` fails on any export the back-end does not mount.
 */

export const listInterleavings = crudEndpoint(interleavingApiSpec, "list");
export const createInterleaving = crudEndpoint(interleavingApiSpec, "create");
export const getInterleaving = crudEndpoint(interleavingApiSpec, "get");
export const updateInterleaving = crudEndpoint(interleavingApiSpec, "update");
export const startInterleaving = customEndpoint(
  interleavingApiSpec,
  startInterleavingEndpoint,
);
export const stopInterleaving = customEndpoint(
  interleavingApiSpec,
  stopInterleavingEndpoint,
);
