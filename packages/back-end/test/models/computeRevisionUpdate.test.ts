import { FeatureInterface } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  RevisionChanges,
} from "shared/types/feature-revision";
import { Environment } from "shared/types/organization";
import { MergeResultChanges } from "shared/util";
import { revisionChangesSchema } from "shared/validators";
import {
  computeRevisionUpdate,
  computeRevisionPublishChanges,
  REVISION_CONTENT_FIELDS,
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

// An org whose review rule resets approvals on change, gated to `environments`
// (every environment when empty).
function resetOnChangeContext(
  rule: Record<string, unknown> = {},
  envs: Environment[] = ORG_ENVS,
): ReqContext {
  return {
    org: {
      settings: {
        environments: envs,
        requireReviews: [
          {
            requireReviewOn: true,
            resetReviewOnChange: true,
            environments: [],
            projects: [],
            ...rule,
          },
        ],
      },
    },
    hasPremiumFeature: () => true,
  } as unknown as ReqContext;
}

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
      computeRevisionUpdate(mockContext(), FEATURE, revision, changes);

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
      computeRevisionUpdate(mockContext(), FEATURE, revision, {
        rules: [v2Rule("r1")],
      }),
    ).toThrow("Can only update draft revisions");
  });

  it("allows non-mutable changes on a published revision", () => {
    const revision = makeRevision({ status: "published" });

    const { status } = computeRevisionUpdate(
      mockContext(),
      FEATURE,
      revision,
      {},
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
    );

    expect(status).toBe("pending-review");
    expect(proposedRevision.status).toBe("pending-review");
  });

  it("resets approved to pending-review only under a reset-on-change review rule", () => {
    const revision = makeRevision({ status: "approved" });

    const kept = computeRevisionUpdate(mockContext(), FEATURE, revision, {
      defaultValue: "false",
    });
    expect(kept.status).toBe("approved");

    const reset = computeRevisionUpdate(
      resetOnChangeContext(),
      FEATURE,
      revision,
      { defaultValue: "false" },
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
    );

    expect(Array.isArray(normalizedChanges.rules)).toBe(true);
    expect(proposedRevision.rules).toBe(normalizedChanges.rules);
  });

  it("is deterministic: identical inputs produce identical proposed states", () => {
    const revision = makeRevision({ status: "changes-requested" });
    const changes: RevisionChanges = { rules: [v2Rule("r1")] };

    const a = computeRevisionUpdate(mockContext(), FEATURE, revision, changes);
    const b = computeRevisionUpdate(mockContext(), FEATURE, revision, changes);

    expect(a.proposedRevision).toEqual(b.proposedRevision);
  });
});

describe("computeRevisionUpdate derives the review reset from the edit", () => {
  // Production is gated and resets review on change; no caller flag exists, so
  // every demotion below comes from the edit itself.
  const gatedContext = resetOnChangeContext({ environments: ["production"] });
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
    computeRevisionUpdate(context, FEATURE, approved, changes);

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

  it("judges only the ramp actions an edit adds, rewrites, or removes", () => {
    const rampOn = (ruleId: string) => ({
      mode: "create" as const,
      ruleId,
      steps: [
        {
          interval: 86400,
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: ruleId,
              patch: { ruleId },
            },
          ],
        },
      ],
    });
    const prodRamp = rampOn("r1");
    const devRule = {
      ...v2Rule("r2"),
      allEnvironments: false,
      environments: ["dev"],
    };
    const devRamp = rampOn("r2");
    // Both pending ramps were approved with the draft.
    const withRamps = {
      ...approved,
      rules: [prodRule, devRule],
      rampActions: [prodRamp, devRamp],
    } as FeatureRevisionInterface;
    const editWithRamps = (changes: RevisionChanges) =>
      computeRevisionUpdate(gatedContext, FEATURE, withRamps, changes);

    // Unrelated edits, and re-sends of the same actions, leave them alone.
    expect(
      editWithRamps({ environmentsEnabled: { dev: false, production: true } })
        .status,
    ).toBe("approved");
    expect(editWithRamps({ rampActions: [prodRamp, devRamp] }).status).toBe(
      "approved",
    );
    // Rebuilt by a caller with explicit undefined keys: still the same action.
    expect(
      editWithRamps({
        rampActions: [
          { ...prodRamp, endActions: undefined } as typeof prodRamp,
          devRamp,
        ],
      }).status,
    ).toBe("approved");
    // Adding a production ramp is a production change.
    expect(edit({ rampActions: [prodRamp] }).status).toBe("pending-review");
    expect(
      editWithRamps({
        rampActions: [prodRamp, devRamp, { ...prodRamp, steps: [] }],
      }).status,
    ).toBe("pending-review");
    // Rewriting one is too.
    expect(
      editWithRamps({ rampActions: [{ ...prodRamp, steps: [] }, devRamp] })
        .status,
    ).toBe("pending-review");
    // So is dropping it — the approval covered a draft that would ramp
    // production — while dropping the dev ramp stays clear of the gate.
    expect(editWithRamps({ rampActions: [devRamp] }).status).toBe(
      "pending-review",
    );
    expect(editWithRamps({ rampActions: [prodRamp] }).status).toBe("approved");
  });

  it("judges a rebase the way publish does: what the draft still changes against the new live", () => {
    // Live serves both environments with no rules; the draft merged with it.
    const liveFeature = {
      ...FEATURE,
      defaultValue: "true",
      rules: [],
      environmentSettings: {
        dev: { enabled: true, rules: [] },
        production: { enabled: true, rules: [] },
      },
    } as unknown as FeatureInterface;
    const live = makeRevision({
      version: 5,
      status: "published",
      rules: [],
      environmentsEnabled: { dev: true, production: true },
    });
    // A rebase re-sends everything merged with live; here live changed the
    // production rule upstream while the draft itself did not.
    const rebased = {
      baseVersion: 5,
      defaultValue: "true",
      rules: [{ ...prodRule, value: "from-live" }],
      environmentsEnabled: { dev: true, production: true },
      prerequisites: [],
      archived: false,
      metadata: approved.metadata,
      holdout: null,
    };
    const rebase = (
      merged: MergeResultChanges,
      context: ReqContext = gatedContext,
    ) =>
      computeRevisionUpdate(context, liveFeature, approved, rebased, {
        rebase: { live, merged },
      }).status;

    // Without the merge result the upstream change reads as the draft's own edit.
    expect(edit(rebased).status).toBe("pending-review");
    // Nothing of the draft's own left to publish: the approval stands.
    expect(rebase({})).toBe("approved");
    // Rules diff per environment against the new live.
    expect(rebase({ rules: [prodRule] })).toBe("pending-review");
    expect(
      rebase({
        rules: [
          { ...v2Rule("r2"), allEnvironments: false, environments: ["dev"] },
        ],
      }),
    ).toBe("approved");
    // Kill switches reach only their own environment.
    expect(rebase({ environmentsEnabled: { dev: false } })).toBe("approved");
    expect(rebase({ environmentsEnabled: { production: false } })).toBe(
      "pending-review",
    );
    // Global fields reach every environment.
    for (const merged of [
      { defaultValue: "false" },
      { prerequisites: [{ id: "parent_flag", condition: "{}" }] },
      { archived: true },
      { holdout: { id: "hld_1", value: "false" } },
      { metadata: { description: "reworded" } },
    ] satisfies MergeResultChanges[]) {
      expect(rebase(merged)).toBe("pending-review");
    }
    // Publish's exemptions apply here too.
    expect(
      rebase(
        { metadata: { description: "reworded" } },
        resetOnChangeContext({
          environments: ["production"],
          featureRequireMetadataReview: false,
        }),
      ),
    ).toBe("approved");
    expect(
      rebase(
        { environmentsEnabled: { production: false } },
        resetOnChangeContext({
          environments: ["production"],
          featureRequireEnvironmentReview: false,
        }),
      ),
    ).toBe("approved");
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
      computeRevisionUpdate(gatedContext, liveFeature, sparse, changes);

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
    const noReset = resetOnChangeContext({
      resetReviewOnChange: false,
      environments: ["production"],
    });
    expect(edit({ archived: true }, noReset).status).toBe("approved");
  });

  it("an exempt metadata edit keeps the approval", () => {
    const metadataExempt = resetOnChangeContext({
      featureRequireMetadataReview: false,
      environments: ["production"],
    });
    expect(
      edit(
        { metadata: { description: "reworded", project: "" } },
        metadataExempt,
      ).status,
    ).toBe("approved");
  });
});

