import {
  getOAuthAccessPolicy,
  isOAuthClientAllowed,
  isOrgOAuthAppClientId,
} from "../src/util/oauth";

describe("getOAuthAccessPolicy", () => {
  it("defaults to allowing any client", () => {
    expect(getOAuthAccessPolicy(undefined)).toBe("any");
    expect(getOAuthAccessPolicy({})).toBe("any");
  });

  it("keeps blocking OAuth for orgs that disabled PATs before the setting existed", () => {
    expect(getOAuthAccessPolicy({ disablePersonalAccessTokens: true })).toBe(
      "none",
    );
  });

  it("lets an explicit policy override the PAT kill switch", () => {
    expect(
      getOAuthAccessPolicy({
        disablePersonalAccessTokens: true,
        oauthAccess: "org-apps",
      }),
    ).toBe("org-apps");
    expect(
      getOAuthAccessPolicy({
        disablePersonalAccessTokens: true,
        oauthAccess: "any",
      }),
    ).toBe("any");
  });
});

describe("isOAuthClientAllowed", () => {
  const orgApp = "gbapp_0123456789abcdef";
  const dcrClient = "gbc_0123456789abcdef";

  it("recognizes org app client IDs by prefix", () => {
    expect(isOrgOAuthAppClientId(orgApp)).toBe(true);
    expect(isOrgOAuthAppClientId(dcrClient)).toBe(false);
  });

  it.each([
    ["any", true, true],
    ["org-apps", true, false],
    ["none", false, false],
  ] as const)(
    "under %s allows org apps=%s and DCR clients=%s",
    (oauthAccess, orgAppAllowed, dcrAllowed) => {
      expect(isOAuthClientAllowed({ oauthAccess }, orgApp)).toBe(orgAppAllowed);
      expect(isOAuthClientAllowed({ oauthAccess }, dcrClient)).toBe(dcrAllowed);
    },
  );
});
