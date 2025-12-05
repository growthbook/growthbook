import { ExperimentInterfaceExcludingHoldouts } from "shared/src/validators/experiments";
import { ListExperimentsResponse } from "back-end/types/openapi";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { listExperimentsValidator } from "back-end/src/validators/openapi";

export const listExperiments = createApiRequestHandler(
  listExperimentsValidator,
)(async (req): Promise<ListExperimentsResponse> => {
  const experiments = await getAllExperiments(req.context, {
    includeArchived: true,
  });

  // TODO: Move sorting/limiting to the database query for better performance
  const { filtered, returnFields } = applyPagination(
    experiments
      .filter(
        (exp) =>
          applyFilter(req.query.experimentId, exp.trackingKey) &&
          applyFilter(req.query.datasourceId, exp.datasource) &&
          applyFilter(req.query.projectId, exp.project) &&
          exp.type !== "holdout",
      )
      .sort((a, b) => a.dateCreated.getTime() - b.dateCreated.getTime()),
    req.query,
  );

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
