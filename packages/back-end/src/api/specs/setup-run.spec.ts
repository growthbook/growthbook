import { z } from "zod";
import {
  apiSetupRunInterface,
  apiCreateSetupRunBody,
  apiUpdateSetupRunBody,
  apiAppendSetupRunArtifactBody,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

export const appendSetupRunArtifactEndpoint = {
  pathFragment: "/:id/artifacts",
  verb: "post" as const,
  operationId: "appendSetupRunArtifact",
  validator: {
    bodySchema: apiAppendSetupRunArtifactBody,
    querySchema: z.never(),
    paramsSchema: z.object({ id: z.string() }).strict(),
  },
  zodReturnObject: apiSetupRunInterface,
  summary: "Record something a setup run created",
};

export const setupRunApiSpec = {
  modelSingular: "setupRun",
  modelPlural: "setupRuns",
  pathBase: "/setup-runs",
  apiInterface: apiSetupRunInterface,
  schemas: {
    createBody: apiCreateSetupRunBody,
    updateBody: apiUpdateSetupRunBody,
  },
  includeDefaultCrud: false,
  crudActions: ["create", "get", "update", "list"],
  customEndpoints: [appendSetupRunArtifactEndpoint],
} satisfies OpenApiModelSpec;

export default setupRunApiSpec;
