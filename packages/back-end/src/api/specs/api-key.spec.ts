import {
  apiApiKeyActionReturn,
  apiApiKeyActionValidator,
  apiApiKeyValidator,
  apiCreateApiKeyBody,
  apiListApiKeysValidator,
  apiUpdateApiKeyBody,
} from "shared/validators";
import { OpenApiModelSpec } from "shared/api-model";

export const disableApiKeyEndpoint = {
  pathFragment: "/:id/disable",
  verb: "post" as const,
  confirmation: ["access.apiKeys"] as const,
  operationId: "postApiKeyDisable",
  validator: apiApiKeyActionValidator,
  zodReturnObject: apiApiKeyActionReturn,
  summary: "Disable an API key",
  description: "A disabled key is rejected on authentication but not deleted.",
};

export const enableApiKeyEndpoint = {
  pathFragment: "/:id/enable",
  verb: "post" as const,
  confirmation: ["access.apiKeys"] as const,
  operationId: "postApiKeyEnable",
  validator: apiApiKeyActionValidator,
  zodReturnObject: apiApiKeyActionReturn,
  summary: "Re-enable a disabled API key",
};

// Organization secret keys only: PATs, SDK keys and OAuth tokens are left out.
export const apiKeyApiSpec = {
  modelSingular: "apiKey",
  modelPlural: "apiKeys",
  pathBase: "/api-keys",
  apiInterface: apiApiKeyValidator,
  schemas: {
    createBody: apiCreateApiKeyBody,
    updateBody: apiUpdateApiKeyBody,
  },
  crudActions: ["list", "delete"],
  crudValidatorOverrides: {
    list: apiListApiKeysValidator,
  },
  crudDescriptions: {
    list: "Key values are never returned. Personal access tokens, SDK keys and keys created before ids existed are not included.",
  },
  confirmation: { delete: ["access.apiKeys"] },
  customEndpoints: [disableApiKeyEndpoint, enableApiKeyEndpoint],
  tag: "api-keys",
} satisfies OpenApiModelSpec;
export default apiKeyApiSpec;
