import { GetExperimentResponse } from "../../../types/openapi";
import { getExperimentById } from "../../models/ExperimentModel";
import { toExperimentApiInterface } from "../../services/experiments";
import { createApiRequestHandler } from "../../util/handler";
import { getExperimentValidator } from "../../validators/openapi";

export const getExperiment = createApiRequestHandler(getExperimentValidator)(
  async (req): Promise<GetExperimentResponse> => {
    const experiment = await getExperimentById(
      req.organization.id,
      req.params.id
    );
    if (!experiment) {
      throw new Error("Could not find experiment with that id");
    }

    return {
      experiment: toExperimentApiInterface(req.organization, experiment),
    };
  }
);
