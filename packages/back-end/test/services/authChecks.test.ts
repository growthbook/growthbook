import {
  canUseSuperAdmin,
  createNonce,
  deriveAuthChecks,
  getAuthSubjectAction,
  getSignInMethodName,
  isNonceExpired,
  loginMethodOwnsOrg,
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
    const twentyThreeHours = 23 * 60 * 60 * 1000;
    const twentyFiveHours = 25 * 60 * 60 * 1000;
    expect(
      isNonceExpired(`${(Date.now() - twentyThreeHours).toString(36)}.x`),
    ).toBe(false);
    expect(
      isNonceExpired(`${(Date.now() - twentyFiveHours).toString(36)}.x`),
    ).toBe(true);
    expect(
      isNonceExpired(`${(Date.now() + twentyFiveHours).toString(36)}.x`),
    ).toBe(true);
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

describe("getAuthSubjectAction", () => {
  const google = "google-oauth2|111";
  const password = "auth0|aaa";

  it("binds the first verified identity and lets unverified ones through to the verified-email guard", () => {
    expect(getAuthSubjectAction(undefined, google, true)).toBe("bind");
    expect(getAuthSubjectAction("", password, true)).toBe("bind");
    expect(getAuthSubjectAction(undefined, password, false)).toBe("allow");
    expect(getAuthSubjectAction(undefined, "", true)).toBe("allow");
  });

  it("allows the bound identity", () => {
    expect(getAuthSubjectAction(google, google, true)).toBe("allow");
  });

  it("rejects a password identity on a Google account, verified or not", () => {
    expect(getAuthSubjectAction(google, password, true)).toBe("reject");
    expect(getAuthSubjectAction(google, password, false)).toBe("reject");
  });

  it("upgrades a password account to a verified Google identity", () => {
    expect(getAuthSubjectAction(password, google, true)).toBe("bind");
    expect(getAuthSubjectAction(password, google, false)).toBe("reject");
  });

  it("rejects a different identity from the same tier", () => {
    expect(getAuthSubjectAction(google, "google-oauth2|222", true)).toBe(
      "reject",
    );
    expect(getAuthSubjectAction(password, "auth0|bbb", true)).toBe("reject");
  });

  it("ranks unlisted providers lowest", () => {
    expect(getAuthSubjectAction(password, "windowslive|x", true)).toBe(
      "reject",
    );
    expect(getAuthSubjectAction(google, "", true)).toBe("reject");
  });
});

describe("getSignInMethodName", () => {
  it("names known providers and falls back to the provider id", () => {
    expect(getSignInMethodName("google-oauth2|111")).toBe("Google");
    expect(getSignInMethodName("auth0|aaa")).toBe("email and password");
    expect(getSignInMethodName("github|1")).toBe("github");
    expect(getSignInMethodName("constructor|1")).toBe("constructor");
  });
});

describe("loginMethodOwnsOrg", () => {
  const sso = { id: "sso_acme", organization: "org_acme" };
  const vercel = { id: "vercel:icfg_1" };

  it("allows an Enterprise SSO connection into its own org only", () => {
    expect(loginMethodOwnsOrg(sso, { id: "org_acme" })).toBe(true);
    expect(loginMethodOwnsOrg(sso, { id: "org_personal" })).toBe(false);
  });

  it("allows a Vercel login into its installation's org only", () => {
    expect(
      loginMethodOwnsOrg(vercel, {
        id: "org_v",
        restrictLoginMethod: "vercel:icfg_1",
      }),
    ).toBe(true);
    expect(loginMethodOwnsOrg(vercel, { id: "org_personal" })).toBe(false);
    expect(
      loginMethodOwnsOrg(vercel, {
        id: "org_other_v",
        restrictLoginMethod: "vercel:icfg_2",
      }),
    ).toBe(false);
  });

  it("doesn't match orgs on missing ids", () => {
    expect(loginMethodOwnsOrg({}, { id: "org_x" })).toBe(false);
    expect(
      loginMethodOwnsOrg({ id: "" }, { id: "org_x", restrictLoginMethod: "" }),
    ).toBe(false);
  });
});

describe("canUseSuperAdmin", () => {
  const cloudGoogle = {
    orgScopedLogin: false,
    requireVerified: true,
    verified: true,
    authSubject: "google-oauth2|111",
    requiredSubPrefix: "google-oauth2|",
  };

  it("allows a verified Google login on Cloud", () => {
    expect(canUseSuperAdmin(cloudGoogle)).toBe(true);
  });

  it("never allows Enterprise SSO or Vercel logins, even with a matching sub", () => {
    expect(canUseSuperAdmin({ ...cloudGoogle, orgScopedLogin: true })).toBe(
      false,
    );
  });

  it("requires a verified token when asked", () => {
    expect(canUseSuperAdmin({ ...cloudGoogle, verified: false })).toBe(false);
  });

  it("requires the sub prefix when one is set", () => {
    expect(canUseSuperAdmin({ ...cloudGoogle, authSubject: "auth0|aaa" })).toBe(
      false,
    );
    expect(canUseSuperAdmin({ ...cloudGoogle, authSubject: "" })).toBe(false);
  });

  it("leaves self-hosted logins alone (never verified, no prefix)", () => {
    expect(
      canUseSuperAdmin({
        orgScopedLogin: false,
        requireVerified: false,
        verified: false,
        authSubject: "u_123",
        requiredSubPrefix: "",
      }),
    ).toBe(true);
  });
});
