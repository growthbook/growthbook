import { PostMetricResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { postMetricValidator } from "../../validators/openapi";
import {
  createMetric,
  postMetricApiPayloadIsValid,
  postMetricApiPayloadToMetricInterface,
  toMetricApiInterface,
} from "../../services/experiments";
import { getDataSourceById } from "../../models/DataSourceModel";

export const postMetric = createApiRequestHandler(postMetricValidator)(
  async (req): Promise<PostMetricResponse> => {
    const { datasourceId } = req.body;

    const datasource = await getDataSourceById(req.context, datasourceId);
    if (!datasource) {
      throw new Error(`Invalid data source: ${datasourceId}`);
    }

    const validationResult = postMetricApiPayloadIsValid(req.body, datasource);
    if (!validationResult.valid) {
      throw new Error(validationResult.error);
    }

    const metric = postMetricApiPayloadToMetricInterface(
      req.body,
      req.organization,
      datasource
    );

    if (!req.context.permissions.canCreateMetrics(metric)) {
      req.context.permissions.throwPermissionError();
    }

    const createdMetric = await createMetric(metric);

    return {
      metric: toMetricApiInterface(req.organization, createdMetric, datasource),
    };
  }
);
