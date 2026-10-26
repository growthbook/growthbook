import { OpenApiModelSpec } from "../api-model";
import {
  apiInterleavingExposureQueryValidator,
  apiCreateInterleavingExposureQueryBody,
  apiListInterleavingExposureQueriesValidator,
  apiUpdateInterleavingExposureQueryBody,
} from "./interleaving-exposure-query";

/** REST API surface for Interleaving Exposure Queries under `/api/v1/interleaving-exposure-queries/*`. */
export const interleavingExposureQueryApiSpec = {
  modelSingular: "interleavingExposureQuery",
  modelPlural: "interleavingExposureQueries",
  pathBase: "/interleaving-exposure-queries",
  apiInterface: apiInterleavingExposureQueryValidator,
  schemas: {
    createBody: apiCreateInterleavingExposureQueryBody,
    updateBody: apiUpdateInterleavingExposureQueryBody,
  },
  includeDefaultCrud: true,
  // Mirrors contextual-bandit-query: an auxiliary query config for an experiment type.
  confirmation: {
    create: ["experiment.create"],
    update: ["experiment.other"],
    delete: ["experiment.other"],
  },
  crudValidatorOverrides: {
    list: apiListInterleavingExposureQueriesValidator,
  },
  navAfterTag: "experiments",
} as const satisfies OpenApiModelSpec;
export default interleavingExposureQueryApiSpec;
