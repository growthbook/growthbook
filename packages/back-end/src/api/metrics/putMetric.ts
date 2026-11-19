import { putMetricValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  resolveOwnerEmail,
  resolveOwnerToUserId,
} from "back-end/src/services/owner";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getMetricById, updateMetric } from "back-end/src/models/MetricModel";
import {
  putMetricApiPayloadIsValid,
  putMetricApiPayloadToMetricInterface,
  toMetricApiInterface,
} from "back-end/src/services/experiments";
import { NotFoundError } from "back-end/src/util/errors";

export const putMetric = createApiRequestHandler(putMetricValidator)(async (
  req,
) => {
  const metric = await getMetricById(req.context, req.params.id);

  if (!metric) {
    throw new NotFoundError("Metric not found");
  }

  if (req.body.projects) {
    await req.context.models.projects.ensureProjectsExist(req.body.projects);
  }

  const validationResult = putMetricApiPayloadIsValid(req.body);

  if (!validationResult.valid) {
    throw new Error(validationResult.error);
  }

  const resolvedOwner = await resolveOwnerToUserId(req.body.owner, req.context);
  const updated = putMetricApiPayloadToMetricInterface({
    ...req.body,
    ...(req.body.owner !== undefined && { owner: resolvedOwner ?? "" }),
  });

  await updateMetric(req.context, metric, updated);

  const updatedMetric = await getMetricById(req.context, req.params.id);
  if (!updatedMetric) throw new NotFoundError("Metric not found");
  const datasource = updatedMetric.datasource
    ? await getDataSourceById(req.context, updatedMetric.datasource)
    : null;

  return {
    metric: await resolveOwnerEmail(
      toMetricApiInterface(req.organization, updatedMetric, datasource),
      req.context,
    ),
    updatedId: req.params.id,
  };
});
