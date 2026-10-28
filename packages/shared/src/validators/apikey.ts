import { z } from "zod";
import { createBaseSchemaWithPrimaryKey } from "./base-model";
import {
  DUPLICATE_PROJECT_ROLES_MESSAGE,
  hasNoDuplicateProjects,
  projectMemberRole,
  roleRule,
} from "./organization";
import { confirmRulesValidator } from "./confirmations";
import { apiPaginationFieldsValidator, paginationQueryFields } from "./shared";
import { namedSchema } from "./openapi-helpers";

// Who an org key's requests act as: itself, or the member a request names.
export const actAsValidator = z.enum(["system", "user"]);

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
      "Base role for org API keys. For scoped PATs, the role the token is capped at; ignored for other PATs (user's role applies)",
    ),
  scoped: z
    .boolean()
    .optional()
    .describe(
      "PATs only. When true, the token's access is the intersection of its user's permissions and this key's role, environment and project settings",
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
      "Org API keys and scoped PATs. When true, restrict access to the listed environments",
    ),
  environments: z
    .array(z.string())
    .describe(
      "Org API keys and scoped PATs. Allowed environments when limitAccessByEnvironment is true",
    ),
  additionalRoles: z
    .array(roleRule)
    .optional()
    .describe(
      "Org API keys and scoped PATs. Extra roles granted alongside the base role, same shape as member additionalRoles",
    ),
  projectRoles: z
    .array(projectMemberRole)
    .optional()
    .describe(
      "Org API keys and scoped PATs. Project-specific role overrides, same shape as member projectRoles",
    ),
  actAs: actAsValidator
    .optional()
    .describe(
      "Org API keys only. `system` (default): requests act as the key, and a member named with `X-GrowthBook-Requested-By` is only recorded. `user`: every request must name a member with that header and acts as them, within the key's role",
    ),
  disabled: z
    .boolean()
    .optional()
    .describe(
      "When true, the key is rejected on authentication but not deleted",
    ),
  disabledBy: z
    .string()
    .nullable()
    .optional()
    .describe(
      "User who set `disabled`. A member can undo their own disable but not an admin's.",
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
  expirationNotice: z
    .enum(["expiring", "expired"])
    .nullable()
    .optional()
    .describe(
      "Furthest expiration event already emitted for this key, so the sweep notifies once per stage. Cleared if the expiration is pushed back out.",
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
  confirmRules: confirmRulesValidator
    .nullable()
    .optional()
    .describe(
      "Actions this key can't complete until a person confirms them. Null or absent means off.",
    ),
  keyIssuedAt: z
    .date()
    .optional()
    .describe(
      "When the current secret was issued. Absent means `dateCreated`; set on rotation, and the expiration policy's maximum lifetime runs from it.",
    ),
  previousKey: z
    .string()
    .optional()
    .describe(
      "The secret a rotation replaced, still accepted until `previousKeyExpiresAt`.",
    ),
  previousKeyExpiresAt: z
    .date()
    .nullable()
    .optional()
    .describe("When `previousKey` stops being accepted."),
  previousKeyLastUsed: z
    .date()
    .nullable()
    .optional()
    .describe(
      "Most recent authentication with `previousKey`. `null` means it hasn't been used since the rotation.",
    ),
});

export const secretApiKey = apiKeySchema
  .omit({ id: true, secret: true, environment: true, project: true })
  .safeExtend({ id: z.string(), secret: z.literal(true) });

export const secretApiKeyRedacted = secretApiKey.omit({
  key: true,
  previousKey: true,
});

const apiProjectRoleRule = roleRule.safeExtend({
  project: z.string(),
  additionalRoles: z.array(roleRule).optional(),
});

