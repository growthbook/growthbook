import { PostMetricResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postMetricValidator } from "back-end/src/validators/openapi";
import {
  createMetric,
  postMetricApiPayloadIsValid,
  postMetricApiPayloadToMetricInterface,
  toMetricApiInterface,
} from "back-end/src/services/experiments";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";

export const postMetric = createApiRequestHandler(postMetricValidator)(async (
  req,
): Promise<PostMetricResponse> => {
  const { datasourceId, projects } = req.body;

  const datasource = await getDataSourceById(req.context, datasourceId);
  if (!datasource) {
    throw new Error(`Invalid data source: ${datasourceId}`);
  }

  if (projects) {
    await req.context.models.projects.ensureProjectsExist(projects);
  }

  const validationResult = postMetricApiPayloadIsValid(req.body, datasource);
  if (!validationResult.valid) {
    throw new Error(validationResult.error);
  }

  const metric = postMetricApiPayloadToMetricInterface(
    req.body,
    req.organization,
    datasource,
  );

  if (!req.context.permissions.canCreateMetric(metric)) {
    req.context.permissions.throwPermissionError();
  }

  const createdMetric = await createMetric(metric);

  return {
    metric: toMetricApiInterface(req.organization, createdMetric, datasource),
  };
});
