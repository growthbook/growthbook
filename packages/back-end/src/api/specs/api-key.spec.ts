import { z } from "zod";
import {
  apiApiKeyValidator,
  getApiKeyResponse,
  getApiKeyValidator,
  listApiKeysResponse,
  listApiKeysValidator,
  putApiKeyRolesResponse,
  putApiKeyRolesValidator,
} from "shared/validators";
import { OpenApiModelSpec } from "shared/api-model";

// Custom endpoints rather than default CRUD: the list is paginated and
// filtered, and keys are never created, updated or deleted here.
export const listApiKeysEndpoint = {
  pathFragment: "",
  verb: "get" as const,
  operationId: "listApiKeys",
  validator: listApiKeysValidator,
  zodReturnObject: listApiKeysResponse,
  summary: "Get all API keys",
  description:
    "Lists the secret API keys and personal access tokens the caller can see, without their values. Needs permission to view API keys. Other members' personal access tokens are only listed with permission to manage members' tokens.",
};

export const getApiKeyEndpoint = {
  pathFragment: "/:id",
  verb: "get" as const,
  operationId: "getApiKey",
  validator: getApiKeyValidator,
  zodReturnObject: getApiKeyResponse,
  summary: "Get a single API key",
  description:
    "Looks up a secret API key or personal access token by id, without its value. Needs permission to view API keys. Another member's personal access token is a 404 without permission to manage members' tokens.",
};

export const putApiKeyRolesEndpoint = {
  pathFragment: "/:id/roles",
  verb: "put" as const,
  operationId: "putApiKeyRoles",
  validator: putApiKeyRolesValidator,
  zodReturnObject: putApiKeyRolesResponse,
  summary: "Replace an API key's roles",
  description:
    "Replaces an organization API key's roles and environment limits with the body. The key's value, description, expiry and disabled state are left alone. Needs permission to edit and create API keys. A personal access token id is a 400, or a 404 when it's another member's token the caller can't read. A key can't change its own roles, and can't grant `admin`, or a role that can manage members, custom roles, API keys, organization settings or Projects. These refusals are checked before comparing with the key, so a body naming one is refused even when the key already has it (for example, an existing admin key). A key changed or deleted while the request runs is a 409 or 404, and nothing is saved.",
  confirmation: ["access.apiKeys"] as const,
  confirmationInHandler: true,
};

export const apiKeyApiSpec = {
  modelSingular: "apiKey",
  modelPlural: "apiKeys",
  pathBase: "/api-keys",
  tag: "api-keys",
  apiInterface: apiApiKeyValidator,
  schemas: {
    createBody: z.never(),
    updateBody: z.never(),
  },
  crudActions: [],
  customEndpoints: [
    listApiKeysEndpoint,
    getApiKeyEndpoint,
    putApiKeyRolesEndpoint,
  ],
} satisfies OpenApiModelSpec;
export default apiKeyApiSpec;
