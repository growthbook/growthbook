import { listMetricsValidator } from "shared/validators";
import { getDataSourcesByOrganization } from "back-end/src/models/DataSourceModel";
import { getMetricsByOrganization } from "back-end/src/models/MetricModel";
import { toMetricApiInterface } from "back-end/src/services/experiments";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listMetrics = createApiRequestHandler(listMetricsValidator)(async (
  req,
) => {
  // Filter at the database level for better performance
  const metrics = await getMetricsByOrganization(req.context, {
    datasourceId: req.query.datasourceId,
    projectId: req.query.projectId,
  });

  const datasources = await getDataSourcesByOrganization(req.context);

  // Sorting could be done at DB level, but we sort here instead to handle config file metrics
  // TODO: Move sorting and pagination (limit/offset) to database for better performance
  const { filtered, returnFields } = applyPagination(
    metrics.sort((a, b) => a.id.localeCompare(b.id)),
    req.query,
  );

  return {
    metrics: filtered.map((metric) =>
      toMetricApiInterface(
        req.organization,
        metric,
        datasources.find((ds) => ds.id === metric.datasource) || null,
      ),
    ),
    ...returnFields,
  };
});
