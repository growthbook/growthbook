import {
  createMetric,
  postMetricApiPayloadIsValid,
  postMetricApiPayloadToMetricInterface,
  toMetricApiInterface,
} from "@back-end/src/services/experiments";
import { postMetricValidator } from "@back-end/src/validators/openapi";
import { PostMetricResponse } from "@back-end/types/openapi";
import { getDataSourceById } from "@back-end/src/models/DataSourceModel";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const postMetric = createApiRequestHandler(postMetricValidator)(
  async (req): Promise<PostMetricResponse> => {
    const { datasourceId } = req.body;

    const datasource = await getDataSourceById(req.context, datasourceId);
    if (!datasource) {
      throw new Error(`Invalid data source: ${datasourceId}`);
    }

    req.checkPermissions("createMetrics", req.body?.projects ?? "");

    const validationResult = postMetricApiPayloadIsValid(req.body, datasource);
    if (!validationResult.valid) {
      throw new Error(validationResult.error);
    }

    const metric = postMetricApiPayloadToMetricInterface(
      req.body,
      req.organization,
      datasource
    );

    const createdMetric = await createMetric(metric);

    return {
      metric: toMetricApiInterface(req.organization, createdMetric, datasource),
    };
  }
);
