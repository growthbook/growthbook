import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  RevisionChanges,
} from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import {
  computeRevisionUpdate,
  computeRevisionPublishChanges,
} from "back-end/src/models/FeatureRevisionModel";
import { ReqContext } from "back-end/types/request";

const ORG_ENVS: Environment[] = [
  { id: "dev", description: "" },
  { id: "production", description: "" },
];

function mockContext(envs: Environment[] = ORG_ENVS): ReqContext {
  return {
    org: { settings: { environments: envs } },
  } as unknown as ReqContext;
}

const FEATURE = {
  id: "feat_test",
  organization: "org_test",
  project: "",
} as unknown as FeatureInterface;

function makeRevision(
  overrides: Partial<FeatureRevisionInterface> = {},
): FeatureRevisionInterface {
  return {
    organization: "org_test",
    featureId: "feat_test",
    version: 2,
    baseVersion: 1,
    dateCreated: new Date("2024-01-01"),
    dateUpdated: new Date("2024-01-01"),
    datePublished: null,
    createdBy: { type: "dashboard", id: "u", email: "", name: "" },
    comment: "",
    defaultValue: "true",
    rules: [],
    status: "draft",
    log: [],
    ...overrides,
  } as FeatureRevisionInterface;
}

function v2Rule(id: string) {
  return {
    id,
    type: "force" as const,
    description: "",
    value: "true",
    enabled: true,
    allEnvironments: true,
  };
}

describe("computeRevisionUpdate", () => {
  it("merges normalized changes and status into proposedRevision", () => {
    const revision = makeRevision();
    const changes: RevisionChanges = { defaultValue: "false" };

    const { normalizedChanges, status, proposedRevision } =
      computeRevisionUpdate(mockContext(), FEATURE, revision, changes, false);

    expect(status).toBe("draft");
    expect(normalizedChanges).toEqual(changes);
    expect(proposedRevision).toEqual({
      ...revision,
      ...normalizedChanges,
      status,
    });
  });

  it("throws for mutable changes on a published revision", () => {
    const revision = makeRevision({ status: "published" });

    expect(() =>
      computeRevisionUpdate(
        mockContext(),
        FEATURE,
        revision,
        { rules: [v2Rule("r1")] },
        false,
      ),
    ).toThrow("Can only update draft revisions");
  });

  it("allows non-mutable changes on a published revision", () => {
    const revision = makeRevision({ status: "published" });

    const { status } = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revision,
      {},
      false,
    );

    expect(status).toBe("published");
  });

  it("resets changes-requested to pending-review on content changes", () => {
    const revision = makeRevision({ status: "changes-requested" });

    const { status, proposedRevision } = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revision,
      { defaultValue: "false" },
      false,
    );

    expect(status).toBe("pending-review");
    expect(proposedRevision.status).toBe("pending-review");
  });

  it("resets approved to pending-review only when resetReview is set", () => {
    const revision = makeRevision({ status: "approved" });

    const kept = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revision,
      { defaultValue: "false" },
      false,
    );
    expect(kept.status).toBe("approved");

    const reset = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revision,
      { defaultValue: "false" },
      true,
    );
    expect(reset.status).toBe("pending-review");
  });

  it("normalizes v1 env-keyed rules into a flat v2 array", () => {
    const revision = makeRevision();
    const changes = {
      rules: {
        production: [
          {
            id: "r1",
            type: "force",
            description: "",
            value: "true",
            enabled: true,
          },
        ],
      },
    } as unknown as RevisionChanges;

    const { normalizedChanges, proposedRevision } = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revision,
      changes,
      false,
    );

    expect(Array.isArray(normalizedChanges.rules)).toBe(true);
    expect(proposedRevision.rules).toBe(normalizedChanges.rules);
  });

  it("is deterministic: identical inputs produce identical proposed states", () => {
    const revision = makeRevision({ status: "changes-requested" });
    const changes: RevisionChanges = { rules: [v2Rule("r1")] };

    const a = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revision,
      changes,
      false,
    );
    const b = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revision,
      changes,
      false,
    );

    expect(a.proposedRevision).toEqual(b.proposedRevision);
  });
});

