import {
  apiKeyToggleRequiresAdmin,
  canSetApiKeyDisabled,
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
    expect(canSetApiKeyDisabled(editOnly, disabled, "u_1", false)).toBe(true);
    expect(canSetApiKeyDisabled(deleteOnly, disabled, "u_1", false)).toBe(
      false,
    );
  });

  it("gives members' token managers nothing over org keys", () => {
    const enabled = { userId: undefined, disabled: false };
    const disabled = { userId: undefined, disabled: true, disabledBy: "u_1" };
    expect(canSetApiKeyDisabled(tokensOnly, enabled, "u_1", true)).toBe(false);
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

  it("needs members' token access to re-enable a PAT an admin disabled, even for its owner", () => {
    const key = { userId: "u_1", disabled: true, disabledBy: "u_admin" };
    expect(canSetApiKeyDisabled(none, key, "u_1", false)).toBe(false);
    expect(canSetApiKeyDisabled(allOrgKeys, key, "u_1", false)).toBe(false);
    expect(canSetApiKeyDisabled(tokensOnly, key, "u_1", false)).toBe(true);
  });

  it("needs members' token access, not org key access, to toggle another member's PAT", () => {
    const enabled = { userId: "u_owner", disabled: false };
    const disabled = {
      userId: "u_owner",
      disabled: true,
      disabledBy: "u_admin",
    };
    expect(canSetApiKeyDisabled(allOrgKeys, enabled, "u_1", true)).toBe(false);
    expect(canSetApiKeyDisabled(allOrgKeys, disabled, "u_1", false)).toBe(
      false,
    );
    expect(canSetApiKeyDisabled(tokensOnly, enabled, "u_1", true)).toBe(true);
    expect(canSetApiKeyDisabled(tokensOnly, disabled, "u_1", false)).toBe(true);
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

  it("grants the same as Full Access when every part is selected", () => {
    expect(
      apiKeyAtoms([
        "APIKeysView",
        "APIKeysCreate",
        "APIKeysEdit",
        "APIKeysDelete",
        "APIKeysMemberTokens",
      ]),
    ).toEqual(apiKeyAtoms(["APIKeysFullAccess"]));
  });
});
