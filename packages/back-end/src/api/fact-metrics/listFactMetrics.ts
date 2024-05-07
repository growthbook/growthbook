import { isProjectListValidForProject } from "shared/util";
import { ListFactMetricsResponse } from "../../../types/openapi";
import { applyPagination, createApiRequestHandler } from "../../util/handler";
import { listFactMetricsValidator } from "../../validators/openapi";

export const listFactMetrics = createApiRequestHandler(
  listFactMetricsValidator,
)(async (req): Promise<ListFactMetricsResponse> => {
  const factMetrics = await req.context.models.factMetrics.getAll();

  let matches = factMetrics;
  if (req.query.projectId) {
    matches = matches.filter((factMetric) =>
      isProjectListValidForProject(factMetric.projects, req.query.projectId),
    );
  }
  if (req.query.datasourceId) {
    matches = matches.filter(
      (factMetric) => factMetric.datasource === req.query.datasourceId,
    );
  }
  if (req.query.factTableId) {
    matches = matches.filter(
      (factMetric) =>
        factMetric.numerator?.factTableId === req.query.factTableId,
    );
  }

  // TODO: Move sorting/limiting to the database query for better performance
  const { filtered, returnFields } = applyPagination(
    matches.sort((a, b) => a.id.localeCompare(b.id)),
    req.query,
  );

  return {
    factMetrics: filtered.map((factMetric) =>
      req.context.models.factMetrics.toApiInterface(factMetric),
    ),
    ...returnFields,
  };
});
