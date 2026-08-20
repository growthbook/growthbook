import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { Context } from "back-end/src/models/BaseModel";
import {
  assessRevisionApproval,
  featurePublishEnvironmentIds,
} from "back-end/src/services/featurePublishGates";

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

const assess = async (
  context: Context,
  draft: FeatureRevisionInterface,
  forFeature: FeatureInterface = feature,
) =>
  assessRevisionApproval({
    context,
    feature: forFeature,
    revision: draft,
    effectiveRevision: draft,
    filledLive: live,
    base: live,
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

  it("is satisfied when the org requires no review", async () => {
    const result = await assess(
      makeContext({ requireReviewOn: false }),
      prodDraft(),
    );

    expect(result.requiresReview).toBe(false);
    expect(result.satisfied).toBe(true);
  });

  it("is unsatisfied while review is required and nobody has approved", async () => {
    const result = await assess(makeContext({}), prodDraft());

    expect(result.requiresReview).toBe(true);
    expect(result.satisfied).toBe(false);
  });

  it("is satisfied once an approver with authority everywhere approves", async () => {
    const result = await assess(
      makeContext({}),
      prodDraft([{ userId: "u_rev", status: "approved" }]),
    );

    expect(result.hasCoveringApproval).toBe(true);
    expect(result.satisfied).toBe(true);
  });

  // The case the branch exists for: approved, but not by anyone who could
  // publish what the draft now changes.
  it("refuses an approval that does not cover the changed environment", async () => {
    const result = await assess(
      makeContext({ approverEnvs: ["dev"] }),
      prodDraft([{ userId: "u_rev", status: "approved" }]),
    );

    expect(result.hasCoveringApproval).toBe(false);
    expect(result.uncoveredApprovers).toEqual(["u_rev"]);
    expect(result.satisfied).toBe(false);
  });

  it("refuses a covered approval when the rule names a team nobody on it signed", async () => {
    const result = await assess(
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

  it("is satisfied when a member of the named team approves", async () => {
    const result = await assess(
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

// The environment set is derived from the feature, never caller-supplied — the
// autostart path once passed the org's full list and disagreed with manual publish.
describe("environment applicability drives the answer", () => {
  // production is reserved for another project; only dev can serve prj_mine.
  const scopedEnvContext = (ruleEnvs: string[], approverEnvs?: string[]) => {
    const context = makeContext({ approverEnvs: approverEnvs ?? ENVS });
    (
      context.org.settings as {
        environments: { id: string; projects?: string[] }[];
      }
    ).environments = [
      { id: "dev" },
      { id: "production", projects: ["prj_other"] },
    ];
    (
      context.org.settings as {
        requireReviews: { environments: string[] }[];
      }
    ).requireReviews[0].environments = ruleEnvs;
    return context;
  };
  const scopedFeature = {
    id: "feat_scoped",
    project: "prj_mine",
  } as unknown as FeatureInterface;
  const openFeature = {
    id: "feat_open",
    project: "",
  } as unknown as FeatureInterface;

  it("derives the same set the shared filter produces", () => {
    const context = scopedEnvContext([]);
    expect(featurePublishEnvironmentIds(context.org, scopedFeature)).toEqual([
      "dev",
    ]);
    expect(featurePublishEnvironmentIds(context.org, openFeature)).toEqual([
      "dev",
      "production",
    ]);
    expect(
      featurePublishEnvironmentIds(context.org, {
        id: "feat_targeted",
        project: "prj_mine",
        targetingProjects: ["prj_other"],
      } as unknown as FeatureInterface),
    ).toEqual(["dev", "production"]);
  });

  // A kill-switch flip on an environment the feature cannot serve is not a
  // change at all — but judged against the org's full list it demanded review.
  const killSwitchDraft = () =>
    revision({
      environmentsEnabled: { dev: true, production: false },
    } as Partial<FeatureRevisionInterface>);

  const requirementPermutations: [string, FeatureInterface, boolean][] = [
    [
      "scoped feature: flip is outside its world, no review",
      scopedFeature,
      false,
    ],
    ["open feature: same flip requires review", openFeature, true],
    [
      "targeting projects widen the world back, review again",
      {
        id: "feat_targeted",
        project: "prj_mine",
        targetingProjects: ["prj_other"],
      } as unknown as FeatureInterface,
      true,
    ],
  ];
  it.each(requirementPermutations)(
    "%s",
    async (_name, forFeature, expected) => {
      const result = await assess(
        scopedEnvContext([]),
        killSwitchDraft(),
        forFeature,
      );
      expect(result.requiresReview).toBe(expected);
    },
  );

  // A global change footprints as "everywhere" — deliberately never narrowed, so
  // an env-limited approver cannot cover it even when the worlds match. Pinned.
  const approvedGlobalDraft = () =>
    revision({
      defaultValue: "true",
      status: "approved",
      reviews: [{ userId: "u_rev", status: "approved" }],
    } as Partial<FeatureRevisionInterface>);

  const coveragePermutations: [string, FeatureInterface, string[], boolean][] =
    [
      [
        "a dev-limited approver never covers a global change, even on a dev-only feature",
        scopedFeature,
        ["dev"],
        false,
      ],
      ["nor on an open feature", openFeature, ["dev"], false],
      [
        "an unlimited approver covers it on the scoped feature",
        scopedFeature,
        ENVS,
        true,
      ],
      ["and on the open feature", openFeature, ENVS, true],
    ];
  it.each(coveragePermutations)(
    "%s",
    async (_name, forFeature, approverEnvs, expected) => {
      const result = await assess(
        scopedEnvContext([], approverEnvs),
        approvedGlobalDraft(),
        forFeature,
      );
      expect(result.requiresReview).toBe(true);
      expect(result.hasCoveringApproval).toBe(expected);
      expect(result.satisfied).toBe(expected);
    },
  );
});

// The live schedule's environments are loaded inside the function, so a ramp
// update that REMOVES an environment cannot escape approval coverage on any
// path — the autostart path once omitted the lookup.
describe("ramp updates count the live schedule's environments", () => {
  const liveSchedule = {
    startActions: [],
    steps: [{ actions: [{ patch: { environments: ["production"] } }] }],
    endActions: [],
  };
  const withRampModels = (context: Context): Context => {
    (context as { models?: unknown }).models = {
      rampSchedules: {
        getById: async (id: string) => (id === "rs_1" ? liveSchedule : null),
      },
    };
    return context;
  };

  // The draft's replacement schedule only touches dev; production exists only
  // on the live schedule being replaced.
  const rampDraft = () =>
    revision({
      status: "approved",
      reviews: [{ userId: "u_rev", status: "approved" }],
      rampActions: [
        {
          mode: "update",
          rampScheduleId: "rs_1",
          ruleId: "r_missing",
          startActions: [],
          steps: [{ actions: [{ patch: { environments: ["dev"] } }] }],
          endActions: [],
        },
      ],
    } as unknown as Partial<FeatureRevisionInterface>);

  it("a dev-limited approval does not cover removing production", async () => {
    const result = await assess(
      withRampModels(makeContext({ approverEnvs: ["dev"] })),
      rampDraft(),
    );
    expect(result.requiresReview).toBe(true);
    expect(result.hasCoveringApproval).toBe(false);
    expect(result.uncoveredApprovers).toEqual(["u_rev"]);
  });

  it("an unlimited approval covers it", async () => {
    const result = await assess(withRampModels(makeContext({})), rampDraft());
    expect(result.hasCoveringApproval).toBe(true);
    expect(result.satisfied).toBe(true);
  });
});
