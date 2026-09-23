import { getReviewAuthorityFootprint, RevisionFields } from "shared/util";
import { assessApprovalCoverage } from "shared/permissions";
import { OrganizationInterface } from "shared/types/organization";

const ALL_ENVS = ["dev", "staging", "production"];

const revision = (over: Partial<RevisionFields> = {}): RevisionFields =>
  ({
    version: 1,
    defaultValue: "false",
    rules: [],
    environmentsEnabled: { dev: true, staging: true, production: true },
    prerequisites: [],
    archived: false,
    metadata: {},
    holdout: null,
    rampActions: [],
    ...over,
  }) as RevisionFields;

const rule = (env: string) => ({
  id: `r_${env}`,
  type: "force" as const,
  description: "",
  value: "true",
  enabled: true,
  environments: [env],
});

// Sam can review dev and nothing else.
const org = {
  id: "org_1",
  settings: { environments: ALL_ENVS.map((id) => ({ id })) },
  customRoles: [
    {
      id: "dev_reviewer",
      description: "review dev",
      policies: ["FlagsReview"],
    },
  ],
  members: [
    {
      id: "u_sam",
      role: "dev_reviewer",
      limitAccessByEnvironment: true,
      environments: ["dev"],
    },
  ],
} as unknown as OrganizationInterface;

const coverageOf = (draft: RevisionFields, live: RevisionFields) =>
  assessApprovalCoverage({
    org,
    teams: [],
    model: "feature",
    projects: [],
    footprint: getReviewAuthorityFootprint({
      revision: draft,
      bases: [live],
      allEnvironments: ALL_ENVS,
    }),
    // Sam's recorded approval, unchanged across the edit below.
    approvers: [{ id: "u_sam", roleInfo: org.members[0] }],
  });

// resetReviewOnChange and clearReviews both act on a STATUS transition, and this
// edit never causes one — the refusal must come from re-deriving at publish.
describe("a draft widened while already in pending-review", () => {
  const live = revision();

  it("counts the approval while the draft stays inside the approver's environments", () => {
    const devOnly = revision({ rules: [rule("dev")] });

    expect(coverageOf(devOnly, live)).toEqual({
      hasCoveringApproval: true,
      uncoveredApprovers: [],
    });
  });

  it("stops counting it once the same draft also changes production", () => {
    const widened = revision({ rules: [rule("dev"), rule("production")] });

    expect(coverageOf(widened, live)).toEqual({
      hasCoveringApproval: false,
      uncoveredApprovers: ["u_sam"],
    });
  });

  it("stops counting it when the edit reaches everywhere instead", () => {
    const defaultChanged = revision({
      rules: [rule("dev")],
      defaultValue: "true",
    });

    expect(coverageOf(defaultChanged, live).hasCoveringApproval).toBe(false);
  });
});
