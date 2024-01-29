import { GetMetricResponse } from "../../../types/openapi";
import { getDataSourceById } from "../../models/DataSourceModel";
import { getMetricById } from "../../models/MetricModel";
import { toMetricApiInterface } from "../../services/experiments";
import { createApiRequestHandler } from "../../util/handler";
import { getMetricValidator } from "../../validators/openapi";

export const getMetric = createApiRequestHandler(getMetricValidator)(
  async (req): Promise<GetMetricResponse> => {
    const metric = await getMetricById(
      req.params.id,
      req.organization.id,
      false
    );
    if (!metric) {
      throw new Error("Could not find metric with that id");
    }

    const datasource = metric.datasource
      ? await getDataSourceById(metric.datasource, req.context)
      : null;

    return {
      metric: toMetricApiInterface(req.organization, metric, datasource),
    };
  }
);
