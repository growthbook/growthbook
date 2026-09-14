import {
  assessGoverningApprovalCoverage,
  assessRequiredApproverTeamsByProject,
  getRolePermissions,
  Permissions,
} from "shared/permissions";
import {
  MemberRoleWithProjects,
  OrganizationInterface,
} from "shared/types/organization";

const projectRole = (project: string, role: string) => ({
  project,
  role,
  limitAccessByEnvironment: false,
  environments: [],
});
const member = (
  id: string,
  role: string,
  projectRoles: ReturnType<typeof projectRole>[] = [],
  teams: string[] = [],
) => ({
  id,
  role,
  limitAccessByEnvironment: false,
  environments: [],
  projectRoles,
  teams,
});

// u_b reviews the primary project, u_a the targeting project, u_both everything.
const org = {
  id: "org_1",
  settings: { environments: [{ id: "production" }] },
  customRoles: [
    { id: "reviewer", description: "", policies: ["FlagsReview"] },
    { id: "target", description: "", policies: ["FlagsTarget"] },
    { id: "publisher", description: "", policies: ["FlagsPublish"] },
    { id: "full", description: "", policies: ["FlagsFullAccess"] },
  ],
  members: [
    member("u_b", "noaccess", [projectRole("prj_b", "reviewer")]),
    // In Finance, but a reviewer only for the targeting project.
    member("u_a", "noaccess", [projectRole("prj_a", "reviewer")], ["t_fin"]),
    member("u_both", "reviewer"),
    member("u_none", "noaccess"),
    member("u_target_a", "noaccess", [
      projectRole("prj_b", "publisher"),
      projectRole("prj_a", "target"),
    ]),
    member("u_publisher", "publisher"),
    member("u_full", "full"),
  ],
  invites: [],
} as unknown as OrganizationInterface;

const roleInfo = (id: string) =>
  (org.members.find((m) => m.id === id) ?? null) as MemberRoleWithProjects;
const permissionsFor = (id: string) =>
  new Permissions(getRolePermissions(roleInfo(id), org, []));

const assess = (approverIds: string[]) =>
  assessGoverningApprovalCoverage({
    org,
    teams: [],
    model: "feature",
    projects: ["prj_b"],
    approverProjects: ["prj_a"],
    footprint: { scope: "environments", environments: ["production"] },
    approvers: approverIds.map((id) => ({ id, roleInfo: roleInfo(id) })),
  });

describe("assessGoverningApprovalCoverage", () => {
  it("needs the primary covered AND each approver project signed", () => {
    expect(assess(["u_b"])).toEqual({
      hasCoveringApproval: true,
      uncoveredApprovers: [],
      contributingApproverIds: ["u_b"],
      primaryCoveringApproverIds: ["u_b"],
      coveringApproverIdsByProject: { prj_a: [] },
      requiredProjects: { satisfied: false, unmet: ["prj_a"] },
    });
    expect(assess(["u_b", "u_a"])).toEqual({
      hasCoveringApproval: true,
      uncoveredApprovers: [],
      contributingApproverIds: ["u_b", "u_a"],
      primaryCoveringApproverIds: ["u_b"],
      coveringApproverIdsByProject: { prj_a: ["u_a"] },
      requiredProjects: { satisfied: true, unmet: [] },
    });
  });

  // A targeting project's reviewer contributes to its requirement without
  // being either uncovered or a substitute for the primary's reviewer.
  it("counts a targeting-project approval toward that project only", () => {
    expect(assess(["u_a"])).toMatchObject({
      hasCoveringApproval: false,
      uncoveredApprovers: [],
      contributingApproverIds: ["u_a"],
      requiredProjects: { satisfied: true, unmet: [] },
    });
  });

  it("lets one reviewer with authority everywhere satisfy both", () => {
    expect(assess(["u_both"]).requiredProjects.satisfied).toBe(true);
    expect(assess(["u_both"]).hasCoveringApproval).toBe(true);
  });

  it("marks an approval that sanctions nothing as uncovered", () => {
    expect(assess(["u_none"])).toMatchObject({
      hasCoveringApproval: false,
      uncoveredApprovers: ["u_none"],
      contributingApproverIds: [],
      requiredProjects: { satisfied: false, unmet: ["prj_a"] },
    });
  });
});

describe("assessRequiredApproverTeamsByProject", () => {
  const teams = [{ id: "t_fin", name: "Finance" }];
  const requireFinance = { requiredApproverTeams: ["t_fin"] };
  const judge = (
    governing: {
      project: string;
      rule: { requiredApproverTeams?: string[] };
    }[],
    approverIds: string[],
  ) =>
    assessRequiredApproverTeamsByProject({
      governing,
      primaryProject: "prj_b",
      coverage: assess(approverIds),
      org,
      teams,
    });

  // The pooled version would pass: u_a is in Finance. But u_a's approval only
  // counts for prj_a, and the team rule belongs to the primary project.
  it("does not let a targeting project's reviewer satisfy the primary's team rule", () => {
    const out = judge(
      [{ project: "prj_b", rule: requireFinance }],
      ["u_b", "u_a"],
    );
    expect(out.satisfied).toBe(false);
    expect(out.unmet).toEqual([[{ id: "t_fin", name: "Finance" }]]);
  });

  it("judges a targeting project's own team rule against its own approvals", () => {
    expect(
      judge([{ project: "prj_a", rule: requireFinance }], ["u_b", "u_a"])
        .satisfied,
    ).toBe(true);
    expect(
      judge([{ project: "prj_a", rule: requireFinance }], ["u_b"]).satisfied,
    ).toBe(false);
  });

  // A rule a targeting project merely inherits is the primary's governance.
  it("uses the primary's approvals for a rule an inheriting project reports", () => {
    expect(
      judge([{ project: "prj_c", rule: requireFinance }], ["u_a"]).satisfied,
    ).toBe(false);
  });
});

describe("canReviewFeatureDrafts with approver projects", () => {
  const footprint = { scope: "any" as const };

  it("admits a targeting project's reviewer only when that project is listed", () => {
    const perms = permissionsFor("u_a");
    expect(perms.canReviewFeatureDrafts({ project: "prj_b" }, footprint)).toBe(
      false,
    );
    expect(
      perms.canReviewFeatureDrafts({ project: "prj_b" }, footprint, ["prj_a"]),
    ).toBe(true);
    expect(
      perms.canReviewFeatureDrafts({ project: "prj_b" }, footprint, ["prj_c"]),
    ).toBe(false);
  });
});

describe("canTargetFeatureProjects", () => {
  it("takes the atom in every added project", () => {
    const perms = permissionsFor("u_target_a");
    expect(perms.canTargetFeatureProjects(["prj_a"])).toBe(true);
    // Publish in the primary does not carry it.
    expect(perms.canTargetFeatureProjects(["prj_b"])).toBe(false);
    expect(perms.canTargetFeatureProjects(["prj_a", "prj_c"])).toBe(false);
  });

  it("takes the atom unscoped for all projects", () => {
    expect(permissionsFor("u_target_a").canTargetFeatureProjects("all")).toBe(
      false,
    );
    expect(permissionsFor("u_publisher").canTargetFeatureProjects("all")).toBe(
      false,
    );
    expect(permissionsFor("u_full").canTargetFeatureProjects("all")).toBe(true);
    expect(permissionsFor("u_both").canTargetFeatureProjects(["prj_a"])).toBe(
      false,
    );
  });
});
