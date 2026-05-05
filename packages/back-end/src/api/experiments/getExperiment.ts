import {
  ExperimentInterfaceExcludingHoldouts,
  getExperimentValidator,
} from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toEnhancedExperimentApiResponse } from "./enhancedExperimentResponse";

export const getExperiment = createApiRequestHandler(getExperimentValidator)(
  async (req) => {
    const experiment = await getExperimentById(req.context, req.params.id);
    if (!experiment) {
      throw new Error("Could not find experiment with that id");
    }
    if (experiment.type === "holdout") {
      throw new Error("Holdouts are not supported via this API");
    }

    const apiExperiment = await toEnhancedExperimentApiResponse(
      req.context,
      experiment as ExperimentInterfaceExcludingHoldouts,
    );
    return {
      experiment: apiExperiment,
    };
  },
);
