import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getExperimentNamesValidator } from "back-end/src/validators/openapi";
import { GetExperimentNamesResponse } from "back-end/types/openapi";

export const getExperimentNames = createApiRequestHandler(
  getExperimentNamesValidator
)(
  async (req): Promise<GetExperimentNamesResponse> => {
    const experiments = await getAllExperiments(req.context, {
      project: req.query.projectId,
    });

    return {
      experiments: experiments.map((e) => ({ id: e.id, name: e.name })),
    };
  }
);