// Regression tripwire. Every content field of `RevisionChanges` must be one
// the derived reset understands: adding a field to the schema fails the first
// test until it is classified here, and the table pins that editing each one
// on an approved draft under an all-environment reset-on-change rule demotes it.
describe("every revision content field resets an approval", () => {
  const BOOKKEEPING_FIELDS = ["title", "comment", "baseVersion"];
  const context = resetOnChangeContext();
  const approved = makeRevision({
    status: "approved",
    rules: [v2Rule("r1")],
    environmentsEnabled: { dev: true, production: true },
    prerequisites: [],
    archived: false,
    metadata: { description: "d", project: "" },
    holdout: null,
    rampActions: [],
  } as Partial<FeatureRevisionInterface>);
  const edits: {
    [K in (typeof REVISION_CONTENT_FIELDS)[number]]: RevisionChanges;
  } = {
    defaultValue: { defaultValue: "false" },
    rules: { rules: [{ ...v2Rule("r1"), value: "false" }] },
    environmentsEnabled: {
      environmentsEnabled: { dev: true, production: false },
    },
    prerequisites: { prerequisites: [{ id: "parent_flag", condition: "{}" }] },
    archived: { archived: true },
    metadata: { metadata: { description: "d", project: "prj_other" } },
    holdout: { holdout: { id: "hld_1", value: "false" } },
    rampActions: {
      rampActions: [
        {
          mode: "create",
          ruleId: "r1",
          steps: [
            {
              interval: 86400,
              actions: [
                {
                  targetType: "feature-rule",
                  targetId: "r1",
                  patch: { ruleId: "r1" },
                },
              ],
            },
          ],
        },
      ],
    },
  };

  it("classifies every field of the RevisionChanges schema", () => {
    const schemaFields = Object.keys(revisionChangesSchema.shape).filter(
      (k) => !BOOKKEEPING_FIELDS.includes(k),
    );
    expect([...REVISION_CONTENT_FIELDS].sort()).toEqual(schemaFields.sort());
    expect(Object.keys(edits).sort()).toEqual(schemaFields.sort());
  });

  it.each(REVISION_CONTENT_FIELDS)("%s", (field) => {
    const result = computeRevisionUpdate(
      context,
      FEATURE,
      approved,
      edits[field],
    );
    expect(result.status).toBe("pending-review");
    expect(result.clearReviews).toBe(true);
  });

  it.each(BOOKKEEPING_FIELDS)(
    "%s is bookkeeping and keeps the approval",
    (field) => {
      const bookkeeping: RevisionChanges = {
        title: "t",
        comment: "c",
        baseVersion: 9,
      };
      const result = computeRevisionUpdate(context, FEATURE, approved, {
        [field]: bookkeeping[field as keyof RevisionChanges],
      });
      expect(result.status).toBe("approved");
      expect(result.clearReviews).toBe(false);
    },
  );
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
    );
    expect(clearRevertedFrom).toBe(false);
  });
});
