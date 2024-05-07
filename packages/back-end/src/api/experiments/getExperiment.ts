import { GetExperimentResponse } from "../../../types/openapi";
import { getExperimentById } from "../../models/ExperimentModel";
import { toExperimentApiInterface } from "../../services/experiments";
import { createApiRequestHandler } from "../../util/handler";
import { getExperimentValidator } from "../../validators/openapi";

export const getExperiment = createApiRequestHandler(getExperimentValidator)(
  async (req): Promise<GetExperimentResponse> => {
    const experiment = await getExperimentById(req.context, req.params.id);
    if (!experiment) {
      throw new Error("Could not find experiment with that id");
    }

    const apiExperiment = await toExperimentApiInterface(
      req.context,
      experiment,
    );
    return {
      experiment: apiExperiment,
    };
  },
);
