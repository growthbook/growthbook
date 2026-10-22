import {
  apiKeyToggleRequiresAdmin,
  canApplyExpirationPolicy,
  canManageApiKeySecret,
  canSetApiKeyDisabled,
  changesApiKeyAuthority,
} from "../../src/permissions/apiKeyAuthority";
import { Policy, permissionsFromRole } from "../../src/permissions";

describe("apiKeyToggleRequiresAdmin", () => {
  it("never requires admin for org keys", () => {
    expect(
      apiKeyToggleRequiresAdmin(
        { userId: undefined, disabled: true, disabledBy: "u_admin" },
        "u_1",
      ),
    ).toBe(false);
  });

  it("requires admin to toggle another member's PAT", () => {
    expect(
      apiKeyToggleRequiresAdmin({ userId: "u_owner", disabled: false }, "u_1"),
    ).toBe(true);
  });

  it("lets the owner toggle their own PAT", () => {
    expect(
      apiKeyToggleRequiresAdmin({ userId: "u_1", disabled: false }, "u_1"),
    ).toBe(false);
    expect(
      apiKeyToggleRequiresAdmin(
        { userId: "u_1", disabled: true, disabledBy: "u_1" },
        "u_1",
      ),
    ).toBe(false);
  });

  it("treats a disable with no recorded disabler as the owner's", () => {
    expect(
      apiKeyToggleRequiresAdmin(
        { userId: "u_1", disabled: true, disabledBy: null },
        "u_1",
      ),
    ).toBe(false);
  });

  it("locks the owner out of a PAT an admin disabled", () => {
    expect(
      apiKeyToggleRequiresAdmin(
        { userId: "u_1", disabled: true, disabledBy: "u_admin" },
        "u_1",
      ),
    ).toBe(true);
  });

  it("ignores a stale disabledBy once the PAT is enabled", () => {
    expect(
      apiKeyToggleRequiresAdmin(
        { userId: "u_1", disabled: false, disabledBy: "u_admin" },
        "u_1",
      ),
    ).toBe(false);
  });
});

describe("canSetApiKeyDisabled", () => {
  const grant = (
    granted: Partial<
      Record<
        "canDeleteApiKey" | "canUpdateApiKey" | "canManagePersonalAccessTokens",
        boolean
      >
    >,
  ) => ({
    canDeleteApiKey: () => !!granted.canDeleteApiKey,
    canUpdateApiKey: () => !!granted.canUpdateApiKey,
    canManagePersonalAccessTokens: () =>
      !!granted.canManagePersonalAccessTokens,
  });
  const deleteOnly = grant({ canDeleteApiKey: true });
  const editOnly = grant({ canUpdateApiKey: true });
  const tokensOnly = grant({ canManagePersonalAccessTokens: true });
  const allOrgKeys = grant({ canDeleteApiKey: true, canUpdateApiKey: true });
  const none = grant({});

  it("needs delete to disable an org key and edit to re-enable it", () => {
    const enabled = { userId: undefined, disabled: false };
    const disabled = { userId: undefined, disabled: true, disabledBy: "u_1" };
    expect(canSetApiKeyDisabled(deleteOnly, enabled, "u_1", true)).toBe(true);
    expect(canSetApiKeyDisabled(editOnly, enabled, "u_1", true)).toBe(false);
    expect(canSetApiKeyDisabled(tokensOnly, enabled, "u_1", true)).toBe(false);
    expect(canSetApiKeyDisabled(editOnly, disabled, "u_1", false)).toBe(true);
    expect(canSetApiKeyDisabled(deleteOnly, disabled, "u_1", false)).toBe(
      false,
    );
    expect(canSetApiKeyDisabled(tokensOnly, disabled, "u_1", false)).toBe(
      false,
    );
  });

  it("lets the owner toggle their own PAT without key permissions", () => {
    expect(
      canSetApiKeyDisabled(
        none,
        { userId: "u_1", disabled: false },
        "u_1",
        true,
      ),
    ).toBe(true);
    expect(
      canSetApiKeyDisabled(
        none,
        { userId: "u_1", disabled: true, disabledBy: "u_1" },
        "u_1",
        false,
      ),
    ).toBe(true);
  });

  it.each([
    {
      name: "an admin-disabled PAT, for its owner",
      key: { userId: "u_1", disabled: true, disabledBy: "u_admin" },
    },
    {
      name: "another member's PAT",
      key: { userId: "u_owner", disabled: false },
    },
    {
      name: "another member's disabled PAT",
      key: { userId: "u_owner", disabled: true, disabledBy: "u_admin" },
    },
  ])(
    "needs members' token access, not org key access, to toggle $name",
    ({ key }) => {
      const target = !key.disabled;
      expect(canSetApiKeyDisabled(allOrgKeys, key, "u_1", target)).toBe(false);
      expect(canSetApiKeyDisabled(tokensOnly, key, "u_1", target)).toBe(true);
    },
  );
});

