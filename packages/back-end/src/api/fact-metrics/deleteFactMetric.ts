import { DeleteFactMetricResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { deleteFactMetricValidator } from "back-end/src/validators/openapi";

export const deleteFactMetric = createApiRequestHandler(
  deleteFactMetricValidator,
)(async (req): Promise<DeleteFactMetricResponse> => {
  let id = req.params.id;
  // Add `fact__` prefix if it doesn't exist
  if (!id.startsWith("fact__")) {
    id = `fact__${id}`;
  }

  await req.context.models.factMetrics.deleteById(id);

  return {
    deletedId: id,
  };
});
