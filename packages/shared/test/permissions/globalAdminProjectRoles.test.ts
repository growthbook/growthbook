import {
  MemberRoleWithProjects,
  OrganizationInterface,
} from "shared/types/organization";
import {
  getEffectiveRolesForProject,
  getRolePermissions,
  Permissions,
} from "../../src/permissions";

const org = {
  id: "org_1",
  settings: {
    environments: [
      { id: "dev", description: "" },
      { id: "production", description: "" },
    ],
  },
} as unknown as OrganizationInterface;

const readonlyIn = (project: string) => ({
  project,
  role: "readonly",
  limitAccessByEnvironment: false,
  environments: [],
});

const admin: MemberRoleWithProjects = {
  role: "admin",
  limitAccessByEnvironment: false,
  environments: [],
  projectRoles: [readonlyIn("prj_a")],
};

const canPublishInA = (
  info: MemberRoleWithProjects,
  member: boolean,
  teams: Parameters<typeof getRolePermissions>[2] = [],
) =>
  new Permissions(
    getRolePermissions(info, org, teams, undefined, { member }),
  ).canPublishFeature({ project: "prj_a" }, ["production"]);

describe("a global admin's project roles", () => {
  it("can't narrow a member's admin access", () => {
    expect(canPublishInA(admin, true)).toBe(true);
  });

  it("still bind an API key", () => {
    expect(canPublishInA(admin, false)).toBe(false);
  });

  it("still bind a member who is an admin only in another project", () => {
    expect(
      canPublishInA(
        {
          ...admin,
          role: "readonly",
          projectRoles: [
            readonlyIn("prj_a"),
            { ...readonlyIn("prj_b"), role: "admin" },
          ],
        },
        true,
      ),
    ).toBe(false);
  });

  it("can't be narrowed by a team's project role either", () => {
    expect(
      canPublishInA({ ...admin, projectRoles: [], teams: ["team_1"] }, true, [
        {
          id: "team_1",
          role: "readonly",
          limitAccessByEnvironment: false,
          environments: [],
          projectRoles: [{ ...readonlyIn("prj_a"), role: "noaccess" }],
        },
      ]),
    ).toBe(true);
  });

  it("can't narrow admin granted by a team or an additional role", () => {
    const readonlyMember = { ...admin, role: "readonly", teams: ["team_1"] };
    expect(
      canPublishInA(readonlyMember, true, [
        {
          id: "team_1",
          role: "admin",
          limitAccessByEnvironment: false,
          environments: [],
        },
      ]),
    ).toBe(true);
    expect(
      canPublishInA(
        {
          ...admin,
          role: "readonly",
          additionalRoles: [
            {
              role: "admin",
              limitAccessByEnvironment: false,
              environments: [],
            },
          ],
        },
        true,
      ),
    ).toBe(true);
  });
});

describe("getEffectiveRolesForProject", () => {
  it("shows a global admin as Admin in a project where they also have a role", () => {
    const roles = (exemptGlobalAdmin: boolean) =>
      getEffectiveRolesForProject(admin, "prj_a", [], {
        exemptGlobalAdmin,
      }).map((r) => r.role);
    expect(roles(true)).toEqual(["admin"]);
    expect(roles(false)).toEqual(["readonly"]);
  });
});
