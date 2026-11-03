import {
  ExperimentInterfaceExcludingHoldouts,
  getExperimentValidator,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toEnhancedExperimentApiResponse } from "./enhancedExperimentResponse";
import { requireExperiment } from "./requireExperiment";

export const getExperiment = createApiRequestHandler(getExperimentValidator)(
  async (req) => {
    const experiment = await requireExperiment(req.context, req.params.id);

    const apiExperiment = await toEnhancedExperimentApiResponse(
      req.context,
      experiment as ExperimentInterfaceExcludingHoldouts,
    );
    return {
      experiment: apiExperiment,
    };
  },
);
