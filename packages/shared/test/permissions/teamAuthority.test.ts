import {
  MemberRoleWithProjects,
  OrganizationInterface,
  ProjectMemberRole,
} from "shared/types/organization";
import {
  changedProjectRoleProjects,
  getRolePermissions,
  isProjectScopedTeam,
  Permissions,
} from "../../src/permissions";

const org = {
  id: "org_1",
  settings: { environments: [{ id: "production", description: "" }] },
} as unknown as OrganizationInterface;

const rule = (project: string, role = "readonly"): ProjectMemberRole => ({
  project,
  role,
  limitAccessByEnvironment: false,
  environments: [],
});

const noaccessTeam = (projectRoles: ProjectMemberRole[]) => ({
  role: "noaccess",
  projectRoles,
});

const permissionsFor = (info: MemberRoleWithProjects) =>
  new Permissions(getRolePermissions(info, org, []));

const noaccess = {
  role: "noaccess",
  limitAccessByEnvironment: false,
  environments: [],
};

const teamAdmin = permissionsFor({ ...noaccess, role: "admin" });
const globalProjectAdmin = permissionsFor({
  ...noaccess,
  role: "gbDefault_projectAdmin",
});
const projectAdminOfA = permissionsFor({
  ...noaccess,
  projectRoles: [rule("prj_a", "gbDefault_projectAdmin")],
});
const engineer = permissionsFor({ ...noaccess, role: "engineer" });

describe("isProjectScopedTeam", () => {
  it("accepts only a noaccess team with no extra global roles", () => {
    expect(isProjectScopedTeam(noaccessTeam([rule("prj_a")]))).toBe(true);
    expect(isProjectScopedTeam(noaccessTeam([]))).toBe(true);
    expect(isProjectScopedTeam({ role: "readonly" })).toBe(false);
    expect(
      isProjectScopedTeam({
        role: "noaccess",
        additionalRoles: [{ role: "engineer" }],
      }),
    ).toBe(false);
    expect(isProjectScopedTeam({ role: "noaccess", managedByIdp: true })).toBe(
      false,
    );
    expect(
      isProjectScopedTeam({
        role: "noaccess",
        managedBy: { type: "vercel", resourceId: "r" },
      }),
    ).toBe(false);
  });
});

describe("changedProjectRoleProjects", () => {
  it("names added, removed, and changed projects only", () => {
    const before = [rule("prj_a"), rule("prj_b"), rule("prj_c")];
    const after = [rule("prj_a"), rule("prj_b", "engineer"), rule("prj_d")];
    expect(changedProjectRoleProjects(before, after).sort()).toEqual([
      "prj_b",
      "prj_c",
      "prj_d",
    ]);
    expect(changedProjectRoleProjects(before, [...before].reverse())).toEqual(
      [],
    );
    expect(changedProjectRoleProjects(undefined, [])).toEqual([]);
  });
});

