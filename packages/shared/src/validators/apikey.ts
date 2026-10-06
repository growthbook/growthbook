import { z } from "zod";
import { createBaseSchemaWithPrimaryKey } from "./base-model";
import { projectMemberRole, roleRule } from "./organization";

// How an organization API key handles `X-Requested-By`.
export const requestedByPolicy = z
  .object({
    mode: z.enum(["off", "optional", "required"]),
    limitToRequester: z.boolean(),
  })
  .strict();

export type RequestedByPolicy = z.infer<typeof requestedByPolicy>;

export const DEFAULT_REQUESTED_BY_POLICY: RequestedByPolicy = {
  mode: "optional",
  limitToRequester: false,
};

export const apiKeySchema = createBaseSchemaWithPrimaryKey({
  key: z.string(),
}).safeExtend({
  id: z.string().optional(),
  environment: z.string().optional(),
  project: z.string().optional(),
  description: z.string().optional(),
  userId: z
    .string()
    .optional()
    .describe(
      "If present, the API Key is a Personal Access Token (PAT) for the given user",
    ),
  role: z
    .string()
    .optional()
    .describe(
      "Base role for org API keys. Ignored for PATs (user's role applies)",
    ),
  encryptSDK: z.boolean().optional(),
  encryptionKey: z.string().optional(),
  secret: z
    .boolean()
    .optional()
    .describe(
      "Only false or undefined for legacy SDK Endpoint keys. Always true for API Keys and PATs",
    ),
  limitAccessByEnvironment: z
    .boolean()
    .describe(
      "Org API keys only. When true, restrict access to the listed environments",
    ),
  environments: z
    .array(z.string())
    .describe(
      "Org API keys only. Allowed environments when limitAccessByEnvironment is true",
    ),
  additionalRoles: z
    .array(roleRule)
    .optional()
    .describe(
      "Org API keys only. Extra roles granted alongside the base role, same shape as member additionalRoles",
    ),
  projectRoles: z
    .array(projectMemberRole)
    .optional()
    .describe(
      "Org API keys only. Project-specific role overrides, same shape as member projectRoles",
    ),
  requestedByPolicy: requestedByPolicy
    .optional()
    .describe(
      "Org API keys only. Whether requests may or must name the member who asked with `X-Requested-By`, and whether each request is capped at that member's permissions. Absent means optional and uncapped.",
    ),
  disabled: z
    .boolean()
    .optional()
    .describe(
      "When true, the key is rejected on authentication but not deleted",
    ),
  lastUsed: z
    .date()
    .nullable()
    .optional()
    .describe(
      "Timestamp of the most recent successful authentication. `null` means the key has never been used. `undefined` means the key predates usage tracking.",
    ),
  expiresAt: z
    .date()
    .nullable()
    .optional()
    .describe(
      "When set, the key is rejected after this time. Used by OAuth access tokens. Absent/null for classic API keys and PATs.",
    ),
  oauthClientId: z
    .string()
    .optional()
    .describe(
      "OAuth client that was issued this access token. Absent for classic API keys and PATs.",
    ),
  scopes: z
    .array(z.string())
    .optional()
    .describe(
      "OAuth scopes granted at issuance. Stored for audit; Phase 1 tokens act as the full user (PAT-equivalent).",
    ),
});

export const secretApiKey = apiKeySchema
  .omit({ id: true, secret: true, environment: true, project: true })
  .safeExtend({ id: z.string(), secret: z.literal(true) });

export const secretApiKeyRedacted = secretApiKey.omit({ key: true });
