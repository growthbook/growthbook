import { z } from "zod";
import { ApiMetricInterface } from "../../../types/api";
import { getDataSourceById } from "../../models/DataSourceModel";
import { getMetricById } from "../../models/MetricModel";
import { toMetricApiInterface } from "../../services/experiments";
import { createApiRequestHandler } from "../../util/handler";

export const getMetric = createApiRequestHandler({
  paramsSchema: z
    .object({
      id: z.string(),
    })
    .strict(),
})(
  async (req): Promise<{ metric: ApiMetricInterface }> => {
    const metric = await getMetricById(
      req.params.id,
      req.organization.id,
      false
    );
    if (!metric) {
      throw new Error("Could not find metric with that id");
    }

    const datasource = metric.datasource
      ? await getDataSourceById(metric.datasource, req.organization.id)
      : null;

    return {
      metric: toMetricApiInterface(req.organization, metric, datasource),
    };
  }
);
