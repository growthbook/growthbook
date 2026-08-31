import crypto from "crypto";

// AUTH_SECRET lives ~1 year, so the nonce embeds its mint time to keep callbacks from validating indefinitely
const NONCE_TTL_MS = 60 * 60 * 1000;

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
