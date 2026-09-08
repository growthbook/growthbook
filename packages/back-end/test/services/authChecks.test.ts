import {
  createNonce,
  deriveAuthChecks,
  isNonceExpired,
  nonceFromState,
} from "back-end/src/services/auth/authChecks";

describe("deriveAuthChecks", () => {
  const secret = "browser-secret";

  it("is deterministic, so a callback can recompute what the redirect used", () => {
    const a = deriveAuthChecks(secret, "sso_1", "nonce");
    const b = deriveAuthChecks(secret, "sso_1", "nonce");
    expect(a).toEqual(b);
  });

  it("round-trips the nonce through state", () => {
    const { state } = deriveAuthChecks(secret, "", "abc123");
    expect(nonceFromState(state)).toBe("abc123");
    expect(nonceFromState(undefined)).toBe("");
  });

  it("round-trips a created nonce, which itself contains a dot", () => {
    const nonce = createNonce();
    const { state } = deriveAuthChecks(secret, "sso_1", nonce);
    expect(nonceFromState(state)).toBe(nonce);
    expect(isNonceExpired(nonce)).toBe(false);
  });

  it("expires stale, future, and malformed nonces", () => {
    const twoHours = 2 * 60 * 60 * 1000;
    expect(isNonceExpired(`${(Date.now() - twoHours).toString(36)}.x`)).toBe(
      true,
    );
    expect(isNonceExpired(`${(Date.now() + twoHours).toString(36)}.x`)).toBe(
      true,
    );
    expect(isNonceExpired("")).toBe(true);
    expect(isNonceExpired(".x")).toBe(true);
  });

  it("changes both values with the nonce, connection, and secret", () => {
    const base = deriveAuthChecks(secret, "sso_1", "n1");
    for (const other of [
      deriveAuthChecks(secret, "sso_1", "n2"),
      deriveAuthChecks(secret, "sso_2", "n1"),
      deriveAuthChecks("other-secret", "sso_1", "n1"),
    ]) {
      expect(other.state).not.toBe(base.state);
      expect(other.code_verifier).not.toBe(base.code_verifier);
    }
  });

  it("produces a PKCE-valid code_verifier", () => {
    const { code_verifier } = deriveAuthChecks(secret, "", "n");
    // RFC 7636: 43-128 chars from the unreserved set
    expect(code_verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
  });
});
