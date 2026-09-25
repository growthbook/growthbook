import type { ExperimentInterface } from "shared/validators";
import { autoMerge } from "shared/util";
import type { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
  publishRevision: jest.fn(),
  prevalidatePublishRevision: jest.fn(),
  editFeatureRules: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: jest.fn(),
  discardRevision: jest.fn(),
  getLinkageSyncRevisionSummaries: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  removePendingFeatureDraftFromExperiment: jest.fn(),
}));

jest.mock("back-end/src/services/features", () => ({
  assertCanAutoPublish: jest.fn(),
  getDraftRevision: jest.fn(),
  getLiveAndBaseRevisionsForFeature: jest.fn(),
  getLiveRevisionForFeature: jest.fn(),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("shared/util", () => ({
  ...jest.requireActual("shared/util"),
  autoMerge: jest.fn(),
}));

jest.mock("back-end/src/services/featurePublishGates", () => ({
  assessRevisionApproval: jest.fn(),
}));

import {
  formatPendingDraftFailureMessage,
  publishPendingFeatureDraftsForExperiment,
} from "back-end/src/services/experiment-feature";
import { assessRevisionApproval } from "back-end/src/services/featurePublishGates";
import {
  getFeature,
  prevalidatePublishRevision,
  publishRevision,
} from "back-end/src/models/FeatureModel";
import {
  getRevision,
  discardRevision,
  getLinkageSyncRevisionSummaries,
} from "back-end/src/models/FeatureRevisionModel";
import { removePendingFeatureDraftFromExperiment } from "back-end/src/models/ExperimentModel";
import { getLiveAndBaseRevisionsForFeature } from "back-end/src/services/features";

const mockGetFeature = getFeature as jest.MockedFunction<typeof getFeature>;
const mockGetRevision = getRevision as jest.MockedFunction<typeof getRevision>;
const mockSummaries = getLinkageSyncRevisionSummaries as jest.MockedFunction<
  typeof getLinkageSyncRevisionSummaries
>;
const mockDiscardRevision = discardRevision as jest.MockedFunction<
  typeof discardRevision
>;
const mockPublishRevision = publishRevision as jest.MockedFunction<
  typeof publishRevision
>;
const mockPrevalidatePublish =
  prevalidatePublishRevision as jest.MockedFunction<
    typeof prevalidatePublishRevision
  >;
const mockRemovePending =
  removePendingFeatureDraftFromExperiment as jest.MockedFunction<
    typeof removePendingFeatureDraftFromExperiment
  >;
const mockGetLiveAndBase =
  getLiveAndBaseRevisionsForFeature as jest.MockedFunction<
    typeof getLiveAndBaseRevisionsForFeature
  >;
const mockAutoMerge = autoMerge as jest.MockedFunction<typeof autoMerge>;
const mockAssessRevisionApproval =
  assessRevisionApproval as jest.MockedFunction<typeof assessRevisionApproval>;

// The shared approval answer; tests override it to simulate a blocked draft.
const approvalSatisfied = {
  requiresReview: false,
  uncoveredApprovers: [],
  hasCoveringApproval: false,
  requiredApproverTeams: { satisfied: true, unmet: [] },
  requiredProjectApprovers: { satisfied: true, unmet: [] },
  satisfied: true,
};
const approvalBlocked = {
  ...approvalSatisfied,
  requiresReview: true,
  satisfied: false,
};

const ctx = {
  org: { id: "org_1", settings: {} },
  environments: ["production"],
  teams: [],
  hasPremiumFeature: () => true,
} as unknown as ReqContext;

// Each queued draft changes the experiment's rule unless listed here, so the
// newest queued draft of a feature is the one that launches.
let draftsCarryingRuleUnchanged = new Set<string>();
let queue: { featureId: string; revisionVersion: number }[] = [];

function makeExperiment(
  drafts: { featureId: string; revisionVersion: number }[],
): ExperimentInterface {
  queue = drafts;
  return {
    id: "exp_1",
    name: "exp",
    pendingFeatureDrafts: drafts,
  } as unknown as ExperimentInterface;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFeature.mockResolvedValue({
    id: "j2-test",
    organization: "org_1",
  } as never);
  mockGetLiveAndBase.mockResolvedValue({
    live: { rules: [] },
    base: { rules: [] },
  } as never);
  mockAutoMerge.mockReturnValue({
    success: true,
    conflicts: [],
    result: { rules: [] },
  });
  mockAssessRevisionApproval.mockReturnValue(approvalSatisfied);
  draftsCarryingRuleUnchanged = new Set();
  mockSummaries.mockImplementation(async (_org, featureId) => ({
    openDrafts: queue
      .filter((d) => d.featureId === featureId)
      .map(({ revisionVersion: version }) => ({
        version,
        rules: [
          {
            id: "fr_exp",
            type: "experiment-ref",
            experimentId: "exp_1",
            variations: [
              {
                variationId: "v1",
                value: draftsCarryingRuleUnchanged.has(
                  `${featureId}@${version}`,
                )
                  ? "live"
                  : `v${version}`,
              },
            ],
          },
        ],
      })) as never,
    liveRevision: {
      version: 1,
      rules: [
        {
          id: "fr_exp",
          type: "experiment-ref",
          experimentId: "exp_1",
          variations: [{ variationId: "v1", value: "live" }],
        },
      ],
    } as never,
  }));
});

describe("publishPendingFeatureDraftsForExperiment", () => {
  it("prunes stale entries (already published / discarded) without failing the publish", async () => {
    mockGetRevision.mockImplementation(async ({ version }) => {
      if (version === 4) {
        return { version: 4, status: "published", rules: [] } as never;
      }
      return { version, status: "draft", rules: [] } as never;
    });

    const experiment = makeExperiment([
      { featureId: "feat_a", revisionVersion: 4 },
      { featureId: "feat_b", revisionVersion: 6 },
    ]);

    const result = await publishPendingFeatureDraftsForExperiment(
      ctx,
      experiment,
    );

    expect(mockRemovePending).toHaveBeenCalledWith(ctx, "exp_1", "feat_a", 4);
    expect(result.published).toEqual([
      { featureId: "feat_b", revisionVersion: 6 },
    ]);
  });

  it("does not publish anything when one of multiple drafts fails pre-flight", async () => {
    mockGetRevision.mockImplementation(async ({ version }) => {
      return { version, status: "draft", rules: [] } as never;
    });
    mockAssessRevisionApproval
      .mockReturnValueOnce(approvalSatisfied)
      .mockReturnValueOnce(approvalBlocked);

    const experiment = makeExperiment([
      { featureId: "feat_a", revisionVersion: 6 },
      { featureId: "feat_b", revisionVersion: 6 },
    ]);

    const result = await publishPendingFeatureDraftsForExperiment(
      ctx,
      experiment,
    );

    expect(result.published).toEqual([]);
    expect(result.failed.map((f) => f.featureId)).toEqual(["feat_b"]);
    expect(mockPublishRevision).not.toHaveBeenCalled();
  });

  it("fails the whole batch before publishing anything when hook prevalidation rejects", async () => {
    mockGetRevision.mockImplementation(async ({ version }) => {
      return { version, status: "draft", rules: [] } as never;
    });
    // First draft prevalidates fine, second is rejected by a custom hook.
    mockPrevalidatePublish
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Blocked by custom hook"));

    const experiment = makeExperiment([
      { featureId: "feat_a", revisionVersion: 5 },
      { featureId: "feat_b", revisionVersion: 6 },
    ]);

    await expect(
      publishPendingFeatureDraftsForExperiment(ctx, experiment),
    ).rejects.toThrow("Blocked by custom hook");

    expect(mockPublishRevision).not.toHaveBeenCalled();
  });

  it("publishes a single draft cleanly", async () => {
    mockGetRevision.mockResolvedValue({
      version: 6,
      status: "draft",
      rules: [],
    } as never);

    const experiment = makeExperiment([
      { featureId: "j2-test", revisionVersion: 6 },
    ]);

    const result = await publishPendingFeatureDraftsForExperiment(
      ctx,
      experiment,
    );

    expect(result.published).toEqual([
      { featureId: "j2-test", revisionVersion: 6 },
    ]);
    expect(result.failed).toEqual([]);
    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
  });

  it("fetches each feature/revision once instead of re-fetching per phase", async () => {
    mockGetRevision.mockImplementation(async ({ version }) => {
      return { version, status: "draft", rules: [] } as never;
    });

    const experiment = makeExperiment([
      { featureId: "feat_a", revisionVersion: 5 },
      { featureId: "feat_b", revisionVersion: 6 },
    ]);

    const result = await publishPendingFeatureDraftsForExperiment(
      ctx,
      experiment,
    );

    expect(result.published.length).toBe(2);
    // One fetch per feature and one per draft revision across all phases.
    expect(mockGetFeature).toHaveBeenCalledTimes(2);
    expect(mockGetRevision).toHaveBeenCalledTimes(2);
    expect(mockGetLiveAndBase).toHaveBeenCalledTimes(2);
  });

  it("publishes only the newest draft of a feature that changes the experiment, and drops the rest from the queue", async () => {
    mockGetRevision.mockImplementation(async ({ version }) => {
      return { version, status: "draft", rules: [] } as never;
    });

    const experiment = makeExperiment([
      { featureId: "feat_a", revisionVersion: 5 },
      { featureId: "feat_a", revisionVersion: 7 },
      // Someone else's newer draft: it carries the experiment's rule unchanged.
      { featureId: "feat_a", revisionVersion: 8 },
    ]);
    draftsCarryingRuleUnchanged = new Set(["feat_a@8"]);

    const result = await publishPendingFeatureDraftsForExperiment(
      ctx,
      experiment,
    );

    expect(result.published).toEqual([
      { featureId: "feat_a", revisionVersion: 7 },
    ]);
    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    expect(mockRemovePending).toHaveBeenCalledWith(ctx, "exp_1", "feat_a", 5);
    expect(mockRemovePending).toHaveBeenCalledWith(ctx, "exp_1", "feat_a", 8);
  });

  it("launches nothing for a feature whose drafts only carry the experiment's rule", async () => {
    const experiment = makeExperiment([
      { featureId: "feat_a", revisionVersion: 5 },
    ]);
    draftsCarryingRuleUnchanged = new Set(["feat_a@5"]);

    const result = await publishPendingFeatureDraftsForExperiment(
      ctx,
      experiment,
    );

    expect(result).toEqual({ published: [], failed: [] });
    expect(mockPublishRevision).not.toHaveBeenCalled();
    expect(mockRemovePending).toHaveBeenCalledWith(ctx, "exp_1", "feat_a", 5);
  });

  it("discards a no-op draft without publishing or failing", async () => {
    mockGetRevision.mockResolvedValue({
      version: 6,
      status: "draft",
      rules: [],
    } as never);
    // Empty result means autoMerge found nothing to change — no-op path.
    mockAutoMerge.mockReturnValue({ success: true, conflicts: [], result: {} });

    const experiment = makeExperiment([
      { featureId: "j2-test", revisionVersion: 6 },
    ]);

    const result = await publishPendingFeatureDraftsForExperiment(
      ctx,
      experiment,
    );

    expect(mockDiscardRevision).toHaveBeenCalledTimes(1);
    expect(mockPublishRevision).not.toHaveBeenCalled();
    expect(mockRemovePending).toHaveBeenCalledTimes(1);
    expect(mockRemovePending).toHaveBeenCalledWith(ctx, "exp_1", "j2-test", 6);
    expect(result.published).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("halts the train on first merge conflict (no further publishes)", async () => {
    mockGetRevision.mockImplementation(async ({ version }) => {
      return { version, status: "draft", rules: [] } as never;
    });
    // Keyed by revision version (not call order): feat_a's draft merges cleanly; feat_b's (v6) conflicts
    mockAutoMerge.mockImplementation(
      (live, base, revision) =>
        ((revision as { version: number }).version === 6
          ? {
              success: false,
              conflicts: [
                { key: "rules", base: "x", live: "y", revision: "z" },
              ],
            }
          : {
              success: true,
              conflicts: [],
              result: { rules: [] },
            }) as never,
    );

    const experiment = makeExperiment([
      { featureId: "feat_a", revisionVersion: 7 },
      { featureId: "feat_b", revisionVersion: 6 },
    ]);

    const result = await publishPendingFeatureDraftsForExperiment(
      ctx,
      experiment,
    );

    expect(result.published.length).toBe(1);
    expect(result.failed.map((f) => f.featureId)).toEqual(["feat_b"]);
    expect(result.failed[0].reason).toBe("merge-conflict");
    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
  });

  it("fails with needs-rebase (not merge-conflict) for a mergeable diverged draft when the org requires rebase before publish", async () => {
    const rebaseCtx = {
      ...ctx,
      org: { id: "org_1", settings: { requireRebaseBeforePublish: true } },
      teams: [],
    } as unknown as ReqContext;
    mockGetRevision.mockResolvedValue({
      version: 6,
      status: "draft",
      baseVersion: 4,
      rules: [],
    } as never);
    // Live advanced past the draft's base, but the merge itself is clean.
    mockGetLiveAndBase.mockResolvedValue({
      live: { version: 5, rules: [] },
      base: { version: 4, rules: [] },
    } as never);

    const experiment = makeExperiment([
      { featureId: "j2-test", revisionVersion: 6 },
    ]);

    const result = await publishPendingFeatureDraftsForExperiment(
      rebaseCtx,
      experiment,
    );

    expect(result.published).toEqual([]);
    expect(result.failed).toEqual([
      { featureId: "j2-test", revisionVersion: 6, reason: "needs-rebase" },
    ]);
    expect(mockPublishRevision).not.toHaveBeenCalled();
  });

  it("auto-merges and publishes a mergeable diverged draft when the org does not require rebase before publish", async () => {
    mockGetRevision.mockResolvedValue({
      version: 6,
      status: "draft",
      baseVersion: 4,
      rules: [],
    } as never);
    mockGetLiveAndBase.mockResolvedValue({
      live: { version: 5, rules: [] },
      base: { version: 4, rules: [] },
    } as never);

    const experiment = makeExperiment([
      { featureId: "j2-test", revisionVersion: 6 },
    ]);

    const result = await publishPendingFeatureDraftsForExperiment(
      ctx,
      experiment,
    );

    expect(result.published).toEqual([
      { featureId: "j2-test", revisionVersion: 6 },
    ]);
    expect(result.failed).toEqual([]);
  });
});

describe("formatPendingDraftFailureMessage", () => {
  it("distinguishes a rebase-only failure from a true merge conflict", () => {
    expect(
      formatPendingDraftFailureMessage([
        { featureId: "feat_a", revisionVersion: 6, reason: "needs-rebase" },
      ]),
    ).toBe(
      "Cannot start experiment: feature flag draft could not be published (draft behind live (rebase needed, no conflicts) on: feat_a). Resolve the issue and try again.",
    );
    expect(
      formatPendingDraftFailureMessage([
        { featureId: "feat_a", revisionVersion: 6, reason: "merge-conflict" },
      ]),
    ).toBe(
      "Cannot start experiment: feature flag draft could not be published (merge conflict in: feat_a). Resolve the issue and try again.",
    );
  });

  it("combines reasons and dedupes feature ids", () => {
    expect(
      formatPendingDraftFailureMessage([
        { featureId: "feat_a", revisionVersion: 5, reason: "merge-conflict" },
        { featureId: "feat_a", revisionVersion: 7, reason: "merge-conflict" },
        { featureId: "feat_b", revisionVersion: 2, reason: "needs-rebase" },
      ]),
    ).toBe(
      "Cannot start experiment: feature flag drafts could not be published (merge conflict in: feat_a; draft behind live (rebase needed, no conflicts) on: feat_b). Resolve the issues and try again.",
    );
  });
});
