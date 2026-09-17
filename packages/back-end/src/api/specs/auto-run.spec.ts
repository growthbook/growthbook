import { z } from "zod";
import {
  apiAutoRunInterface,
  apiCreateAutoRunBody,
  apiUpdateAutoRunBody,
  apiAppendAutoRunArtifactBody,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

export const appendAutoRunArtifactEndpoint = {
  pathFragment: "/:id/artifacts",
  verb: "post" as const,
  operationId: "appendAutoRunArtifact",
  validator: {
    bodySchema: apiAppendAutoRunArtifactBody,
    querySchema: z.never(),
    paramsSchema: z.object({ id: z.string() }).strict(),
  },
  zodReturnObject: apiAutoRunInterface,
  summary: "Record something an auto run created",
};

export const autoRunApiSpec = {
  modelSingular: "autoRun",
  modelPlural: "autoRuns",
  pathBase: "/auto-runs",
  apiInterface: apiAutoRunInterface,
  schemas: {
    createBody: apiCreateAutoRunBody,
    updateBody: apiUpdateAutoRunBody,
  },
  includeDefaultCrud: false,
  crudActions: ["create", "get", "update", "list"],
  customEndpoints: [appendAutoRunArtifactEndpoint],
} satisfies OpenApiModelSpec;

export default autoRunApiSpec;
