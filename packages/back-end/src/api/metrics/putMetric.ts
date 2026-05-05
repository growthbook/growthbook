import { putMetricValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resolveOwnerToUserId } from "back-end/src/services/owner";
import { getMetricById, updateMetric } from "back-end/src/models/MetricModel";
import {
  putMetricApiPayloadIsValid,
  putMetricApiPayloadToMetricInterface,
} from "back-end/src/services/experiments";

export const putMetric = createApiRequestHandler(putMetricValidator)(async (
  req,
) => {
  const metric = await getMetricById(req.context, req.params.id);

  if (!metric) {
    throw new Error("Metric not found");
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

  return {
    updatedId: req.params.id,
  };
});
