import { assessApprovalCoverage } from "shared/permissions";
import { OrganizationInterface } from "shared/types/organization";
import { TeamInterface } from "shared/types/team";

const feature = { project: "" };

const org = (members: Record<string, unknown>[]): OrganizationInterface =>
  ({
    id: "org_coverage",
    name: "Test Org",
    ownerEmail: "test@test.com",
    url: "https://test.com",
    dateCreated: new Date(),
    settings: {
      environments: [{ id: "development" }, { id: "production" }],
    },
    customRoles: [
      { id: "reviewer", description: "review only", policies: ["FlagsReview"] },
    ],
    members,
    invites: [],
  }) as unknown as OrganizationInterface;

const member = (id: string, environments: string[]) => ({
  id,
  role: "reviewer",
  limitAccessByEnvironment: environments.length > 0,
  environments,
});

const assess = (
  o: OrganizationInterface,
  approverIds: string[],
  environments: string[],
  teams: TeamInterface[] = [],
) =>
  assessApprovalCoverage({
    org: o,
    teams,
    feature,
    footprint: { scope: "environments", environments },
    // Callers resolve the approver's rules; the server maps from org.members.
    approvers: approverIds.map((id) => ({
      id,
      roleInfo: o.members.find((m) => m.id === id) ?? null,
    })),
  });

describe("approval coverage", () => {
  it("counts an approval that covers what the draft changes", () => {
    const o = org([member("u_dev", ["development"])]);

    expect(assess(o, ["u_dev"], ["development"])).toEqual({
      hasCoveringApproval: true,
      uncoveredApprovers: [],
    });
  });

  // The bypass this closes: approved while dev-only, then production was added.
  it("discounts an approval once the draft grows beyond the approver", () => {
    const o = org([member("u_dev", ["development"])]);

    expect(assess(o, ["u_dev"], ["development", "production"])).toEqual({
      hasCoveringApproval: false,
      uncoveredApprovers: ["u_dev"],
    });
  });

  it("does not sum two partial approvals into a whole one", () => {
    const o = org([
      member("u_dev", ["development"]),
      member("u_prod", ["production"]),
    ]);

    const result = assess(
      o,
      ["u_dev", "u_prod"],
      ["development", "production"],
    );

    expect(result.hasCoveringApproval).toBe(false);
    expect(result.uncoveredApprovers.sort()).toEqual(["u_dev", "u_prod"]);
  });

  it("counts one covering approval even when another does not cover", () => {
    const o = org([member("u_dev", ["development"]), member("u_all", [])]);

    expect(assess(o, ["u_dev", "u_all"], ["production"])).toEqual({
      hasCoveringApproval: true,
      uncoveredApprovers: ["u_dev"],
    });
  });

  it("treats an approver who has left the org as covering nothing", () => {
    const o = org([member("u_dev", ["development"])]);

    expect(assess(o, ["u_gone"], ["development"])).toEqual({
      hasCoveringApproval: false,
      uncoveredApprovers: ["u_gone"],
    });
  });

  it("uses current permissions, so losing rights withdraws coverage", () => {
    const before = org([member("u_x", [])]);
    const after = org([member("u_x", ["development"])]);

    expect(assess(before, ["u_x"], ["production"]).hasCoveringApproval).toBe(
      true,
    );
    expect(assess(after, ["u_x"], ["production"]).hasCoveringApproval).toBe(
      false,
    );
  });

  it("credits authority a team grants the approver", () => {
    const o = org([
      { ...member("u_t", []), role: "collaborator", teams: ["team_1"] },
    ]);
    const teams = [
      {
        id: "team_1",
        name: "Reviewers",
        role: "reviewer",
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [],
      },
    ] as unknown as TeamInterface[];

    expect(assess(o, ["u_t"], ["production"], teams).hasCoveringApproval).toBe(
      true,
    );
  });

  it("returns no coverage when there are no approvals", () => {
    const o = org([member("u_dev", ["development"])]);

    expect(assess(o, [], ["development"])).toEqual({
      hasCoveringApproval: false,
      uncoveredApprovers: [],
    });
  });
});
