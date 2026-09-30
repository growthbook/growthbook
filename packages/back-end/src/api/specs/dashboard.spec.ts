import {
  apiCreateDashboardBody,
  apiDashboardInterface,
  apiGetDashboardsForExperimentReturn,
  apiGetDashboardsForExperimentValidator,
  apiRefreshDashboardReturn,
  apiRefreshDashboardValidator,
  apiUpdateDashboardBody,
} from "shared/enterprise";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

export const getDashboardsForExperimentEndpoint = {
  pathFragment: "/by-experiment/:experimentId",
  verb: "get" as const,
  operationId: "getDashboardsForExperiment",
  validator: apiGetDashboardsForExperimentValidator,
  zodReturnObject: apiGetDashboardsForExperimentReturn,
  summary: "Get all dashboards for an experiment",
};

export const refreshDashboardEndpoint = {
  pathFragment: "/:id/refresh",
  verb: "post" as const,
  operationId: "refreshDashboard",
  validator: apiRefreshDashboardValidator,
  zodReturnObject: apiRefreshDashboardReturn,
  summary: "Refresh a dashboard's results",
  description:
    "Re-runs the experiment snapshots, metric analyses, saved queries and explorations behind its blocks. Queries run in the background; blocks point at the new results right away.",
};

export const dashboardApiSpec = {
  modelSingular: "dashboard",
  modelPlural: "dashboards",
  pathBase: "/dashboards",
  apiInterface: apiDashboardInterface,
  schemas: {
    createBody: apiCreateDashboardBody,
    updateBody: apiUpdateDashboardBody,
  },
  includeDefaultCrud: true,
  customEndpoints: [
    getDashboardsForExperimentEndpoint,
    refreshDashboardEndpoint,
  ],
} satisfies OpenApiModelSpec;
export default dashboardApiSpec;
