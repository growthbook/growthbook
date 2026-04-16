import { postMetricValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resolveOwnerToUserId } from "back-end/src/services/owner";
import {
  createMetric,
  postMetricApiPayloadIsValid,
  postMetricApiPayloadToMetricInterface,
  toMetricApiInterface,
} from "back-end/src/services/experiments";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";

export const postMetric = createApiRequestHandler(postMetricValidator)(async (
  req,
) => {
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

  const resolvedOwner = await resolveOwnerToUserId(req.body.owner, req.context);
  const metric = postMetricApiPayloadToMetricInterface(
    {
      ...req.body,
      ...(resolvedOwner !== undefined && { owner: resolvedOwner }),
    },
    req.organization,
    datasource,
  );

  const createdMetric = await createMetric(req.context, metric);

  return {
    metric: toMetricApiInterface(req.organization, createdMetric, datasource),
  };
});
