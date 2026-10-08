import { getOAuthAccessPolicy, isOAuthClientAllowed } from "../src/util/oauth";

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
  it.each([
    ["any", true, true, true],
    ["org-apps", true, false, false],
    ["none", false, false, false],
  ] as const)(
    "under %s allows own org app=%s, another org's app=%s, DCR client=%s",
    (oauthAccess, ownApp, otherOrgApp, dcrClient) => {
      const org = { id: "org-1", settings: { oauthAccess } };
      expect(isOAuthClientAllowed(org, "org-1")).toBe(ownApp);
      expect(isOAuthClientAllowed(org, "org-2")).toBe(otherOrgApp);
      expect(isOAuthClientAllowed(org, null)).toBe(dcrClient);
    },
  );
});
