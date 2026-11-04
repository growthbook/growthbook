import { crudEndpoint, customEndpoint } from "../api-model";
import {
  getInterleavingResultsEndpoint,
  getInterleavingSnapshotEndpoint,
  getInterleavingStatusEndpoint,
  interleavingApiSpec,
  listInterleavingSnapshotsEndpoint,
  refreshInterleavingEndpoint,
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
export const deleteInterleaving = crudEndpoint(interleavingApiSpec, "delete");
export const startInterleaving = customEndpoint(
  interleavingApiSpec,
  startInterleavingEndpoint,
);
export const stopInterleaving = customEndpoint(
  interleavingApiSpec,
  stopInterleavingEndpoint,
);
export const refreshInterleaving = customEndpoint(
  interleavingApiSpec,
  refreshInterleavingEndpoint,
);
export const getInterleavingResults = customEndpoint(
  interleavingApiSpec,
  getInterleavingResultsEndpoint,
);
export const getInterleavingStatus = customEndpoint(
  interleavingApiSpec,
  getInterleavingStatusEndpoint,
);
export const listInterleavingSnapshots = customEndpoint(
  interleavingApiSpec,
  listInterleavingSnapshotsEndpoint,
);
export const getInterleavingSnapshot = customEndpoint(
  interleavingApiSpec,
  getInterleavingSnapshotEndpoint,
);
