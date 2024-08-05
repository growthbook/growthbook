import { putMetricValidator } from "back-end/src/validators/openapi";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getMetricById, updateMetric } from "back-end/src/models/MetricModel";
import { PutMetricResponse } from "back-end/types/openapi";
import {
  putMetricApiPayloadIsValid,
  putMetricApiPayloadToMetricInterface,
} from "back-end/src/services/experiments";

export const putMetric = createApiRequestHandler(putMetricValidator)(
  async (req): Promise<PutMetricResponse> => {
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

    const updated = putMetricApiPayloadToMetricInterface(req.body);

    if (!req.context.permissions.canUpdateMetric(metric, updated)) {
      req.context.permissions.throwPermissionError();
    }

    await updateMetric(req.context, metric, updated);

    if (updated.id !== undefined) {
      await req.audit({
        event: "metric.update",
        entity: {
          object: "metric",
          id: updated.id,
        },
        details: auditDetailsUpdate(metric, updated, {}),
      });
    }

    return {
      updatedId: req.params.id,
    };
  }
);
