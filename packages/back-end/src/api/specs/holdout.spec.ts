import {
  apiCreateHoldoutBody,
  apiHoldoutStageReturn,
  apiHoldoutStageValidator,
  apiHoldoutValidator,
  apiListHoldoutsValidator,
  apiUpdateHoldoutBody,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

/** REST API surface for Holdouts under `/api/v1/holdouts/*`. */

export const holdoutStageEndpoint = {
  pathFragment: "/:id/stage",
  verb: "post" as const,
  operationId: "setHoldoutStage",
  validator: apiHoldoutStageValidator,
  zodReturnObject: apiHoldoutStageReturn,
  summary: "Move a Holdout to a different stage",
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
  // Deleting a Holdout cascades into its companion experiment and unlinks every
  // held-out Feature Flag and experiment, so it stays UI-only for now.
  crudActions: ["get", "create", "list", "update"],
  crudValidatorOverrides: {
    list: apiListHoldoutsValidator,
  },
  customEndpoints: [holdoutStageEndpoint],
  crudDescriptions: {
    create:
      "Creates a Holdout along with its companion experiment. The Holdout starts in the `draft` stage — use POST /holdouts/{id}/stage to start it.",
    update:
      "Updates a Holdout. Fields are written to the Holdout and its companion experiment as needed, so callers do not need to know where each field is stored. Use POST /holdouts/{id}/stage to change the stage.",
  },
  navDescription:
    "Hold a share of traffic out of all experiments to measure their combined effect.",
  navAfterTag: "experiments",
} satisfies OpenApiModelSpec;
export default holdoutApiSpec;
