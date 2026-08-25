import crypto from "crypto";

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
  return state?.split(".")[0] ?? "";
}
