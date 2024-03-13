import {
  createMetric,
  postMetricApiPayloadIsValid,
  postMetricApiPayloadToMetricInterface,
  toMetricApiInterface,
} from "@/src/services/experiments";
import { postMetricValidator } from "@/src/validators/openapi";
import { PostMetricResponse } from "@/types/openapi";
import { getDataSourceById } from "@/src/models/DataSourceModel";
import { createApiRequestHandler } from "@/src/util/handler";

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
