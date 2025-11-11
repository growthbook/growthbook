import { DeleteDashboardResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { deleteDashboardValidator } from "back-end/src/validators/openapi";

export const deleteDashboard = createApiRequestHandler(
  deleteDashboardValidator,
)(async (req): Promise<DeleteDashboardResponse> => {
  const deleted = await req.context.models.dashboards.deleteById(req.params.id);

  return {
    deletedId: deleted?.id,
  };
});
