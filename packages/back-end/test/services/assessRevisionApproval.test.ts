import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { Context } from "back-end/src/models/BaseModel";
import { assessRevisionApproval } from "back-end/src/services/featurePublishGates";

// The contract four publish flows depend on: the app endpoint, the REST
// endpoint, bulk publish, and the two autostart paths.

const ENVS = ["dev", "production"];

const rule = (env: string) => ({
  id: `r_${env}`,
  type: "force" as const,
  description: "",
  value: "true",
  enabled: true,
  environments: [env],
});

const feature = { id: "feat_1", project: "" } as unknown as FeatureInterface;

const revision = (
  over: Partial<FeatureRevisionInterface> = {},
): FeatureRevisionInterface =>
  ({
    version: 2,
    status: "draft",
    rules: [],
    environmentsEnabled: { dev: true, production: true },
    defaultValue: "false",
    prerequisites: [],
    archived: false,
    metadata: {},
    holdout: null,
    rampActions: [],
    reviews: [],
    ...over,
  }) as unknown as FeatureRevisionInterface;

const live = revision({ version: 1 });

// `policies` drives what the approver may review; `environments` limits where.
function makeContext({
  requireReviewOn = true,
  requiredApproverTeams,
  approverEnvs = ENVS,
  approverTeams = [] as string[],
}: {
  requireReviewOn?: boolean;
  requiredApproverTeams?: string[];
  approverEnvs?: string[];
  approverTeams?: string[];
}): Context {
  return {
    org: {
      id: "org_1",
      settings: {
        environments: ENVS.map((id) => ({ id })),
        requireReviews: [
          {
            requireReviewOn,
            resetReviewOnChange: false,
            environments: [],
            projects: [],
            ...(requiredApproverTeams ? { requiredApproverTeams } : {}),
          },
        ],
      },
      customRoles: [{ id: "r", description: "", policies: ["FlagsReview"] }],
      members: [
        {
          id: "u_rev",
          role: "r",
          limitAccessByEnvironment: approverEnvs.length < ENVS.length,
          environments: approverEnvs,
          teams: approverTeams,
        },
      ],
      invites: [],
    },
    teams: [{ id: "team_fin", name: "Finance" }],
    hasPremiumFeature: () => true,
  } as unknown as Context;
}

const assess = (context: Context, draft: FeatureRevisionInterface) =>
  assessRevisionApproval({
    context,
    feature,
    revision: draft,
    effectiveRevision: draft,
    filledLive: live,
    base: live,
    environmentIds: ENVS,
  });

describe("assessRevisionApproval", () => {
  const prodDraft = (
    reviews: { userId: string; status: string }[] = [],
  ): FeatureRevisionInterface =>
    revision({
      rules: [rule("production")],
      status: reviews.length ? "approved" : "draft",
      reviews,
    } as Partial<FeatureRevisionInterface>);

  it("is satisfied when the org requires no review", () => {
    const result = assess(makeContext({ requireReviewOn: false }), prodDraft());

    expect(result.requiresReview).toBe(false);
    expect(result.satisfied).toBe(true);
  });

  it("is unsatisfied while review is required and nobody has approved", () => {
    const result = assess(makeContext({}), prodDraft());

    expect(result.requiresReview).toBe(true);
    expect(result.satisfied).toBe(false);
  });

  it("is satisfied once an approver with authority everywhere approves", () => {
    const result = assess(
      makeContext({}),
      prodDraft([{ userId: "u_rev", status: "approved" }]),
    );

    expect(result.hasCoveringApproval).toBe(true);
    expect(result.satisfied).toBe(true);
  });

  // The case the branch exists for: approved, but not by anyone who could
  // publish what the draft now changes.
  it("refuses an approval that does not cover the changed environment", () => {
    const result = assess(
      makeContext({ approverEnvs: ["dev"] }),
      prodDraft([{ userId: "u_rev", status: "approved" }]),
    );

    expect(result.hasCoveringApproval).toBe(false);
    expect(result.uncoveredApprovers).toEqual(["u_rev"]);
    expect(result.satisfied).toBe(false);
  });

  it("refuses a covered approval when the rule names a team nobody on it signed", () => {
    const result = assess(
      makeContext({ requiredApproverTeams: ["team_fin"] }),
      prodDraft([{ userId: "u_rev", status: "approved" }]),
    );

    expect(result.hasCoveringApproval).toBe(true);
    expect(result.requiredApproverTeams.satisfied).toBe(false);
    expect(result.requiredApproverTeams.unmet).toEqual([
      [{ id: "team_fin", name: "Finance" }],
    ]);
    expect(result.satisfied).toBe(false);
  });

  it("is satisfied when a member of the named team approves", () => {
    const result = assess(
      makeContext({
        requiredApproverTeams: ["team_fin"],
        approverTeams: ["team_fin"],
      }),
      prodDraft([{ userId: "u_rev", status: "approved" }]),
    );

    expect(result.requiredApproverTeams.satisfied).toBe(true);
    expect(result.satisfied).toBe(true);
  });
});
