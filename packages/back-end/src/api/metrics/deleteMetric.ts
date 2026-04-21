import { deleteMetricValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  getMetricById,
  deleteMetricById,
} from "back-end/src/models/MetricModel";

export const deleteMetricHandler = createApiRequestHandler(
  deleteMetricValidator,
)(async (req) => {
  const metric = await getMetricById(req.context, req.params.id, false);

  if (!metric) {
    throw new Error("Could not find metric with that id");
  }

  await deleteMetricById(req.context, metric);

  return {
    deletedId: req.params.id,
  };
});
