import { GetDashboardResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getDashboardValidator } from "back-end/src/validators/openapi";

export const getDashboard = createApiRequestHandler(getDashboardValidator)(
  async (req): Promise<GetDashboardResponse> => {
    const dashboard = await req.context.models.dashboards.getById(
      req.params.id,
    );
    if (!dashboard) {
      throw new Error("Could not find dashboard with that id");
    }

    return {
      dashboard: req.context.models.dashboards.toApiInterface(dashboard),
    };
  },
);
