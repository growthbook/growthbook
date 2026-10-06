import { crudEndpoint, customEndpoint } from "../api-model";
import { populationApiSpec } from "../validators/population.spec";
import { populationSnapshotApiSpec } from "../validators/population-snapshot.spec";
import {
  cancelPopulationRefreshEndpoint,
  refreshPopulationEndpoint,
} from "../validators/population-snapshot";

/**
 * Every REST route under `/api/v1/populations` and
 * `/api/v1/population-snapshots`, mounted by PopulationModel and
 * PopulationSnapshotModel. `pnpm generate-openapi` fails on any export the
 * back-end does not mount.
 */

export const listPopulations = crudEndpoint(populationApiSpec, "list");
export const getPopulation = crudEndpoint(populationApiSpec, "get");
export const createPopulation = crudEndpoint(populationApiSpec, "create");
export const updatePopulation = crudEndpoint(populationApiSpec, "update");
export const deletePopulation = crudEndpoint(populationApiSpec, "delete");
export const refreshPopulation = customEndpoint(
  populationApiSpec,
  refreshPopulationEndpoint,
);
export const cancelPopulationRefresh = customEndpoint(
  populationApiSpec,
  cancelPopulationRefreshEndpoint,
);

export const listPopulationSnapshots = crudEndpoint(
  populationSnapshotApiSpec,
  "list",
);
export const getPopulationSnapshot = crudEndpoint(
  populationSnapshotApiSpec,
  "get",
);
