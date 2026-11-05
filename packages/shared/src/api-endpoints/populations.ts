import { crudEndpoint } from "../api-model";
import { populationApiSpec } from "../validators/population.spec";

/**
 * Every REST route under `/api/v1/populations`, mounted by PopulationModel.
 * `pnpm generate-openapi` fails on any export the back-end does not mount.
 */

export const listPopulations = crudEndpoint(populationApiSpec, "list");
export const getPopulation = crudEndpoint(populationApiSpec, "get");
export const createPopulation = crudEndpoint(populationApiSpec, "create");
export const updatePopulation = crudEndpoint(populationApiSpec, "update");
export const deletePopulation = crudEndpoint(populationApiSpec, "delete");
