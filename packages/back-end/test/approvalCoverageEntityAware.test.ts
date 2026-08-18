import { assessApprovalCoverage, RevisionModel } from "shared/permissions";
import { OrganizationInterface } from "shared/types/organization";

// FeaturesFullAccess grants reviewFeatures but NOT reviewConstants/reviewConfigs.
// FlagsReview grants all three.
const org = (
  policies: string[],
  environments: string[],
): OrganizationInterface =>
  ({
    id: "org_1",
    settings: { environments: [{ id: "dev" }, { id: "production" }] },
    customRoles: [{ id: "r", description: "", policies }],
    members: [
      {
        id: "u_a",
        role: "r",
        limitAccessByEnvironment: environments.length > 0,
        environments,
      },
    ],
    invites: [],
  }) as unknown as OrganizationInterface;

const assess = (
  o: OrganizationInterface,
  model: RevisionModel,
  projects: string[],
  footprint: Parameters<typeof assessApprovalCoverage>[0]["footprint"],
) =>
  assessApprovalCoverage({
    org: o,
    teams: [],
    model,
    projects,
    footprint,
    approvers: [{ id: "u_a", roleInfo: o.members[0] }],
  }).hasCoveringApproval;

const envs = (environments: string[]) =>
  ({ scope: "environments", environments }) as const;

describe("coverage is judged by the entity's own review permission", () => {
  it("credits a Constant approval only when the approver can review Constants", () => {
    const flags = org(["FlagsReview"], []);
    const featuresOnly = org(["FeaturesFullAccess"], []);

    expect(assess(flags, "constant", [""], envs(["dev"]))).toBe(true);
    // Holds reviewFeatures, not reviewConstants — must not count.
    expect(assess(featuresOnly, "constant", [""], envs(["dev"]))).toBe(false);
  });

  it("still credits a Feature approval from a Features-only role", () => {
    const featuresOnly = org(["FeaturesFullAccess"], []);

    expect(assess(featuresOnly, "feature", [""], envs(["dev"]))).toBe(true);
  });
});

describe("saved groups carry no environment requirement", () => {
  // Saved-group review is declared scope: "project" because saved groups have no
  // environment dimension. An unbound footprint must not demand unrestricted
  // environment authority from them.
  it("counts an environment-limited approval on an unbound footprint", () => {
    const devOnly = org(["SavedGroupsReview", "FlagsReview"], ["dev"]);

    expect(assess(devOnly, "saved-group", [""], { scope: "unbound" })).toBe(
      true,
    );
    // The same approver on a Constant IS held to the environment rule.
    expect(assess(devOnly, "constant", [""], { scope: "unbound" })).toBe(false);
  });
});

describe("multi-project entities need authority in every project", () => {
  const twoProjects = (): OrganizationInterface =>
    ({
      id: "org_1",
      settings: { environments: [{ id: "dev" }] },
      customRoles: [
        {
          id: "r",
          description: "",
          policies: ["SavedGroupsReview", "FlagsReview"],
        },
      ],
      members: [
        {
          id: "u_a",
          role: "noaccess",
          limitAccessByEnvironment: false,
          environments: [],
          // Review rights in prj_a only.
          projectRoles: [
            {
              project: "prj_a",
              role: "r",
              limitAccessByEnvironment: false,
              environments: [],
            },
          ],
        },
      ],
      invites: [],
    }) as unknown as OrganizationInterface;

  it("counts the approval when it covers the only project", () => {
    expect(
      assess(twoProjects(), "saved-group", ["prj_a"], { scope: "unbound" }),
    ).toBe(true);
  });

  it("does not count it when a second project is uncovered", () => {
    expect(
      assess(twoProjects(), "saved-group", ["prj_a", "prj_b"], {
        scope: "unbound",
      }),
    ).toBe(false);
  });
});
