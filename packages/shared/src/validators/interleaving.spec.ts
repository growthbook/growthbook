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
import {
  apiGetInterleavingResultsValidator,
  apiGetInterleavingSnapshotValidator,
  apiInterleavingRefreshValidator,
  apiInterleavingResultsReturn,
  apiInterleavingSnapshotReturn,
  apiInterleavingSnapshotsReturn,
  apiListInterleavingSnapshotsValidator,
} from "./interleaving-snapshot";

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

export const refreshInterleavingEndpoint = {
  pathFragment: "/:id/refresh",
  verb: "post" as const,
  confirmation: [] as const,
  operationId: "refreshInterleaving",
  validator: apiInterleavingRefreshValidator,
  zodReturnObject: apiInterleavingSnapshotReturn,
  summary: "Refresh interleaving experiment results",
  description:
    "Creates a results snapshot and starts its metric queries against the Data Source. The experiment must have been started and have at least one metric. Queries run asynchronously; poll the snapshot until its `status` is `success` or `error`.",
};

export const getInterleavingResultsEndpoint = {
  pathFragment: "/:id/results",
  verb: "get" as const,
  operationId: "getInterleavingResults",
  validator: apiGetInterleavingResultsValidator,
  zodReturnObject: apiInterleavingResultsReturn,
  summary: "Get the latest interleaving experiment results",
  description:
    "The most recent results snapshot, whatever its status. `snapshot` is null before the first refresh.",
};

export const listInterleavingSnapshotsEndpoint = {
  pathFragment: "/:id/snapshots",
  verb: "get" as const,
  operationId: "listInterleavingSnapshots",
  validator: apiListInterleavingSnapshotsValidator,
  zodReturnObject: apiInterleavingSnapshotsReturn,
  summary: "List interleaving experiment results snapshots",
  description: "Newest first. The first entry is the latest results.",
};

export const getInterleavingSnapshotEndpoint = {
  pathFragment: "/:id/snapshots/:snapshotId",
  verb: "get" as const,
  operationId: "getInterleavingSnapshot",
  validator: apiGetInterleavingSnapshotValidator,
  zodReturnObject: apiInterleavingSnapshotReturn,
  summary: "Get an interleaving experiment results snapshot",
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
  customEndpoints: [
    startInterleavingEndpoint,
    stopInterleavingEndpoint,
    refreshInterleavingEndpoint,
    getInterleavingResultsEndpoint,
    listInterleavingSnapshotsEndpoint,
    getInterleavingSnapshotEndpoint,
  ],
  navDisplayName: "Interleaving Experiments",
  navAfterTag: "experiments",
} as const satisfies OpenApiModelSpec;
export default interleavingApiSpec;
