import { stringToBoolean } from "shared/util";
import { ListDashboardsResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { listDashboardsValidator } from "back-end/src/validators/openapi";

export const listDashboards = createApiRequestHandler(listDashboardsValidator)(
  async (req): Promise<ListDashboardsResponse> => {
    const dashboards = await req.context.models.dashboards.getAll(
      stringToBoolean(req.query.includeExperimentDashboards)
        ? {}
        : { experimentId: null },
    );

    return {
      dashboards: dashboards.map(req.context.models.dashboards.toApiInterface),
    };
  },
);
