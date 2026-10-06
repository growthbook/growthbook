import { OpenApiModelSpec } from "../api-model";
import {
  apiInterleavingQueryValidator,
  apiCreateInterleavingQueryBody,
  apiListInterleavingQueriesValidator,
  apiUpdateInterleavingQueryBody,
} from "./interleaving-query";

/** REST API surface for Interleaving Queries under `/api/v1/interleaving-queries/*`. */
export const interleavingQueryApiSpec = {
  modelSingular: "interleavingQuery",
  modelPlural: "interleavingQueries",
  pathBase: "/interleaving-queries",
  apiInterface: apiInterleavingQueryValidator,
  schemas: {
    createBody: apiCreateInterleavingQueryBody,
    updateBody: apiUpdateInterleavingQueryBody,
  },
  includeDefaultCrud: true,
  crudValidatorOverrides: {
    list: apiListInterleavingQueriesValidator,
  },
  navAfterTag: "experiments",
} as const satisfies OpenApiModelSpec;
export default interleavingQueryApiSpec;
