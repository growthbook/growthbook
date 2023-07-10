import { UpdateExperimentResponse } from "../../../types/openapi";
import {
  updateExperiment as updateExperimentToDb,
  getExperimentById,
} from "../../models/ExperimentModel";
import { toExperimentApiInterface } from "../../services/experiments";
import { createApiRequestHandler } from "../../util/handler";
import { updateExperimentValidator } from "../../validators/openapi";

export const updateExperiment = createApiRequestHandler(
  updateExperimentValidator
)(
  async (req): Promise<UpdateExperimentResponse> => {
    const experiment = await getExperimentById(
      req.organization.id,
      req.params.id
    );
    if (!experiment) {
      throw new Error("Could not find the experiment to update");
    }
    const updatedExperiment = await updateExperimentToDb({
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