describe("canManageApiKeySecret", () => {
  const creator = { canCreateApiKey: () => true };
  const nonCreator = { canCreateApiKey: () => false };

  it("needs permission to create API keys for an org key", () => {
    expect(canManageApiKeySecret(creator, {}, "u_1")).toBe(true);
    expect(canManageApiKeySecret(nonCreator, {}, "u_1")).toBe(false);
  });

  it("lets only the owner manage a PAT's secret, whatever their permissions", () => {
    expect(canManageApiKeySecret(nonCreator, { userId: "u_1" }, "u_1")).toBe(
      true,
    );
    expect(canManageApiKeySecret(creator, { userId: "u_2" }, "u_1")).toBe(
      false,
    );
  });
});

describe("canApplyExpirationPolicy", () => {
  it("needs delete for secret keys and members' token access for PATs", () => {
    const deleteOnly = {
      canDeleteApiKey: () => true,
      canManagePersonalAccessTokens: () => false,
    };
    const tokensOnly = {
      canDeleteApiKey: () => false,
      canManagePersonalAccessTokens: () => true,
    };
    expect(canApplyExpirationPolicy(deleteOnly, "secret")).toBe(true);
    expect(canApplyExpirationPolicy(deleteOnly, "pat")).toBe(false);
    expect(canApplyExpirationPolicy(tokensOnly, "pat")).toBe(true);
    expect(canApplyExpirationPolicy(tokensOnly, "secret")).toBe(false);
  });
});

describe("API key policies", () => {
  const apiKeyAtoms = (policies: Policy[]) =>
    Object.entries(permissionsFromRole({ policies }))
      .filter(
        ([atom, granted]) =>
          granted && /(ApiKeys|PersonalAccessTokens)$/.test(atom),
      )
      .map(([atom]) => atom)
      .sort();

  it.each<[Policy, string[]]>([
    ["APIKeysView", ["viewApiKeys"]],
    ["APIKeysCreate", ["createApiKeys", "viewApiKeys"]],
    ["APIKeysEdit", ["editApiKeys", "viewApiKeys"]],
    ["APIKeysDelete", ["deleteApiKeys", "viewApiKeys"]],
    ["APIKeysMemberTokens", ["managePersonalAccessTokens"]],
    [
      "APIKeysFullAccess",
      [
        "createApiKeys",
        "deleteApiKeys",
        "editApiKeys",
        "managePersonalAccessTokens",
        "viewApiKeys",
      ],
    ],
  ])("%s grants %j", (policy, atoms) => {
    expect(apiKeyAtoms([policy])).toEqual(atoms);
  });
});

describe("changesApiKeyAuthority", () => {
  const stored = {
    role: "readonly",
    limitAccessByEnvironment: false,
    environments: ["production"],
  };

  it("ignores an edit that only spells out the defaults", () => {
    expect(
      changesApiKeyAuthority(stored, {
        role: "readonly",
        limitAccessByEnvironment: false,
        environments: [],
        additionalRoles: [],
        projectRoles: [],
        actAs: "system",
        confirmRules: null,
      }),
    ).toBe(false);
  });

  it("ignores reordering a limited key's environments", () => {
    expect(
      changesApiKeyAuthority(
        { ...stored, limitAccessByEnvironment: true, environments: ["a", "b"] },
        { ...stored, limitAccessByEnvironment: true, environments: ["b", "a"] },
      ),
    ).toBe(false);
  });

  it.each([
    { name: "a role change", after: { ...stored, role: "admin" } },
    {
      name: "a new environment limit",
      after: { ...stored, limitAccessByEnvironment: true },
    },
    {
      name: "acting as the member it names",
      after: { ...stored, actAs: "user" as const },
    },
    {
      name: "turning confirmations on",
      after: { ...stored, confirmRules: [{ actions: ["*"] }] },
    },
  ])("counts $name", ({ after }) => {
    expect(changesApiKeyAuthority(stored, after)).toBe(true);
  });

  it("counts turning confirmations off", () => {
    expect(
      changesApiKeyAuthority(
        { ...stored, confirmRules: [{ actions: ["*"] }] },
        { ...stored, confirmRules: null },
      ),
    ).toBe(true);
  });
});
