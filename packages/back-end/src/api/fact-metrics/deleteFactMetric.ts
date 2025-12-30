import { DeleteFactMetricResponse } from "shared/types/openapi";
import { deleteFactMetricValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

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
