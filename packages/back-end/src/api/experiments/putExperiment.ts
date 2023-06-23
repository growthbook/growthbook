import { PutExperimentResponse } from "../../../types/openapi";
import {
  updateExperiment,
  getExperimentById,
} from "../../models/ExperimentModel";
import { toExperimentApiInterface } from "../../services/experiments";
import { createApiRequestHandler } from "../../util/handler";
import { putExperimentValidator } from "../../validators/openapi";

export const putExperiment = createApiRequestHandler(putExperimentValidator)(
  async (req): Promise<PutExperimentResponse> => {
    const experiment = await getExperimentById(
      req.organization.id,
      req.body.id
    );
    if (!experiment) {
      throw new Error("Could not find the experiment to update");
    }
    const updatedExperiment = await updateExperiment({
      organization: req.organization,
      experiment: experiment,
      user: req.eventAudit,
      changes: { ...req.body },
    });

    if (updatedExperiment === null) {
      throw new Error("Error happened during updating experiment.");
    }
    const apiExperiment = await toExperimentApiInterface(
      req.organization,
      updatedExperiment
    );
    return {
      experiment: apiExperiment,
    };
  }
);
