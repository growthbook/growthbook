import { toExperimentApiInterface } from "@back-end/src/services/experiments";
import { listExperimentsValidator } from "@back-end/src/validators/openapi";
import { getAllExperiments } from "@back-end/src/models/ExperimentModel";
import { ListExperimentsResponse } from "@back-end/types/openapi";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "@back-end/src/util/handler";

export const listExperiments = createApiRequestHandler(
  listExperimentsValidator
)(
  async (req): Promise<ListExperimentsResponse> => {
    const experiments = await getAllExperiments(req.context);

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      experiments
        .filter(
          (exp) =>
            applyFilter(req.query.experimentId, exp.trackingKey) &&
            applyFilter(req.query.datasourceId, exp.datasource) &&
            applyFilter(req.query.projectId, exp.project)
        )
        .sort((a, b) => a.dateCreated.getTime() - b.dateCreated.getTime()),
      req.query
    );

    const promises = filtered.map((experiment) =>
      toExperimentApiInterface(req.context, experiment)
    );
    const apiExperiments = await Promise.all(promises);

    return {
      experiments: apiExperiments,
      ...returnFields,
    };
  }
);
