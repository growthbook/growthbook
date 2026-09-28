import { getDefaultRole } from "shared/permissions";
import { OrganizationInterface } from "shared/types/organization";

function orgWithDefaultRole(
  defaultRole: unknown,
): Partial<OrganizationInterface> {
  return {
    id: "org_a",
    settings: {
      defaultRole:
        defaultRole as OrganizationInterface["settings"]["defaultRole"],
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