export const apiApiKeyValidator = namedSchema(
  "ApiKey",
  z.strictObject({
    id: z
      .string()
      .describe(
        "Empty for a key created before keys had ids. Such a key is listed but can't be fetched or changed by id.",
      ),
    type: z
      .enum(["organization", "personal"])
      .describe(
        "`organization` for a secret API key, `personal` for a personal access token",
      ),
    description: z.string(),
    userId: z
      .string()
      .optional()
      .describe("Personal access tokens only. The member who owns the token."),
    userEmail: z
      .string()
      .optional()
      .describe(
        "Personal access tokens only. Absent once the owner leaves the organization.",
      ),
    scoped: z
      .boolean()
      .optional()
      .describe(
        "Personal access tokens only. When true, the token is limited to its role as well as its owner's permissions.",
      ),
    role: z
      .string()
      .optional()
      .describe("Absent for an unscoped personal access token"),
    limitAccessByEnvironment: z.boolean(),
    environments: z.array(z.string()),
    additionalRoles: z.array(roleRule).optional(),
    projectRoles: z.array(apiProjectRoleRule).optional(),
    actAs: actAsValidator
      .optional()
      .describe(
        "Organization keys only. `system`: requests act as the key. `user`: every request names a member with `X-GrowthBook-Requested-By` and acts as them, within the key's role.",
      ),
    disabled: z.boolean(),
    disabledBy: z.string().optional(),
    dateCreated: z.string().meta({ format: "date-time" }).optional(),
    dateUpdated: z.string().meta({ format: "date-time" }).optional(),
    lastUsed: z
      .string()
      .meta({ format: "date-time" })
      .nullable()
      .describe(
        "Last authentication with the key, including refused requests. Null if never used.",
      ),
    expiresAt: z
      .string()
      .meta({ format: "date-time" })
      .nullable()
      .describe("Null if the key does not expire"),
  }),
);
export type ApiApiKey = z.infer<typeof apiApiKeyValidator>;

const apiKeyIdParams = z.strictObject({
  id: z.string().describe("The id of the API key or personal access token"),
});

export const listApiKeysValidator = {
  method: "get" as const,
  path: "/api-keys",
  operationId: "listApiKeys",
  summary: "Get all API keys",
  description:
    "Lists the secret API keys and personal access tokens the caller can see, without their values. Needs permission to view API keys. Other members' personal access tokens are only listed with permission to manage members' tokens.",
  tags: ["api-keys"],
  paramsSchema: z.never(),
  bodySchema: z.never(),
  querySchema: z.strictObject({
    ...paginationQueryFields,
    type: z
      .enum(["organization", "personal"])
      .optional()
      .describe("Only organization keys or only personal access tokens"),
    userId: z
      .string()
      .optional()
      .describe("Only personal access tokens owned by this member"),
  }),
  responseSchema: z.intersection(
    z.object({ apiKeys: z.array(apiApiKeyValidator) }),
    apiPaginationFieldsValidator,
  ),
};

export const getApiKeyValidator = {
  method: "get" as const,
  path: "/api-keys/:id",
  operationId: "getApiKey",
  summary: "Get a single API key",
  description:
    "Looks up a secret API key or personal access token by id, without its value. Needs permission to view API keys. Another member's personal access token is a 404 without permission to manage members' tokens.",
  tags: ["api-keys"],
  paramsSchema: apiKeyIdParams,
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: z.strictObject({ apiKey: apiApiKeyValidator }),
};

export const putApiKeyRolesValidator = {
  method: "put" as const,
  path: "/api-keys/:id/roles",
  operationId: "putApiKeyRoles",
  summary: "Replace an API key's roles",
  description:
    "Replaces an organization API key's roles and environment limits with the body. The key's value, description, expiry and disabled state are left alone. Needs permission to edit and create API keys. A personal access token id is a 400, or a 404 when it's another member's token the caller can't read. A key can't change its own roles, and can't grant `admin`, or a role that can manage members, custom roles, API keys, organization settings or Projects. These refusals are checked before comparing with the key, so a body naming one is refused even when the key already has it (for example, an existing admin key).",
  tags: ["api-keys"],
  confirmation: ["access.apiKeys"] as const,
  confirmationInHandler: true,
  paramsSchema: apiKeyIdParams,
  bodySchema: z.strictObject({
    role: z.string().min(1),
    limitAccessByEnvironment: z.boolean(),
    environments: z
      .array(z.string())
      .describe("Each id must exist, even when the limit is off"),
    additionalRoles: z.array(roleRule).describe("`[]` for none"),
    projectRoles: z
      .array(apiProjectRoleRule)
      .refine(hasNoDuplicateProjects, {
        message: DUPLICATE_PROJECT_ROLES_MESSAGE,
      })
      .describe("`[]` for none. At most one rule per Project."),
    actAs: actAsValidator
      .optional()
      .describe("Leave out to keep the key's current setting"),
    dryRun: z
      .boolean()
      .optional()
      .describe("Run every check and return the result without saving it"),
  }),
  querySchema: z.never(),
  responseSchema: z.strictObject({
    apiKey: apiApiKeyValidator,
    changed: z
      .boolean()
      .describe(
        "False when the key already had these roles. With `dryRun`, whether saving would change it.",
      ),
  }),
};
