import { z } from "zod";
import {
  apiCreateDashboardBody,
  apiCreateDashboardBodyV2,
  apiDashboardInterface,
  apiGetDashboardsForExperimentReturn,
  apiGetDashboardsForExperimentValidator,
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

export const createDashboardV2Endpoint = {
  pathFragment: "/",
  verb: "post" as const,
  operationId: "createDashboardV2",
  validator: {
    bodySchema: apiCreateDashboardBodyV2,
    querySchema: z.never(),
    paramsSchema: z.never(),
  },
  zodReturnObject: z.object({ dashboard: apiDashboardInterface }),
  summary: "Create a single dashboard",
  version: "v2" as const,
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
    createDashboardV2Endpoint,
  ],
} satisfies OpenApiModelSpec;
export default dashboardApiSpec;
