import {
  areAdditionalRolesValid,
  assertDefaultRoleListsAreArrays,
  getDefaultRole,
  getRolePermissions,
  hasPermission,
  normalizeDefaultRole,
  pickDefaultRoleFields,
} from "shared/permissions";
import {
  OrganizationInterface,
  OrganizationSettings,
} from "shared/types/organization";

function orgWithDefaultRole(defaultRole: unknown): OrganizationInterface {
  return {
    id: "org_a",
    name: "Test organization",
    url: "test",
    ownerEmail: "owner@example.com",
    dateCreated: new Date(),
    members: [],
    invites: [],
    settings: {
      defaultRole: defaultRole as OrganizationSettings["defaultRole"],
    },
  };
}

describe("getDefaultRole", () => {
  it("returns only role fields from the stored default role", () => {
    const org = orgWithDefaultRole({
      role: "engineer",
      limitAccessByEnvironment: true,
      environments: ["production"],
      additionalRoles: [
        { role: "analyst", limitAccessByEnvironment: false, environments: [] },
      ],
      projectRoles: [],
      organization: { id: "org_b", members: [] },
      userId: "u_attacker",
      teams: ["team_a"],
    });

    expect(getDefaultRole(org)).toEqual({
      role: "engineer",
      limitAccessByEnvironment: true,
      environments: ["production"],
      additionalRoles: [
        { role: "analyst", limitAccessByEnvironment: false, environments: [] },
      ],
      projectRoles: [],
    });
  });

  it("does not add fields that were never stored", () => {
    const org = orgWithDefaultRole({
      role: "readonly",
      limitAccessByEnvironment: false,
      environments: [],
    });

    expect(getDefaultRole(org)).toEqual({
      role: "readonly",
      limitAccessByEnvironment: false,
      environments: [],
    });
  });

  it("falls back to collaborator for an invalid role", () => {
    const org = orgWithDefaultRole({
      role: "not-a-role",
      limitAccessByEnvironment: false,
      environments: [],
    });

    expect(getDefaultRole(org)).toEqual({
      role: "collaborator",
      environments: [],
      limitAccessByEnvironment: false,
    });
  });
});

describe("pickDefaultRoleFields", () => {
  it("drops unknown keys at every level", () => {
    expect(
      pickDefaultRoleFields({
        role: "engineer",
        limitAccessByEnvironment: false,
        environments: [],
        teams: ["t1"],
        additionalRoles: [
          {
            role: "analyst",
            limitAccessByEnvironment: false,
            environments: [],
            teams: ["t1"],
          },
        ],
        projectRoles: [
          {
            project: "p1",
            role: "admin",
            limitAccessByEnvironment: false,
            environments: [],
            teams: ["t1"],
            additionalRoles: [
              {
                role: "analyst",
                limitAccessByEnvironment: false,
                environments: [],
                teams: ["t1"],
              },
            ],
          },
        ],
      }),
    ).toEqual({
      role: "engineer",
      limitAccessByEnvironment: false,
      environments: [],
      additionalRoles: [
        { role: "analyst", limitAccessByEnvironment: false, environments: [] },
      ],
      projectRoles: [
        {
          project: "p1",
          role: "admin",
          limitAccessByEnvironment: false,
          environments: [],
          additionalRoles: [
            {
              role: "analyst",
              limitAccessByEnvironment: false,
              environments: [],
            },
          ],
        },
      ],
    });
  });
});

describe("areAdditionalRolesValid", () => {
  const org = { id: "org_a" };
  it("accepts absent or empty lists", () => {
    expect(areAdditionalRolesValid(undefined, org)).toBe(true);
    expect(areAdditionalRolesValid([], org)).toBe(true);
  });
  it("checks every role id", () => {
    const rule = { limitAccessByEnvironment: false, environments: [] };
    expect(areAdditionalRolesValid([{ role: "analyst", ...rule }], org)).toBe(
      true,
    );
    expect(
      areAdditionalRolesValid(
        [
          { role: "analyst", ...rule },
          { role: "nope", ...rule },
        ],
        org,
      ),
    ).toBe(false);
  });
});