describe("computeRevisionUpdate derives the review reset from the edit", () => {
  // Production is gated and resets review on change; the caller never asks for
  // a reset, so every demotion below comes from the edit itself.
  const gatedContext = {
    org: {
      settings: {
        environments: ORG_ENVS,
        requireReviews: [
          {
            requireReviewOn: true,
            resetReviewOnChange: true,
            environments: ["production"],
            projects: [],
          },
        ],
      },
    },
    hasPremiumFeature: () => true,
  } as unknown as ReqContext;
  const prodRule = {
    ...v2Rule("r1"),
    allEnvironments: false,
    environments: ["production"],
  };
  const approved = makeRevision({
    status: "approved",
    rules: [prodRule],
    environmentsEnabled: { dev: true, production: true },
    prerequisites: [],
    archived: false,
    metadata: { description: "d", project: "" },
    holdout: null,
    reviews: [
      {
        userId: "u_reviewer",
        status: "approved",
        date: new Date("2024-01-02"),
      },
    ],
  } as Partial<FeatureRevisionInterface>);
  const edit = (changes: RevisionChanges, context: ReqContext = gatedContext) =>
    computeRevisionUpdate(context, FEATURE, approved, changes, false);

  it("a production kill-switch flip sends the draft back for review", () => {
    const result = edit({
      environmentsEnabled: { dev: true, production: false },
    });
    expect(result.status).toBe("pending-review");
    expect(result.clearReviews).toBe(true);
    expect(result.staleReviews?.[0].status).toBe("approved-stale");
  });

  it("archiving sends the draft back for review", () => {
    expect(edit({ archived: true }).status).toBe("pending-review");
  });

  it("a prerequisite change sends the draft back for review", () => {
    expect(
      edit({ prerequisites: [{ id: "parent_flag", condition: "{}" }] }).status,
    ).toBe("pending-review");
  });

  it("a project move sends the draft back for review", () => {
    expect(
      edit({ metadata: { description: "d", project: "prj_other" } }).status,
    ).toBe("pending-review");
  });

  it("a holdout change sends the draft back for review", () => {
    expect(edit({ holdout: { id: "hld_1", value: "false" } }).status).toBe(
      "pending-review",
    );
  });

  it("a production rule edit sends the draft back for review", () => {
    expect(edit({ rules: [{ ...prodRule, value: "false" }] }).status).toBe(
      "pending-review",
    );
  });

  it("a dev-only kill-switch flip keeps the approval", () => {
    expect(
      edit({ environmentsEnabled: { dev: false, production: true } }).status,
    ).toBe("approved");
  });

  it("re-sending unchanged content keeps the approval", () => {
    expect(
      edit({
        rules: [prodRule],
        environmentsEnabled: { dev: true, production: true },
        archived: false,
      }).status,
    ).toBe("approved");
  });

  it("a comment edit keeps the approval", () => {
    expect(edit({ comment: "typo" }).status).toBe("approved");
  });

  it("a ramp action already on the approved draft does not make unrelated edits reset", () => {
    const rampCreate = {
      mode: "create" as const,
      ruleId: "r1",
      steps: [
        {
          interval: 86400,
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: "r1",
              patch: { ruleId: "r1" },
            },
          ],
        },
      ],
    };
    const withRamp = {
      ...approved,
      rampActions: [rampCreate],
    } as FeatureRevisionInterface;
    const editWithRamp = (changes: RevisionChanges) =>
      computeRevisionUpdate(gatedContext, FEATURE, withRamp, changes, false);

    expect(
      editWithRamp({ environmentsEnabled: { dev: false, production: true } })
        .status,
    ).toBe("approved");
    expect(editWithRamp({ rampActions: [rampCreate] }).status).toBe("approved");
    // Rebuilt by a caller with explicit undefined keys: still the same action.
    expect(
      editWithRamp({
        rampActions: [
          { ...rampCreate, endActions: undefined } as typeof rampCreate,
        ],
      }).status,
    ).toBe("approved");
    // A new ramp action on the production rule is a change of its own.
    expect(
      editWithRamp({
        rampActions: [
          rampCreate,
          { ...rampCreate, mode: "create", ruleId: "r1", steps: [] },
        ],
      }).status,
    ).toBe("pending-review");
    expect(edit({ rampActions: [rampCreate] }).status).toBe("pending-review");
  });

  it("leaves a rebase to the caller's own reset computation", () => {
    // A rebase re-sends everything merged with live; here live changed the
    // production rule upstream while the draft itself did not.
    const rebase = {
      baseVersion: 5,
      defaultValue: approved.defaultValue,
      rules: [{ ...prodRule, value: "from-live" }],
      environmentsEnabled: approved.environmentsEnabled,
      prerequisites: approved.prerequisites,
      archived: approved.archived,
      metadata: approved.metadata,
      holdout: approved.holdout,
    };
    // Without the option the upstream change reads as the draft's own edit.
    expect(edit(rebase).status).toBe("pending-review");
    expect(
      computeRevisionUpdate(gatedContext, FEATURE, approved, rebase, false, {
        rebase: true,
      }).status,
    ).toBe("approved");
    expect(
      computeRevisionUpdate(gatedContext, FEATURE, approved, rebase, true, {
        rebase: true,
      }).status,
    ).toBe("pending-review");
  });

  it("reads a sparse draft's missing fields from the live feature", () => {
    // Predates full snapshots: no environmentsEnabled / archived / holdout /
    // prerequisites recorded, while live serves production.
    const sparse = makeRevision({
      status: "approved",
      rules: [prodRule],
    });
    const liveFeature = {
      ...FEATURE,
      archived: false,
      prerequisites: [{ id: "parent_flag", condition: "{}" }],
      holdout: { id: "hld_1", value: "false" },
      environmentSettings: {
        dev: { enabled: true, rules: [] },
        production: { enabled: true, rules: [] },
      },
    } as unknown as FeatureInterface;
    const editSparse = (changes: RevisionChanges) =>
      computeRevisionUpdate(gatedContext, liveFeature, sparse, changes, false);

    expect(
      editSparse({ environmentsEnabled: { dev: true, production: false } })
        .status,
    ).toBe("pending-review");
    expect(editSparse({ archived: true }).status).toBe("pending-review");
    expect(editSparse({ prerequisites: [] }).status).toBe("pending-review");
    expect(editSparse({ holdout: null }).status).toBe("pending-review");
    expect(
      editSparse({ environmentsEnabled: { dev: false, production: true } })
        .status,
    ).toBe("approved");
  });

  it("keeps the approval when the rule does not reset review on change", () => {
    const noReset = {
      org: {
        settings: {
          environments: ORG_ENVS,
          requireReviews: [
            {
              requireReviewOn: true,
              resetReviewOnChange: false,
              environments: ["production"],
              projects: [],
            },
          ],
        },
      },
      hasPremiumFeature: () => true,
    } as unknown as ReqContext;
    expect(edit({ archived: true }, noReset).status).toBe("approved");
  });

  it("an exempt metadata edit keeps the approval", () => {
    const metadataExempt = {
      org: {
        settings: {
          environments: ORG_ENVS,
          requireReviews: [
            {
              requireReviewOn: true,
              resetReviewOnChange: true,
              featureRequireMetadataReview: false,
              environments: ["production"],
              projects: [],
            },
          ],
        },
      },
      hasPremiumFeature: () => true,
    } as unknown as ReqContext;
    expect(
      edit(
        { metadata: { description: "reworded", project: "" } },
        metadataExempt,
      ).status,
    ).toBe("approved");
  });
});

