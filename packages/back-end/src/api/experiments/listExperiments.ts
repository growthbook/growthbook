import {
  ExperimentInterfaceExcludingHoldouts,
  listExperimentsValidator,
} from "shared/validators";
import { ListExperimentsResponse } from "shared/types/openapi";
import { ProjectInterface } from "shared/types/project";
import { getAllExperiments } from "back-end/src/models/ExperimentModel";
import { toExperimentApiInterface } from "back-end/src/services/experiments";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

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

  // Batch-load all projects for the filtered experiments to avoid N+1 queries
  const projectIds = [
    ...new Set(
      filtered.map((exp) => exp.project).filter((p): p is string => !!p),
    ),
  ];
  const projects = projectIds.length
    ? await req.context.models.projects.getByIds(projectIds)
    : [];
  const projectMap = new Map<string, ProjectInterface>(
    projects.map((p) => [p.id, p]),
  );

  const promises = filtered.map((experiment) =>
    toExperimentApiInterface(
      req.context,
      experiment as ExperimentInterfaceExcludingHoldouts,
      projectMap,
    ),
  );
  const apiExperiments = await Promise.all(promises);

  return {
    experiments: apiExperiments,
    ...returnFields,
  };
});
