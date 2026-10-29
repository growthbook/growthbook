import { OpenApiModelSpec } from "../api-model";
import {
  apiCreateInterleavingBody,
  apiInterleavingLifecycleReturn,
  apiInterleavingStartValidator,
  apiInterleavingStopValidator,
  apiInterleavingValidator,
  apiListInterleavingsValidator,
  apiUpdateInterleavingBody,
} from "./interleaving";

/** REST API surface for interleaving experiments under `/api/v1/interleavings/*`. */

export const startInterleavingEndpoint = {
  pathFragment: "/:id/start",
  verb: "post" as const,
  confirmation: ["experiment.start"] as const,
  operationId: "startInterleaving",
  validator: apiInterleavingStartValidator,
  zodReturnObject: apiInterleavingLifecycleReturn,
  summary: "Start an interleaving experiment",
  description:
    "Starts serving the interleaving to SDKs in its enabled environments. A stopped interleaving can be started again; its start date is kept.",
};

export const stopInterleavingEndpoint = {
  pathFragment: "/:id/stop",
  verb: "post" as const,
  confirmation: ["experiment.stop"] as const,
  operationId: "stopInterleaving",
  validator: apiInterleavingStopValidator,
  zodReturnObject: apiInterleavingLifecycleReturn,
  summary: "Stop an interleaving experiment",
  description:
    "Removes the interleaving from SDK payloads, so `interleave()` falls back to `fallbackConfig`.",
};

export const interleavingApiSpec = {
  modelSingular: "interleaving",
  modelPlural: "interleavings",
  pathBase: "/interleavings",
  apiInterface: apiInterleavingValidator,
  schemas: {
    createBody: apiCreateInterleavingBody,
    updateBody: apiUpdateInterleavingBody,
  },
  crudActions: ["get", "create", "list", "update"],
  crudValidatorOverrides: {
    list: apiListInterleavingsValidator,
  },
  crudDescriptions: {
    update:
      "Archive an interleaving experiment by setting `archived`. Use the start and stop endpoints to change its status.",
  },
  confirmation: {
    create: ["experiment.create"],
    update: [
      "experiment.draft",
      "experiment.targeting",
      "experiment.traffic",
      "experiment.phases",
      "experiment.other",
    ],
  },
  confirmationInHandler: { update: true },
  customEndpoints: [startInterleavingEndpoint, stopInterleavingEndpoint],
  navDisplayName: "Interleaving Experiments",
  navAfterTag: "experiments",
} as const satisfies OpenApiModelSpec;
export default interleavingApiSpec;