describe("computeRevisionPublishChanges", () => {
  const user = { type: "dashboard" as const, id: "u", email: "", name: "" };

  it("computes the published status and publisher", () => {
    const revision = makeRevision();

    const changes = computeRevisionPublishChanges(
      revision,
      user,
      "publish comment",
    );

    expect(changes.status).toBe("published");
    expect(changes.publishedBy).toBe(user);
    expect(changes.datePublished).toBeInstanceOf(Date);
    expect(changes.comment).toBe("publish comment");
  });

  it("keeps the revision's own comment when present", () => {
    const revision = makeRevision({ comment: "original" });

    const changes = computeRevisionPublishChanges(revision, user, "ignored");

    expect(changes.comment).toBe("original");
  });
});

describe("computeRevisionUpdate revert marker", () => {
  const revertDraft = () =>
    makeRevision({ revertedFrom: 1, status: "draft" as const });

  it("drops the marker once the revert draft's content is edited", () => {
    const { clearRevertedFrom, proposedRevision } = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revertDraft(),
      { defaultValue: "false" } as RevisionChanges,
      false,
    );
    expect(clearRevertedFrom).toBe(true);
    expect(proposedRevision.revertedFrom).toBeUndefined();
  });

  it("keeps the marker for non-content updates", () => {
    const { clearRevertedFrom, proposedRevision } = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revertDraft(),
      { comment: "just a description" } as RevisionChanges,
      false,
    );
    expect(clearRevertedFrom).toBe(false);
    expect(proposedRevision.revertedFrom).toBe(1);
  });

  it("keeps the marker when mutable fields are re-sent unchanged", () => {
    const revision = revertDraft();
    const { clearRevertedFrom, proposedRevision } = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revision,
      {
        defaultValue: revision.defaultValue,
        rules: revision.rules,
        baseVersion: 3,
      } as RevisionChanges,
      false,
    );
    expect(clearRevertedFrom).toBe(false);
    expect(proposedRevision.revertedFrom).toBe(1);
  });

  it("is a no-op for revisions that were never reverts", () => {
    const { clearRevertedFrom } = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      makeRevision(),
      { defaultValue: "false" } as RevisionChanges,
      false,
    );
    expect(clearRevertedFrom).toBe(false);
  });
});
