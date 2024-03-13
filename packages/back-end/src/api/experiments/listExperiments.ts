import { toExperimentApiInterface } from "@/src/services/experiments";
import { listExperimentsValidator } from "@/src/validators/openapi";
import { getAllExperiments } from "@/src/models/ExperimentModel";
import { ListExperimentsResponse } from "@/types/openapi";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "@/src/util/handler";

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
