import { z } from "zod";
import {
  apiCreateDashboardBody,
  apiCreateDashboardBodyV2,
  apiDashboardInterface,
  apiGetDashboardsForExperimentReturn,
  apiGetDashboardsForExperimentValidator,
  apiUpdateDashboardBody,
} from "shared/enterprise";
import { OpenApiModelSpec } from "shared/api-model";

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
  crudDescriptions: {
    create:
      "**Deprecated.** Use [POST /v2/dashboards](#operation/createDashboardV2) instead.\n\nThis endpoint does not accept an `owner` and always assigns the dashboard to the authenticated user. A dashboard created with an organization secret API key, which has no associated user, therefore has no owner. The v2 endpoint accepts an `owner` (userId or email) and requires one when authenticating with an organization secret API key.",
  },
  // Deprecated without a removal date: v1 create stays available for existing
  // integrations, but new ones should use v2.
  crudDeprecations: {
    create: "true",
  },
} satisfies OpenApiModelSpec;
export default dashboardApiSpec;
