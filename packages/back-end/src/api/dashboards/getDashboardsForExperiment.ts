import { GetDashboardsForExperimentResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getDashboardsForExperimentValidator } from "back-end/src/validators/openapi";

export const getDashboardsForExperiment = createApiRequestHandler(
  getDashboardsForExperimentValidator,
)(async (req): Promise<GetDashboardsForExperimentResponse> => {
  const dashboards = await req.context.models.dashboards.findByExperiment(
    req.params.experimentId,
  );

  return {
    dashboards: dashboards.map(req.context.models.dashboards.toApiInterface),
  };
});
