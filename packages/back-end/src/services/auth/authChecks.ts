import crypto from "crypto";

// AUTH_SECRET lives ~1 year, so the nonce embeds its mint time to keep callbacks from validating indefinitely.
// 24h covers tabs parked on the IdP overnight; anything staler restarts silently client-side.
const NONCE_TTL_MS = 24 * 60 * 60 * 1000;

// A failure the browser can fix by silently starting a fresh login flow
export class RetriableAuthError extends Error {}

export function createNonce(): string {
  return `${Date.now().toString(36)}.${crypto
    .randomBytes(32)
    .toString("base64url")}`;
}

export function isNonceExpired(nonce: string): boolean {
  const ts = parseInt(nonce.split(".")[0], 36);
  return !Number.isFinite(ts) || Math.abs(Date.now() - ts) > NONCE_TTL_MS;
}

// Everything a callback needs is recomputed from the browser secret and the nonce carried in `state`
export function deriveAuthChecks(
  secret: string,
  connectionId: string,
  nonce: string,
) {
  const hmac = (label: string) =>
    crypto
      .createHmac("sha256", secret)
      .update(`${label}:${connectionId}:${nonce}`)
      .digest("base64url");
  return {
    state: `${nonce}.${hmac("state")}`,
    code_verifier: hmac("verifier"),
  };
}

export function nonceFromState(state: string | undefined): string {
  if (!state) return "";
  const i = state.lastIndexOf(".");
  return i > 0 ? state.slice(0, i) : "";
}

// Ranked by how strongly the provider proves email ownership. Unlisted providers rank lowest,
// so one added in Auth0 later can't take over existing accounts until it's ranked here.
const PROVIDERS = new Map([
  ["google-oauth2", { tier: 2, name: "Google" }],
  ["auth0", { tier: 1, name: "email and password" }],
]);

const getProvider = (sub: string) => sub.split("|")[0];
const getTier = (sub: string) => PROVIDERS.get(getProvider(sub))?.tier ?? 0;

// Each user is bound to one identity, so another identity with the same email
// can't share the account. A verified identity from a higher tier replaces it (password -> Google).
export function getAuthSubjectAction(
  bound: string | undefined,
  sub: string,
  verified: boolean,
): "allow" | "bind" | "reject" {
  if (sub === bound) return "allow";
  if (!bound) return verified && sub ? "bind" : "allow";
  return verified && getTier(sub) > getTier(bound) ? "bind" : "reject";
}

export function getSignInMethodName(sub: string): string {
  const provider = getProvider(sub);
  return PROVIDERS.get(provider)?.name ?? provider;
}

// Enterprise SSO and Vercel IdPs vouch for an email only within the org that owns the connection
export function loginMethodOwnsOrg(
  loginMethod: { id?: string; organization?: string },
  org: { id: string; restrictLoginMethod?: string },
): boolean {
  return (
    org.id === loginMethod.organization ||
    (!!loginMethod.id && org.restrictLoginMethod === loginMethod.id)
  );
}

// Super admin needs a login that proves who the user is, not just their email address
export function canUseSuperAdmin({
  orgScopedLogin,
  requireVerified,
  verified,
  authSubject,
  requiredSubPrefix,
}: {
  orgScopedLogin: boolean;
  requireVerified: boolean;
  verified: boolean;
  authSubject: string;
  requiredSubPrefix: string;
}): boolean {
  // A customer's IdP controls both the email and the `sub` in its tokens
  if (orgScopedLogin) return false;
  if (requireVerified && !verified) return false;
  return !requiredSubPrefix || authSubject.startsWith(requiredSubPrefix);
}
