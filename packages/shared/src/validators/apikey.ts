import { z } from "zod";
import { createBaseSchemaWithPrimaryKey } from "./base-model";
import { projectMemberRole } from "./organization";

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
  projectRoles: z
    .array(projectMemberRole)
    .optional()
    .describe(
      "Org API keys only. Project-specific role overrides, same shape as member projectRoles",
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
});

export const secretApiKey = apiKeySchema
  .omit({ id: true, secret: true, environment: true, project: true })
  .safeExtend({ id: z.string(), secret: z.literal(true) });

export const secretApiKeyRedacted = secretApiKey.omit({ key: true });
