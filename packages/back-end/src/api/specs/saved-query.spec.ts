import { z } from "zod";
import {
  apiCreateSavedQueryBody,
  apiCreateSavedQueryValidator,
  apiListSavedQueriesValidator,
  apiRefreshSavedQueryReturn,
  apiRefreshSavedQueryValidator,
  apiSavedQueryReturn,
  apiSavedQueryValidator,
  apiUpdateSavedQueryValidator,
} from "shared/validators";
import { OpenApiModelSpec } from "shared/api-model";

const savedQueryGate =
  "Requires the saved SQL Explorer queries feature and permission to run SQL Explorer queries on the Data Source.";

// Not the default CRUD create, to keep its operationId
export const postSavedQueryEndpoint = {
  pathFragment: "",
  verb: "post" as const,
  confirmation: ["other.write"] as const,
  operationId: "postSavedQuery",
  validator: apiCreateSavedQueryValidator,
  zodReturnObject: apiSavedQueryReturn,
  summary: "Create a saved query",
  description: `${savedQueryGate} Use its id in a Dashboard's SQL Explorer block.`,
  exampleRequest: {
    body: {
      datasourceId: "ds_abc123",
      name: "Signups by day",
      sql: "SELECT date, COUNT(*) AS signups FROM users GROUP BY date",
    },
  },
};

// POST rather than the default CRUD PUT
export const updateSavedQueryEndpoint = {
  pathFragment: "/:id",
  verb: "post" as const,
  confirmation: ["other.write"] as const,
  operationId: "updateSavedQuery",
  validator: apiUpdateSavedQueryValidator,
  zodReturnObject: apiSavedQueryReturn,
  summary: "Update a saved query",
  description: `${savedQueryGate} Changing \`sql\` doesn't re-run it; call the refresh endpoint. Read-only fields from the GET response are accepted and ignored.`,
};

export const refreshSavedQueryEndpoint = {
  pathFragment: "/:id/refresh",
  verb: "post" as const,
  confirmation: ["other.write"] as const,
  operationId: "postSavedQueryRefresh",
  validator: apiRefreshSavedQueryValidator,
  zodReturnObject: apiRefreshSavedQueryReturn,
  summary: "Re-run a saved query",
  description: `${savedQueryGate} A failed run is reported in \`error\` and the previous results are kept.`,
};

export const savedQueryApiSpec = {
  modelSingular: "savedQuery",
  modelPlural: "savedQueries",
  pathBase: "/saved-queries",
  apiInterface: apiSavedQueryValidator,
  schemas: {
    createBody: apiCreateSavedQueryBody,
    // Updates go through the custom POST endpoint, whose body echoes read-only fields
    updateBody: z.object({}),
  },
  crudActions: ["list", "get", "delete"],
  crudValidatorOverrides: {
    list: apiListSavedQueriesValidator,
  },
  confirmation: { delete: ["other.write"] },
  customEndpoints: [
    postSavedQueryEndpoint,
    updateSavedQueryEndpoint,
    refreshSavedQueryEndpoint,
  ],
  tag: "saved-queries",
} satisfies OpenApiModelSpec;
export default savedQueryApiSpec;
