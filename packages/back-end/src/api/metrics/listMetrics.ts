import { z } from "zod";
import { ApiMetricInterface, ApiPaginationFields } from "../../../types/api";
import { getDataSourcesByOrganization } from "../../models/DataSourceModel";
import { getMetricsByOrganization } from "../../models/MetricModel";
import { toMetricApiInterface } from "../../services/experiments";
import { applyPagination, createApiRequestHandler } from "../../util/handler";

export const listMetrics = createApiRequestHandler({
  querySchema: z
    .object({
      limit: z.string().optional(),
      offset: z.string().optional(),
    })
    .strict(),
})(
  async (
    req
  ): Promise<ApiPaginationFields & { metrics: ApiMetricInterface[] }> => {
    const metrics = await getMetricsByOrganization(req.organization.id);

    const datasources = await getDataSourcesByOrganization(req.organization.id);

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      metrics.sort((a, b) => a.id.localeCompare(b.id)),
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
