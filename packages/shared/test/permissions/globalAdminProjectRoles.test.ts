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
  const split = (...args: Parameters<typeof getEffectiveRolesForProject>) => {
    const { applied, shadowed } = getEffectiveRolesForProject(...args);
    return {
      applied: applied.map((r) => r.role),
      shadowed: shadowed.map((r) => `${r.project ?? "all"}:${r.role}`),
    };
  };

  it("applies only Admin for a global admin and shadows every other rule", () => {
    const member = {
      ...admin,
      additionalRoles: [
        { role: "engineer", limitAccessByEnvironment: false, environments: [] },
      ],
      projectRoles: [
        readonlyIn("prj_a"),
        { ...readonlyIn("prj_b"), role: "admin" },
      ],
    };
    expect(split(member, "prj_a", [])).toEqual({
      applied: ["admin"],
      shadowed: ["all:engineer", "prj_a:readonly"],
    });
    // A project Admin rule is shadowed too, not merged into the global one.
    expect(split(member, null, [])).toEqual({
      applied: ["admin"],
      shadowed: ["all:engineer", "prj_a:readonly", "prj_b:admin"],
    });
  });

  it("shadows a project's other rules beside a project-scoped Admin", () => {
    const member = {
      role: "readonly",
      projectRoles: [{ ...readonlyIn("prj_a"), role: "admin" }],
      teams: ["team_1"],
    };
    const teams = [
      {
        id: "team_1",
        name: "Engineers",
        role: "readonly",
        projectRoles: [{ ...readonlyIn("prj_a"), role: "engineer" }],
      },
    ];
    expect(split(member, "prj_a", teams)).toEqual({
      applied: ["admin"],
      shadowed: ["prj_a:engineer"],
    });
    expect(split(member, null, teams)).toEqual({
      applied: ["readonly", "readonly"],
      shadowed: [],
    });
  });
});
