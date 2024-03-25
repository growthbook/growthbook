import {
  putMetricApiPayloadIsValid,
  putMetricApiPayloadToMetricInterface,
} from "@back-end/src/services/experiments";
import { putMetricValidator } from "@back-end/src/validators/openapi";
import { getMetricById, updateMetric } from "@back-end/src/models/MetricModel";
import { PutMetricResponse } from "@back-end/types/openapi";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const putMetric = createApiRequestHandler(putMetricValidator)(
  async (req): Promise<PutMetricResponse> => {
    const metric = await getMetricById(req.context, req.params.id);

    if (!metric) {
      throw new Error("Metric not found");
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
  }
);
