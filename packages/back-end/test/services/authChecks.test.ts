import {
  amrIncludesMfa,
  canUseSuperAdmin,
  createNonce,
  deriveAuthChecks,
  getAuthSubjectAction,
  getSignInMethodName,
  isMfaExemptPath,
  isNonceExpired,
  loginMethodOwnsOrg,
  meetsOrgMfaRequirement,
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

describe("amrIncludesMfa", () => {
  it("is true only when the amr array names mfa", () => {
    expect(amrIncludesMfa(["pwd", "mfa"])).toBe(true);
    expect(amrIncludesMfa(["mfa"])).toBe(true);
    expect(amrIncludesMfa(["pwd"])).toBe(false);
    expect(amrIncludesMfa("mfa")).toBe(false);
    expect(amrIncludesMfa(undefined)).toBe(false);
  });
});

describe("meetsOrgMfaRequirement", () => {
  it("only demands MFA from orgs that require it", () => {
    expect(meetsOrgMfaRequirement({}, false)).toBe(true);
    expect(meetsOrgMfaRequirement({ requireMFA: false }, undefined)).toBe(true);
    expect(meetsOrgMfaRequirement({ requireMFA: true }, true)).toBe(true);
    expect(meetsOrgMfaRequirement({ requireMFA: true }, false)).toBe(false);
    expect(meetsOrgMfaRequirement({ requireMFA: true }, undefined)).toBe(false);
  });
});

describe("isMfaExemptPath", () => {
  it("exempts the MFA screen's routes and those that pick their own org", () => {
    expect(isMfaExemptPath("GET", "/user")).toBe(true);
    expect(isMfaExemptPath("POST", "/user/mfa/setup")).toBe(true);
    expect(isMfaExemptPath("POST", "/invite/accept")).toBe(true);
    expect(isMfaExemptPath("GET", "/invite/abc123")).toBe(true);
    expect(isMfaExemptPath("GET", "/oauth/authorize/info")).toBe(true);
    expect(isMfaExemptPath("POST", "/oauth/authorize")).toBe(true);
  });

  it("keeps the selected org's own routes gated", () => {
    expect(isMfaExemptPath("GET", "/user/history")).toBe(false);
    expect(isMfaExemptPath("GET", "/user/mfa")).toBe(false);
    expect(isMfaExemptPath("GET", "/organization")).toBe(false);
    expect(isMfaExemptPath("POST", "/invite")).toBe(false);
    expect(isMfaExemptPath("POST", "/invite/resend")).toBe(false);
    expect(isMfaExemptPath("PUT", "/invite/abc123/role")).toBe(false);
    expect(isMfaExemptPath("DELETE", "/invite")).toBe(false);
    expect(isMfaExemptPath("GET", "/oauth/connected-apps")).toBe(false);
  });
});
