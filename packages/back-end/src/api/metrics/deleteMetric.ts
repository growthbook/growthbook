import { createApiRequestHandler } from "../../util/handler";
import { getMetricValidator } from "../../validators/openapi";
import { getMetricById, deleteMetricById } from "../../models/MetricModel";
import { DeleteMetricResponse } from "../../../types/openapi";

export const deleteMetricHandler = createApiRequestHandler(getMetricValidator)(
  async (req): Promise<DeleteMetricResponse> => {
    const metric = await getMetricById(req.context, req.params.id, false);

    req.checkPermissions("createMetrics", metric?.projects ?? "");

    if (!metric) {
      throw new Error("Could not find metric with that id");
    }

    await deleteMetricById(metric, req.context);

    return {
      deletedId: req.params.id,
    };
  }
);
