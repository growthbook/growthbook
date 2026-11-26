import { z } from "zod";
import {
  apiAddDashboardDraftBlockValidator,
  apiCreateDashboardBody,
  apiCreateDashboardBodyV2,
  apiDashboardDraftBlockReturn,
  apiDashboardDraftReturn,
  apiGetDashboardDraftValidator,
  apiPublishDashboardDraftValidator,
  apiRemoveDashboardDraftBlockValidator,
  apiReplaceDashboardDraftBlockValidator,
  apiUpdateDashboardDraftValidator,
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
  confirmation: ["other.write"] as const,
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

// Held like any other dashboard write for a key that asks to confirm its writes.
const draftEndpoint = {
  version: "v2" as const,
  confirmation: ["other.write"] as const,
};

export const getDashboardDraftEndpoint = {
  ...draftEndpoint,
  pathFragment: "/:id/draft",
  verb: "get" as const,
  operationId: "getDashboardDraft",
  validator: apiGetDashboardDraftValidator,
  zodReturnObject: apiDashboardDraftReturn,
  summary: "Get a dashboard's draft, creating it if there is none",
};

export const updateDashboardDraftEndpoint = {
  ...draftEndpoint,
  pathFragment: "/:id/draft",
  verb: "put" as const,
  operationId: "updateDashboardDraft",
  validator: apiUpdateDashboardDraftValidator,
  zodReturnObject: apiDashboardDraftReturn,
  summary: "Change a draft's title or dashboard-wide controls",
};

export const addDashboardDraftBlockEndpoint = {
  ...draftEndpoint,
  pathFragment: "/:id/draft/blocks",
  verb: "post" as const,
  operationId: "addDashboardDraftBlock",
  validator: apiAddDashboardDraftBlockValidator,
  zodReturnObject: apiDashboardDraftBlockReturn,
  summary: "Add one block to a dashboard's draft",
};

export const replaceDashboardDraftBlockEndpoint = {
  ...draftEndpoint,
  pathFragment: "/:id/draft/blocks/:blockId",
  verb: "put" as const,
  operationId: "replaceDashboardDraftBlock",
  validator: apiReplaceDashboardDraftBlockValidator,
  zodReturnObject: apiDashboardDraftBlockReturn,
  summary: "Replace one block in a dashboard's draft",
};

export const removeDashboardDraftBlockEndpoint = {
  ...draftEndpoint,
  pathFragment: "/:id/draft/blocks/:blockId",
  verb: "delete" as const,
  operationId: "removeDashboardDraftBlock",
  validator: apiRemoveDashboardDraftBlockValidator,
  zodReturnObject: apiDashboardDraftReturn,
  summary: "Remove one block from a dashboard's draft",
};

export const publishDashboardDraftEndpoint = {
  ...draftEndpoint,
  pathFragment: "/:id/draft/publish",
  verb: "post" as const,
  operationId: "publishDashboardDraft",
  validator: apiPublishDashboardDraftValidator,
  zodReturnObject: z.object({ dashboard: apiDashboardInterface }),
  summary: "Publish a dashboard's draft as its next version",
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
  confirmation: {
    create: ["other.write"],
    update: ["other.write"],
    delete: ["other.write"],
  },
  customEndpoints: [
    getDashboardsForExperimentEndpoint,
    createDashboardV2Endpoint,
    getDashboardDraftEndpoint,
    updateDashboardDraftEndpoint,
    addDashboardDraftBlockEndpoint,
    replaceDashboardDraftBlockEndpoint,
    removeDashboardDraftBlockEndpoint,
    publishDashboardDraftEndpoint,
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
