import { z } from "zod";
import { createBaseSchemaWithPrimaryKey } from "./base-model";

/** Public OAuth clients registered via DCR (RFC 7591). No org scoping. */
export const oauthClientValidator = z
  .object({
    clientId: z.string(),
    clientName: z.string().optional(),
    redirectUris: z.array(z.string()).min(1),
    tokenEndpointAuthMethod: z.literal("none"),
    grantTypes: z.array(z.string()),
    responseTypes: z.array(z.string()),
    scope: z.string().optional(),
    clientUri: z.string().optional(),
    dateCreated: z.date(),
  })
  .strict();

export type OAuthClientInterface = z.infer<typeof oauthClientValidator>;

/**
 * Short-lived authorization codes. Primary key is the hashed code
 * (`codeHash`); globally unique so the public token endpoint can look up a
 * code before it knows the organization.
 */
export const oauthAuthCodeValidator = createBaseSchemaWithPrimaryKey({
  codeHash: z.string(),
}).safeExtend({
  id: z.string().optional(),
  clientId: z.string(),
  userId: z.string(),
  redirectUri: z.string(),
  codeChallenge: z.string(),
  codeChallengeMethod: z.literal("S256"),
  scope: z.string().optional(),
  resource: z.string().optional(),
  used: z.boolean(),
  expiresAt: z.date(),
});

export type OAuthAuthCodeInterface = z.infer<typeof oauthAuthCodeValidator>;

/**
 * Rotating refresh tokens. Primary key is the hashed token (`tokenHash`);
 * globally unique for the same bootstrap-before-org reason as auth codes.
 */
export const oauthRefreshTokenValidator = createBaseSchemaWithPrimaryKey({
  tokenHash: z.string(),
}).safeExtend({
  id: z.string().optional(),
  clientId: z.string(),
  userId: z.string(),
  scope: z.string().optional(),
  resource: z.string().optional(),
  expiresAt: z.date(),
});

export type OAuthRefreshTokenInterface = z.infer<
  typeof oauthRefreshTokenValidator
>;

/** RFC 7591 registration request body (public MCP clients).
 * Not `.strict()` — clients (e.g. Cursor) send optional metadata like logo_uri.
 * Unknown keys are stripped; only fields we care about are kept.
 */
export const oauthDcrRequestValidator = z.object({
  redirect_uris: z.array(z.string().url()).min(1),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  client_name: z.string().optional(),
  client_uri: z.string().url().optional().or(z.literal("")),
  logo_uri: z.string().url().optional().or(z.literal("")),
  tos_uri: z.string().url().optional().or(z.literal("")),
  policy_uri: z.string().url().optional().or(z.literal("")),
  scope: z.string().optional(),
  contacts: z.array(z.string()).optional(),
});

export type OAuthDcrRequest = z.infer<typeof oauthDcrRequestValidator>;
