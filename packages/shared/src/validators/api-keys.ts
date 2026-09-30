import { z } from "zod";
import { namedSchema } from "./openapi-helpers";
import { apiAdditionalRoles } from "./members";

// Organization secret keys only: never the key value, PATs, SDK keys or OAuth tokens.
export const apiApiKeyValidator = namedSchema(
  "ApiKey",
  z
    .object({
      id: z.string(),
      description: z.string(),
      role: z.string(),
      limitAccessByEnvironment: z.boolean(),
      environments: z.array(z.string()),
      additionalRoles: apiAdditionalRoles,
      projectRoles: z
        .array(
          z.object({
            project: z.string(),
            role: z.string(),
            limitAccessByEnvironment: z.boolean(),
            environments: z.array(z.string()),
            additionalRoles: apiAdditionalRoles,
          }),
        )
        .optional(),
      disabled: z.boolean(),
      lastUsed: z
        .string()
        .meta({ format: "date-time" })
        .nullable()
        .describe("Null when the key has never been used"),
      dateCreated: z.string().meta({ format: "date-time" }),
    })
    .strict(),
);

const idParams = z
  .object({ id: z.string().describe("The API key id (not the secret)") })
  .strict();

const apiKeyResponse = z.object({ apiKey: apiApiKeyValidator }).strict();

export const listApiKeysValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.object({ apiKeys: z.array(apiApiKeyValidator) }).strict(),
  summary: "Get all organization secret API keys",
  description:
    "Key values are never returned. Personal access tokens and SDK keys are not included.",
  operationId: "listApiKeys",
  tags: ["api-keys"],
  method: "get" as const,
  path: "/api-keys",
};

export const postApiKeyDisableValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: apiKeyResponse,
  summary: "Disable an API key",
  description: "A disabled key is rejected on authentication but not deleted.",
  operationId: "postApiKeyDisable",
  tags: ["api-keys"],
  method: "post" as const,
  path: "/api-keys/:id/disable",
};

export const postApiKeyEnableValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: apiKeyResponse,
  summary: "Re-enable a disabled API key",
  operationId: "postApiKeyEnable",
  tags: ["api-keys"],
  method: "post" as const,
  path: "/api-keys/:id/enable",
};

export const deleteApiKeyValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: idParams,
  responseSchema: z.object({ deletedId: z.string() }).strict(),
  summary: "Delete an API key",
  operationId: "deleteApiKey",
  tags: ["api-keys"],
  method: "delete" as const,
  path: "/api-keys/:id",
};