describe("team writes under manageProjects", () => {
  const teamOnA = noaccessTeam([rule("prj_a")]);
  const teamOnAB = noaccessTeam([rule("prj_a"), rule("prj_b")]);
  const engineerTeam = { role: "engineer", projectRoles: [rule("prj_a")] };

  it("manageTeam covers every team", () => {
    expect(teamAdmin.canCreateTeam(engineerTeam)).toBe(true);
    expect(teamAdmin.canUpdateTeam(engineerTeam, { role: "admin" })).toBe(true);
    expect(teamAdmin.canDeleteTeam(engineerTeam)).toBe(true);
    expect(teamAdmin.canManageTeamMembership(engineerTeam)).toBe(true);
  });

  it("global manageProjects covers project-scoped teams on any project", () => {
    expect(globalProjectAdmin.canCreateTeam(teamOnAB)).toBe(true);
    expect(globalProjectAdmin.canCreateTeam(noaccessTeam([]))).toBe(true);
    expect(
      globalProjectAdmin.canUpdateTeam(teamOnA, {
        projectRoles: [rule("prj_a"), rule("prj_z", "engineer")],
      }),
    ).toBe(true);
    expect(globalProjectAdmin.canDeleteTeam(teamOnAB)).toBe(true);
    expect(globalProjectAdmin.canManageTeamMembership(teamOnAB)).toBe(true);
  });

  it("never reaches a team that carries global authority", () => {
    expect(globalProjectAdmin.canCreateTeam(engineerTeam)).toBe(false);
    expect(
      globalProjectAdmin.canCreateTeam({
        ...teamOnA,
        additionalRoles: [{ role: "engineer" }],
      }),
    ).toBe(false);
    expect(
      globalProjectAdmin.canUpdateTeam(engineerTeam, {
        projectRoles: [rule("prj_a", "engineer")],
      }),
    ).toBe(false);
    expect(globalProjectAdmin.canDeleteTeam(engineerTeam)).toBe(false);
    expect(globalProjectAdmin.canManageTeamMembership(engineerTeam)).toBe(
      false,
    );
  });

  it("never changes anything but the project roles", () => {
    expect(
      globalProjectAdmin.canUpdateTeam(teamOnA, { role: "engineer" }),
    ).toBe(false);
    expect(
      globalProjectAdmin.canUpdateTeam(teamOnA, {
        additionalRoles: [{ role: "engineer" }],
      }),
    ).toBe(false);
    expect(
      globalProjectAdmin.canUpdateTeam(teamOnA, { managedByIdp: true }),
    ).toBe(false);
    // Unchanged fields sent back are not changes.
    expect(
      globalProjectAdmin.canUpdateTeam(teamOnA, {
        role: "noaccess",
        projectRoles: [rule("prj_a", "engineer")],
      }),
    ).toBe(true);
  });

  it("ignores spelled-out empty fields and allows a no-op", () => {
    // Stored teams may lack the key; request bodies send [].
    const stored = { role: "noaccess", projectRoles: [rule("prj_a")] };
    expect(
      projectAdminOfA.canUpdateTeam(stored, {
        additionalRoles: [],
        environments: [],
        projectRoles: [rule("prj_a", "engineer")],
      }),
    ).toBe(true);
    expect(
      projectAdminOfA.canUpdateTeam(stored, { projectRoles: [rule("prj_a")] }),
    ).toBe(true);
    expect(
      projectAdminOfA.canUpdateTeam(stored, {
        additionalRoles: [{ role: "engineer" }],
      }),
    ).toBe(false);
  });

  it("project-limited manageProjects is confined to its projects", () => {
    expect(projectAdminOfA.canCreateTeam(teamOnA)).toBe(true);
    expect(projectAdminOfA.canCreateTeam(teamOnAB)).toBe(false);
    expect(projectAdminOfA.canCreateTeam(noaccessTeam([]))).toBe(false);
    // Editing only the prj_a rule on a team that also covers prj_b.
    expect(
      projectAdminOfA.canUpdateTeam(teamOnAB, {
        projectRoles: [rule("prj_a", "engineer"), rule("prj_b")],
      }),
    ).toBe(true);
    expect(
      projectAdminOfA.canUpdateTeam(teamOnAB, {
        projectRoles: [rule("prj_a"), rule("prj_b", "engineer")],
      }),
    ).toBe(false);
    expect(
      projectAdminOfA.canUpdateTeam(teamOnAB, {
        projectRoles: [rule("prj_a")],
      }),
    ).toBe(false);
    // Membership and deletion hand out every project on the team.
    expect(projectAdminOfA.canDeleteTeam(teamOnA)).toBe(true);
    expect(projectAdminOfA.canDeleteTeam(teamOnAB)).toBe(false);
    expect(projectAdminOfA.canManageTeamMembership(teamOnA)).toBe(true);
    expect(projectAdminOfA.canManageTeamMembership(teamOnAB)).toBe(false);
  });

  it("no manageProjects means no team writes", () => {
    expect(engineer.canCreateTeam(teamOnA)).toBe(false);
    expect(
      engineer.canUpdateTeam(teamOnA, {
        projectRoles: [rule("prj_a", "admin")],
      }),
    ).toBe(false);
    expect(engineer.canDeleteTeam(noaccessTeam([]))).toBe(false);
    expect(engineer.canManageTeamMembership(teamOnA)).toBe(false);
  });
});

describe("whole-member role writes under manageProjects", () => {
  const member: MemberRoleWithProjects = {
    role: "engineer",
    limitAccessByEnvironment: false,
    environments: [],
    projectRoles: [rule("prj_a"), rule("prj_b")],
  };

  it("allows changing only project rules the caller administers", () => {
    expect(
      projectAdminOfA.canUpdateMemberRole(member, {
        ...member,
        projectRoles: [rule("prj_a", "engineer"), rule("prj_b")],
      }),
    ).toBe(true);
    expect(
      projectAdminOfA.canUpdateMemberRole(member, {
        ...member,
        projectRoles: [rule("prj_a"), rule("prj_b", "engineer")],
      }),
    ).toBe(false);
    expect(
      globalProjectAdmin.canUpdateMemberRole(member, {
        ...member,
        projectRoles: [],
      }),
    ).toBe(true);
  });

  it("refuses any global role change without manageTeam", () => {
    expect(
      globalProjectAdmin.canUpdateMemberRole(member, {
        ...member,
        role: "admin",
      }),
    ).toBe(false);
    expect(
      globalProjectAdmin.canUpdateMemberRole(member, {
        ...member,
        limitAccessByEnvironment: true,
        environments: ["production"],
      }),
    ).toBe(false);
    expect(
      globalProjectAdmin.canUpdateMemberRole(member, {
        ...member,
        additionalRoles: [
          {
            role: "analyst",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ],
      }),
    ).toBe(false);
    expect(
      teamAdmin.canUpdateMemberRole(member, { ...member, role: "admin" }),
    ).toBe(true);
  });

  it("ignores undefined keys a REST body adds to untouched rules", () => {
    const resent = member.projectRoles!.map((r) => ({
      ...r,
      additionalRoles: undefined,
    }));
    expect(
      projectAdminOfA.canUpdateMemberRole(member, {
        ...member,
        projectRoles: [
          { ...resent[0], role: "engineer" },
          resent[1],
        ] as ProjectMemberRole[],
      }),
    ).toBe(true);
  });

  it("treats absent and empty global fields as equal", () => {
    const sparse = {
      role: "engineer",
      limitAccessByEnvironment: false,
      environments: [],
    } as MemberRoleWithProjects;
    expect(
      globalProjectAdmin.canUpdateMemberRole(sparse, {
        ...sparse,
        additionalRoles: [],
        projectRoles: [rule("prj_a")],
      }),
    ).toBe(true);
  });
});
