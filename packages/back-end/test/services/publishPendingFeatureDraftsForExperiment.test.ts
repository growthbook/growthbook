import type { ExperimentInterface } from "shared/validators";
import { autoMerge, checkIfRevisionNeedsReview } from "shared/util";
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
  checkIfRevisionNeedsReview: jest.fn(),
}));

import {
  formatPendingDraftFailureMessage,
  publishPendingFeatureDraftsForExperiment,
} from "back-end/src/services/experiment-feature";
import {
  getFeature,
  prevalidatePublishRevision,
  publishRevision,
} from "back-end/src/models/FeatureModel";
import {
  getRevision,
  discardRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { removePendingFeatureDraftFromExperiment } from "back-end/src/models/ExperimentModel";
import { getLiveAndBaseRevisionsForFeature } from "back-end/src/services/features";

const mockGetFeature = getFeature as jest.MockedFunction<typeof getFeature>;
const mockGetRevision = getRevision as jest.MockedFunction<typeof getRevision>;
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
const mockCheckIfRevisionNeedsReview =
  checkIfRevisionNeedsReview as jest.MockedFunction<
    typeof checkIfRevisionNeedsReview
  >;

const ctx = {
  org: { id: "org_1", settings: {} },
  environments: ["production"],
  hasPremiumFeature: () => true,
} as unknown as ReqContext;

function makeExperiment(
  drafts: { featureId: string; revisionVersion: number }[],
): ExperimentInterface {
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
  mockCheckIfRevisionNeedsReview.mockReturnValue(false);
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
    mockCheckIfRevisionNeedsReview.mockImplementationOnce(() => false);
    mockCheckIfRevisionNeedsReview.mockImplementationOnce(() => true);

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

  it("re-fetches fresh state only for later drafts of an already-published feature", async () => {
    mockGetRevision.mockImplementation(async ({ version }) => {
      return { version, status: "draft", rules: [] } as never;
    });

    const experiment = makeExperiment([
      { featureId: "feat_a", revisionVersion: 5 },
      { featureId: "feat_a", revisionVersion: 7 },
    ]);

    const result = await publishPendingFeatureDraftsForExperiment(
      ctx,
      experiment,
    );

    expect(result.published).toEqual([
      { featureId: "feat_a", revisionVersion: 5 },
      { featureId: "feat_a", revisionVersion: 7 },
    ]);
    // Phase 1 fetches the feature once (cached across drafts) and each
    // revision once; publishing v5 advances live state, so v7 re-fetches
    // everything before re-merging.
    expect(mockGetFeature).toHaveBeenCalledTimes(2);
    expect(mockGetRevision).toHaveBeenCalledTimes(3);
    expect(mockGetLiveAndBase).toHaveBeenCalledTimes(3);
  });

  it("publishes multiple drafts of the same feature in version order", async () => {
    mockGetRevision.mockImplementation(async ({ version }) => {
      return { version, status: "draft", rules: [] } as never;
    });

    const experiment = makeExperiment([
      { featureId: "feat_a", revisionVersion: 7 },
      { featureId: "feat_a", revisionVersion: 5 },
    ]);

    const result = await publishPendingFeatureDraftsForExperiment(
      ctx,
      experiment,
    );

    expect(result.published).toEqual([
      { featureId: "feat_a", revisionVersion: 5 },
      { featureId: "feat_a", revisionVersion: 7 },
    ]);
    expect(mockPublishRevision).toHaveBeenCalledTimes(2);
    expect(mockPublishRevision.mock.calls[0][0].revision).toMatchObject({
      version: 5,
    });
    expect(mockPublishRevision.mock.calls[1][0].revision).toMatchObject({
      version: 7,
    });
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
    // Keyed by revision version (not call order): feat_a's drafts (v5, v7) merge cleanly; feat_b's (v6) conflicts
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
      { featureId: "feat_a", revisionVersion: 5 },
      { featureId: "feat_a", revisionVersion: 7 },
      { featureId: "feat_b", revisionVersion: 6 },
    ]);

    const result = await publishPendingFeatureDraftsForExperiment(
      ctx,
      experiment,
    );

    expect(result.published.length).toBe(2);
    expect(result.failed.map((f) => f.featureId)).toEqual(["feat_b"]);
    expect(result.failed[0].reason).toBe("merge-conflict");
    expect(mockPublishRevision).toHaveBeenCalledTimes(2);
  });

  it("fails with needs-rebase (not merge-conflict) for a mergeable diverged draft when the org requires rebase before publish", async () => {
    const rebaseCtx = {
      ...ctx,
      org: { id: "org_1", settings: { requireRebaseBeforePublish: true } },
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
