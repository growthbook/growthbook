import {
  ExperimentInterfaceExcludingHoldouts,
  listExperimentsValidator,
} from "shared/validators";
import { ListExperimentsResponse } from "shared/types/openapi";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listExperiments = createApiRequestHandler(
  listExperimentsValidator,
)(async (req): Promise<ListExperimentsResponse> => {
  // Filter and sort at the database level for better performance
  // Note: type is not specified, which defaults to excluding holdouts
  const experiments = await getAllExperiments(req.context, {
    includeArchived: true,
    project: req.query.projectId,
    datasourceId: req.query.datasourceId,
    trackingKey: req.query.experimentId,
    sortBy: { dateCreated: 1 },
  });

  // TODO: Move pagination (limit/offset) to database for better performance
  const { filtered, returnFields } = applyPagination(experiments, req.query);

  const promises = filtered.map((experiment) =>
    toExperimentApiInterface(
      req.context,
      experiment as ExperimentInterfaceExcludingHoldouts,
    ),
  );
  const apiExperiments = await Promise.all(promises);

  return {
    experiments: apiExperiments,
    ...returnFields,
  };
});