describe("getDefaultRole with deleted custom roles", () => {
  it("drops deleted additional roles and preserves project overrides as noaccess", () => {
    const rule = { limitAccessByEnvironment: false, environments: [] };
    const org = orgWithDefaultRole({
      role: "engineer",
      ...rule,
      additionalRoles: [
        { role: "analyst", ...rule },
        { role: "deleted_role", ...rule },
      ],
      projectRoles: [
        { project: "p1", role: "deleted_role", ...rule },
        {
          project: "p2",
          role: "admin",
          ...rule,
          additionalRoles: [{ role: "deleted_role", ...rule }],
        },
      ],
    });

    expect(getDefaultRole(org)).toEqual({
      role: "engineer",
      ...rule,
      additionalRoles: [{ role: "analyst", ...rule }],
      projectRoles: [
        { project: "p1", role: "noaccess", ...rule },
        { project: "p2", role: "admin", ...rule, additionalRoles: [] },
      ],
    });
  });

  it("does not inherit global permissions when a project role was deleted", () => {
    const rule = { limitAccessByEnvironment: false, environments: [] };
    const org = orgWithDefaultRole({
      role: "engineer",
      ...rule,
      projectRoles: [{ project: "sensitive", role: "deleted_role", ...rule }],
    });
    const permissions = getRolePermissions(getDefaultRole(org), org, []);

    expect(hasPermission(permissions, "readData", "sensitive")).toBe(false);
    expect(
      hasPermission(permissions, "publishFeatures", "sensitive", [
        "production",
      ]),
    ).toBe(false);
    expect(
      hasPermission(permissions, "publishFeatures", "other", ["production"]),
    ).toBe(true);
  });

  it("retains valid additional grants and their limits on a stale project override", () => {
    const rule = { limitAccessByEnvironment: false, environments: [] };
    const org = orgWithDefaultRole({
      role: "engineer",
      ...rule,
      projectRoles: [
        {
          project: "sensitive",
          role: "deleted_role",
          ...rule,
          additionalRoles: [
            {
              role: "engineer",
              limitAccessByEnvironment: true,
              environments: ["staging"],
            },
            { role: "deleted_extra", ...rule },
          ],
        },
      ],
    });
    const permissions = getRolePermissions(getDefaultRole(org), org, []);

    expect(hasPermission(permissions, "readData", "sensitive")).toBe(true);
    expect(
      hasPermission(permissions, "publishFeatures", "sensitive", ["staging"]),
    ).toBe(true);
    expect(
      hasPermission(permissions, "publishFeatures", "sensitive", [
        "production",
      ]),
    ).toBe(false);
  });
});

describe("normalizeDefaultRole", () => {
  it("matches getDefaultRole for the same stored value", () => {
    const rule = { limitAccessByEnvironment: false, environments: [] };
    const stored = {
      role: "engineer",
      ...rule,
      teams: ["t1"],
      additionalRoles: [{ role: "deleted_role", ...rule }],
    };
    const org = orgWithDefaultRole(stored);
    expect(normalizeDefaultRole(stored, org)).toEqual(getDefaultRole(org));
  });
});

describe("malformed stored default role", () => {
  const rule = { limitAccessByEnvironment: false, environments: [] };

  it("getDefaultRole drops non-array lists instead of throwing", () => {
    const org = orgWithDefaultRole({
      role: "engineer",
      ...rule,
      additionalRoles: { junk: true },
      projectRoles: { p1: { project: "p1", role: "admin", ...rule } },
    });
    expect(() => getDefaultRole(org)).not.toThrow();
    expect(getDefaultRole(org)).toEqual({ role: "engineer", ...rule });
  });

  it("assertDefaultRoleListsAreArrays rejects non-array lists", () => {
    expect(() =>
      assertDefaultRoleListsAreArrays({
        role: "engineer",
        ...rule,
        projectRoles: { p1: {} },
      } as never),
    ).toThrow(/must be arrays/);
    expect(() =>
      assertDefaultRoleListsAreArrays({
        role: "engineer",
        ...rule,
        additionalRoles: { x: 1 },
      } as never),
    ).toThrow(/must be arrays/);
  });

  it("assertDefaultRoleListsAreArrays accepts well-formed or absent lists", () => {
    expect(() =>
      assertDefaultRoleListsAreArrays({ role: "engineer", ...rule }),
    ).not.toThrow();
    expect(() =>
      assertDefaultRoleListsAreArrays({
        role: "engineer",
        ...rule,
        additionalRoles: [{ role: "analyst", ...rule }],
        projectRoles: [{ project: "p1", role: "admin", ...rule }],
      }),
    ).not.toThrow();
  });
});
