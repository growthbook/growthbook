import { ListFactMetricsResponse } from "shared/types/openapi";
import { listFactMetricsValidator } from "shared/validators";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listFactMetrics = createApiRequestHandler(
  listFactMetricsValidator,
)(async (req): Promise<ListFactMetricsResponse> => {
  // Build database-level filter for better performance
  const filter: Record<string, unknown> = {};

  if (req.query.datasourceId) {
    filter.datasource = req.query.datasourceId;
  }

  if (req.query.factTableId) {
    filter["numerator.factTableId"] = req.query.factTableId;
  }

  if (req.query.projectId) {
    // Match if: projects array contains the projectId OR projects is empty/missing
    // (empty projects means the metric is available to all projects)
    filter.$or = [
      { projects: req.query.projectId },
      { projects: { $size: 0 } },
      { projects: { $exists: false } },
    ];
  }

  // Use getAllSorted to sort at DB level for better performance
  const factMetrics = await req.context.models.factMetrics.getAllSorted(filter);

  // TODO: Move pagination (limit/offset) to database for better performance
  const { filtered, returnFields } = applyPagination(factMetrics, req.query);

  return {
    factMetrics: filtered.map((factMetric) =>
      req.context.models.factMetrics.toApiInterface(factMetric),
    ),
    ...returnFields,
  };
});
