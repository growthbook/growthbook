import { createApiRequestHandler } from "../../util/handler";
import { getMetricById, updateMetric } from "../../models/MetricModel";
import { PutMetricResponse } from "../../../types/openapi";
import { putMetricValidator } from "../../validators/openapi";
import {
  putMetricApiPayloadIsValid,
  putMetricApiPayloadToMetricInterface,
} from "../../services/experiments";

export const putMetric = createApiRequestHandler(putMetricValidator)(
  async (req): Promise<PutMetricResponse> => {
    const metric = await getMetricById(req.context, req.params.id);

    if (!metric) {
      throw new Error("Metric not found");
    }

    req.checkPermissions("createMetrics", metric?.projects ?? "");

    const validationResult = putMetricApiPayloadIsValid(req.body);

    if (!validationResult.valid) {
      throw new Error(validationResult.error);
    }

    const updated = putMetricApiPayloadToMetricInterface(req.body);

    await updateMetric(req.context, metric, updated);

    return {
      updatedId: req.params.id,
    };
  }
);
