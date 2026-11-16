import crypto from "crypto";
import type { OAuthTokenPermissions } from "shared/validators";

/** Prefix for OAuth access tokens returned to clients (stored hashed in apikeys). */
export const OAUTH_ACCESS_TOKEN_PREFIX = "gbo_";

/** Prefix for OAuth refresh tokens (stored hashed in oauthrefreshtokens). */
export const OAUTH_REFRESH_TOKEN_PREFIX = "gbr_";

// The scope an OAuth sign-in's access tokens carry: what consent chose, or for
// a grant from before it asked, its user's own permissions.
export function oauthTokenScope(permissions: OAuthTokenPermissions | null) {
  return {
    role: permissions?.scopedRole || "user",
    scoped: !!permissions?.scopedRole,
    limitAccessByEnvironment: permissions?.limitAccessByEnvironment ?? false,
    environments: permissions?.environments ?? [],
    additionalRoles: permissions?.additionalRoles,
    projectRoles: permissions?.projectRoles,
    confirmRules: permissions?.confirmRules ?? null,
  };
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** RFC 7636 S256: BASE64URL(SHA256(ASCII(code_verifier))) */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  const computed = crypto
    .createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return timingSafeEqualStrings(computed, challenge);
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
