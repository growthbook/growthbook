import {
  apiCreateHoldoutBody,
  apiHoldoutActionReturn,
  apiHoldoutActionValidator,
  apiHoldoutValidator,
  apiListHoldoutsValidator,
  apiUpdateHoldoutBody,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

/** REST API surface for Holdouts under `/api/v1/holdouts/*`. */

export const holdoutStartEndpoint = {
  pathFragment: "/:id/start",
  verb: "post" as const,
  operationId: "startHoldout",
  validator: apiHoldoutActionValidator,
  zodReturnObject: apiHoldoutActionReturn,
  summary: "Start a Holdout",
  possibleErrors: ["invalid_status"] as const,
};

export const holdoutStartAnalysisEndpoint = {
  pathFragment: "/:id/start-analysis",
  verb: "post" as const,
  operationId: "startHoldoutAnalysis",
  validator: apiHoldoutActionValidator,
  zodReturnObject: apiHoldoutActionReturn,
  summary: "Start a Holdout analysis period",
  possibleErrors: ["invalid_status"] as const,
};

export const holdoutStopEndpoint = {
  pathFragment: "/:id/stop",
  verb: "post" as const,
  operationId: "stopHoldout",
  validator: apiHoldoutActionValidator,
  zodReturnObject: apiHoldoutActionReturn,
  summary: "Stop a Holdout",
  possibleErrors: ["invalid_status"] as const,
};

export const holdoutApiSpec = {
  modelSingular: "holdout",
  modelPlural: "holdouts",
  pathBase: "/holdouts",
  apiInterface: apiHoldoutValidator,
  schemas: {
    createBody: apiCreateHoldoutBody,
    updateBody: apiUpdateHoldoutBody,
  },
  crudActions: ["get", "create", "list", "update"],
  crudValidatorOverrides: {
    list: apiListHoldoutsValidator,
  },
  customEndpoints: [
    holdoutStartEndpoint,
    holdoutStartAnalysisEndpoint,
    holdoutStopEndpoint,
  ],
  crudDescriptions: {
    create:
      "Creates a Holdout. The Holdout starts in the `draft` stage. Use POST /holdouts/{id}/start to start it.",
    update:
      "Updates a Holdout. Use the start, start-analysis, and stop endpoints to move it through its lifecycle.",
  },
  navDescription:
    "Hold a share of traffic out of all experiments to measure their combined effect.",
  navAfterTag: "experiments",
} satisfies OpenApiModelSpec;
export default holdoutApiSpec;
