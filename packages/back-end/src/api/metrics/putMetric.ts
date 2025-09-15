import { createApiRequestHandler } from "back-end/src/util/handler";
import { getMetricById, updateMetric } from "back-end/src/models/MetricModel";
import { PutMetricResponse } from "back-end/types/openapi";
import { putMetricValidator } from "back-end/src/validators/openapi";
import {
  putMetricApiPayloadIsValid,
  putMetricApiPayloadToMetricInterface,
} from "back-end/src/services/experiments";

export const putMetric = createApiRequestHandler(putMetricValidator)(async (
  req,
): Promise<PutMetricResponse> => {
  const metric = await getMetricById(req.context, req.params.id);

  if (!metric) {
    throw new Error("Metric not found");
  }

  if (req.body.projects) {
    await req.context.models.projects.ensureProjectsExist(req.body.projects);
  }

  // If the metric is official, only admins or those with the ManageOfficialResources policy can update it
  if (metric.managedBy === "admin") {
    if (!req.context.permissions.canManageOfficialResources(metric)) {
      req.context.permissions.throwPermissionError();
    }
    // Otherwise, if it's not already official and the user is trying to make it official, they need the ManageOfficialResources policy
  } else {
    if (req.body.managedBy === "admin") {
      if (
        !req.context.permissions.canManageOfficialResources({
          projects: req.body.projects || metric.projects,
        })
      ) {
        req.context.permissions.throwPermissionError();
      }
    }
  }

  const validationResult = putMetricApiPayloadIsValid(req.body);

  if (!validationResult.valid) {
    throw new Error(validationResult.error);
  }

  const updated = putMetricApiPayloadToMetricInterface(req.body);

  if (!req.context.permissions.canUpdateMetric(metric, updated)) {
    req.context.permissions.throwPermissionError();
  }

  await updateMetric(req.context, metric, updated);

  return {
    updatedId: req.params.id,
  };
});
