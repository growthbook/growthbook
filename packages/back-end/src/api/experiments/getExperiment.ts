import { toExperimentApiInterface } from "@/src/services/experiments";
import { getExperimentValidator } from "@/src/validators/openapi";
import { getExperimentById } from "@/src/models/ExperimentModel";
import { GetExperimentResponse } from "@/types/openapi";
import { createApiRequestHandler } from "@/src/util/handler";

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
