import {
  areAdditionalRolesValid,
  getDefaultRole,
  pickDefaultRoleFields,
} from "shared/permissions";
import {
  OrganizationInterface,
  OrganizationSettings,
} from "shared/types/organization";

function orgWithDefaultRole(
  defaultRole: unknown,
): Partial<OrganizationInterface> {
  return {
    id: "org_a",
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
  it("drops rules that reference roles the org no longer has", () => {
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
        { project: "p2", role: "admin", ...rule, additionalRoles: [] },
      ],
    });
  });
});
