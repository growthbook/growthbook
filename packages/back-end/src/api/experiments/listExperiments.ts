import { ListExperimentsResponse } from "../../../types/openapi";
import { getAllExperiments } from "../../models/ExperimentModel";
import { toExperimentApiInterface } from "../../services/experiments";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "../../util/handler";
import { listExperimentsValidator } from "../../validators/openapi";

export const listExperiments = createApiRequestHandler(
  listExperimentsValidator
)(
  async (req): Promise<ListExperimentsResponse> => {
    const experiments = await getAllExperiments(req.organization.id);

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
