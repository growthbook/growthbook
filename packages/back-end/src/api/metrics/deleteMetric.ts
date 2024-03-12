import { createApiRequestHandler } from "../../util/handler";
import { getMetricValidator } from "../../validators/openapi";
import { getMetricById, deleteMetricById } from "../../models/MetricModel";
import { DeleteMetricResponse } from "../../../types/openapi";

export const deleteMetricHandler = createApiRequestHandler(getMetricValidator)(
  async (req): Promise<DeleteMetricResponse> => {
    const {
      canCreateMetrics,
      throwPermissionError,
    } = req.context.permissionsUtil;
    const metric = await getMetricById(req.context, req.params.id, false);

    if (!metric) {
      throw new Error("Could not find metric with that id");
    }

    if (!canCreateMetrics(metric)) {
      throwPermissionError("createMetrics");
    }

    await deleteMetricById(req.context, metric);

    return {
      deletedId: req.params.id,
    };
  }
);
