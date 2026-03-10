import { getMetricValidator } from "shared/validators";
import { DeleteMetricResponse } from "shared/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  getMetricById,
  deleteMetricById,
} from "back-end/src/models/MetricModel";

export const deleteMetricHandler = createApiRequestHandler(getMetricValidator)(
  async (req): Promise<DeleteMetricResponse> => {
    const metric = await getMetricById(req.context, req.params.id, false);

    if (!metric) {
      throw new Error("Could not find metric with that id");
    }

    await deleteMetricById(req.context, metric);

    return {
      deletedId: req.params.id,
    };
  },
);
