import { toExperimentApiInterface } from "@back-end/src/services/experiments";
import { getExperimentValidator } from "@back-end/src/validators/openapi";
import { getExperimentById } from "@back-end/src/models/ExperimentModel";
import { GetExperimentResponse } from "@back-end/types/openapi";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const getExperiment = createApiRequestHandler(getExperimentValidator)(
  async (req): Promise<GetExperimentResponse> => {
    const experiment = await getExperimentById(req.context, req.params.id);
    if (!experiment) {
      throw new Error("Could not find experiment with that id");
    }

    const apiExperiment = await toExperimentApiInterface(
      req.context,
      experiment
    );
    return {
      experiment: apiExperiment,
    };
  }
);
