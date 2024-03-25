import { getMetricValidator } from "@back-end/src/validators/openapi";
import {
  getMetricById,
  deleteMetricById,
} from "@back-end/src/models/MetricModel";
import { DeleteMetricResponse } from "@back-end/types/openapi";
import { createApiRequestHandler } from "@back-end/src/util/handler";

export const deleteMetricHandler = createApiRequestHandler(getMetricValidator)(
  async (req): Promise<DeleteMetricResponse> => {
    const metric = await getMetricById(req.context, req.params.id, false);

    if (!metric) {
      throw new Error("Could not find metric with that id");
    }

    if (!req.context.permissions.canDeleteMetric(metric)) {
      req.context.permissions.throwPermissionError();
    }

    await deleteMetricById(req.context, metric);

    return {
      deletedId: req.params.id,
    };
  }
);
