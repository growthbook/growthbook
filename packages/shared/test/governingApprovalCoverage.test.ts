import {
  assessGoverningApprovalCoverage,
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
const member = (id: string, role: string, projectRoles = []) => ({
  id,
  role,
  limitAccessByEnvironment: false,
  environments: [],
  projectRoles,
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
    member("u_a", "noaccess", [projectRole("prj_a", "reviewer")]),
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
      requiredProjects: { satisfied: false, unmet: ["prj_a"] },
    });
    expect(assess(["u_b", "u_a"])).toEqual({
      hasCoveringApproval: true,
      uncoveredApprovers: [],
      contributingApproverIds: ["u_b", "u_a"],
      requiredProjects: { satisfied: true, unmet: [] },
    });
  });

  // A targeting project's reviewer contributes to its requirement without
  // being either uncovered or a substitute for the primary's reviewer.
  it("counts a targeting-project approval toward that project only", () => {
    expect(assess(["u_a"])).toEqual({
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
    expect(assess(["u_none"])).toEqual({
      hasCoveringApproval: false,
      uncoveredApprovers: ["u_none"],
      contributingApproverIds: [],
      requiredProjects: { satisfied: false, unmet: ["prj_a"] },
    });
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
