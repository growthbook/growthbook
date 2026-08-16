import { z } from "zod";
// Import directly (not via the shared/util barrel) to avoid a circular
// dependency at module evaluation time
import { SSO_IDP_TYPES } from "../util/sso-connection";

const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://"), {
    message: "Must be an https:// URL",
  });

// Metadata for a generic OpenID Connect provider. Mirrors the required keys
// checked by getSSOConfig() in shared/src/enterprise/sso.ts
export const ssoConnectionMetadataValidator = z
  .object({
    issuer: httpsUrl,
    authorization_endpoint: httpsUrl,
    token_endpoint: httpsUrl,
    jwks_uri: httpsUrl,
    id_token_signing_alg_values_supported: z.array(z.string()).min(1),
    code_challenge_methods_supported: z.array(z.string()).optional(),
    logout_endpoint: httpsUrl.optional(),
    audience: z.string().optional(),
  })
  .passthrough()
  // Also require https on any extra endpoints allowed through by passthrough
  .superRefine((obj, ctx) => {
    Object.entries(obj).forEach(([key, value]) => {
      if (typeof value === "string" && value.startsWith("http://")) {
        ctx.addIssue({
          code: "custom",
          message: "Must be an https:// URL",
          path: [key],
        });
      }
    });
  });

export const putSSOConnectionBodyValidator = z
  .object({
    idpType: z.enum(SSO_IDP_TYPES),
    clientId: z.string().min(1),
    // An empty string means "keep the existing client secret"
    clientSecret: z.string(),
    // Required for okta and onelogin
    baseURL: httpsUrl.optional(),
    // Required for azure and auth0
    tenantId: z
      .string()
      .regex(/^[a-zA-Z0-9._-]+$/)
      .optional(),
    audience: z.string().optional(),
    // The fields below are only used when idpType is "oidc";
    // other providers have them generated server-side
    additionalScope: z.string().optional(),
    metadata: ssoConnectionMetadataValidator.optional(),
    extraQueryParams: z.record(z.string(), z.string()).optional(),
    // Deprecated in favor of POST /sso-connection/enforce; when omitted, the
    // enforcement setting is left unchanged
    enforceSSO: z.boolean().optional(),
  })
  .strict();

export type PutSSOConnectionBody = z.infer<
  typeof putSSOConnectionBodyValidator
>;

export const postSSOConnectionEnforceBodyValidator = z
  .object({
    enforce: z.boolean(),
  })
  .strict();

export type PostSSOConnectionEnforceBody = z.infer<
  typeof postSSOConnectionEnforceBodyValidator
>;
