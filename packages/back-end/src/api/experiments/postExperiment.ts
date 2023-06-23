import { ExperimentInterface } from "../../../types/experiment";
import { PostExperimentResponse } from "../../../types/openapi";
import { createExperiment } from "../../models/ExperimentModel";
import { toExperimentApiInterface } from "../../services/experiments";
import { createApiRequestHandler } from "../../util/handler";
import { postExperimentValidator } from "../../validators/openapi";

export const postExperiment = createApiRequestHandler(postExperimentValidator)(
  async (req): Promise<PostExperimentResponse> => {
    const newExperiment: Partial<ExperimentInterface> = {
      phases: [],
      ...req.body,
      datasource: req.body.datasourceId,
      implementation: "code",
    };

    const experiment = await createExperiment({
      data: newExperiment,
      organization: req.organization,
      user: req.eventAudit,
    });

    const apiExperiment = await toExperimentApiInterface(
      req.organization,
      experiment
    );
    return {
      experiment: apiExperiment,
    };
  }
);
