import {
  apiInterleavingValidator,
  apiCreateInterleavingBody,
  apiListInterleavingsValidator,
  apiUpdateInterleavingBody,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

/** REST API surface for Interleaving experiments under `/api/v1/interleavings/*`. */
export const interleavingApiSpec = {
  modelSingular: "interleaving",
  modelPlural: "interleavings",
  pathBase: "/interleavings",
  apiInterface: apiInterleavingValidator,
  schemas: {
    createBody: apiCreateInterleavingBody,
    updateBody: apiUpdateInterleavingBody,
  },
  includeDefaultCrud: true,
  crudValidatorOverrides: {
    list: apiListInterleavingsValidator,
  },
  navAfterTag: "experiments",
} satisfies OpenApiModelSpec;
export default interleavingApiSpec;
