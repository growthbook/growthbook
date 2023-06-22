import { ExperimentInterface } from "../../../types/experiment";
import { PutExperimentResponse } from "../../../types/openapi";
import { createExperiment } from "../../models/ExperimentModel";
import { toExperimentApiInterface } from "../../services/experiments";
import { createApiRequestHandler } from "../../util/handler";
import { putExperimentValidator } from "../../validators/openapi";

export const putExperiment = createApiRequestHandler(putExperimentValidator)(
  async (req): Promise<PutExperimentResponse> => {
    const newExperiment: Partial<ExperimentInterface> = {
      ...req.body,
      dateCreated: new Date(),
      dateUpdated: new Date(),
      datasource: req.body.datasourceId,
      organization: req.organization.id,
      implementation: "code",
      phases: [],
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
