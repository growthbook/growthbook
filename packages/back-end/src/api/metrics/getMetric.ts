import { GetMetricResponse } from "back-end/types/openapi";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getMetricById } from "back-end/src/models/MetricModel";
import { toMetricApiInterface } from "back-end/src/services/experiments";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getMetricValidator } from "back-end/src/validators/openapi";

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
