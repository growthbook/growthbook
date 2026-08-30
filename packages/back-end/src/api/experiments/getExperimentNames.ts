import { getExperimentNamesValidator } from "shared/validators";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getExperimentNames = createApiRequestHandler(
  getExperimentNamesValidator,
)(async (req) => {
  const experiments = await getAllExperiments(req.context, {
    project: req.query.projectId,
  });

  return {
    experiments: experiments.map((e) => ({ id: e.id, name: e.name })),
  };
});
