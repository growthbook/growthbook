import { listFactMetricsValidator } from "shared/validators";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listFactMetrics = createApiRequestHandler(
  listFactMetricsValidator,
)(async (req) => {
  const factMetrics = await req.context.models.factMetrics.getAllSorted({
    datasourceId: req.query.datasourceId,
    factTableId: req.query.factTableId,
    projectId: req.query.projectId,
  });

  // TODO: Move pagination (limit/offset) to database for better performance
  const { filtered, returnFields } = applyPagination(factMetrics, req.query);

  return {
    factMetrics: filtered.map((factMetric) =>
      req.context.models.factMetrics.toApiInterface(factMetric),
    ),
    ...returnFields,
  };
});
