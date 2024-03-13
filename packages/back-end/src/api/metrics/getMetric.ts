import { toMetricApiInterface } from "@/src/services/experiments";
import { getMetricValidator } from "@/src/validators/openapi";
import { GetMetricResponse } from "@/types/openapi";
import { getDataSourceById } from "@/src/models/DataSourceModel";
import { getMetricById } from "@/src/models/MetricModel";
import { createApiRequestHandler } from "@/src/util/handler";

export const getMetric = createApiRequestHandler(getMetricValidator)(
  async (req): Promise<GetMetricResponse> => {
    const metric = await getMetricById(req.context, req.params.id, false);
    if (!metric) {
      throw new Error("Could not find metric with that id");
    }

    const datasource = metric.datasource
      ? await getDataSourceById(req.context, metric.datasource)
      : null;

    return {
      metric: toMetricApiInterface(req.organization, metric, datasource),
    };
  }
);
