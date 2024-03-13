import { getMetricValidator } from "@/src/validators/openapi";
import { getMetricById, deleteMetricById } from "@/src/models/MetricModel";
import { DeleteMetricResponse } from "@/types/openapi";
import { createApiRequestHandler } from "@/src/util/handler";

export const deleteMetricHandler = createApiRequestHandler(getMetricValidator)(
  async (req): Promise<DeleteMetricResponse> => {
    const metric = await getMetricById(req.context, req.params.id, false);

    req.checkPermissions("createMetrics", metric?.projects ?? "");

    if (!metric) {
      throw new Error("Could not find metric with that id");
    }

    await deleteMetricById(req.context, metric);

    return {
      deletedId: req.params.id,
    };
  }
);
