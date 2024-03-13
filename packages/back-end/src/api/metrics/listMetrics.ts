import { toMetricApiInterface } from "@/src/services/experiments";
import { listMetricsValidator } from "@/src/validators/openapi";
import { ListMetricsResponse } from "@/types/openapi";
import { getDataSourcesByOrganization } from "@/src/models/DataSourceModel";
import { getMetricsByOrganization } from "@/src/models/MetricModel";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "@/src/util/handler";

export const listMetrics = createApiRequestHandler(listMetricsValidator)(
  async (req): Promise<ListMetricsResponse> => {
    const metrics = await getMetricsByOrganization(req.context);

    const datasources = await getDataSourcesByOrganization(req.context);

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      metrics
        .filter(
          (metric) =>
            applyFilter(req.query.datasourceId, metric.datasource) &&
            applyFilter(req.query.projectId, metric.projects, true)
        )
        .sort((a, b) => a.id.localeCompare(b.id)),
      req.query
    );

    return {
      metrics: filtered.map((metric) =>
        toMetricApiInterface(
          req.organization,
          metric,
          datasources.find((ds) => ds.id === metric.datasource) || null
        )
      ),
      ...returnFields,
    };
  }
);
