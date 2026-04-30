import type { ExperimentInterface } from "shared/validators";
import { autoMerge, checkIfRevisionNeedsReview } from "shared/util";
import type { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
  publishRevision: jest.fn(),
  editFeatureRules: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: jest.fn(),
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

import { publishPendingFeatureDraftsForExperiment } from "back-end/src/services/experiment-feature";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { removePendingFeatureDraftFromExperiment } from "back-end/src/models/ExperimentModel";
import { getLiveAndBaseRevisionsForFeature } from "back-end/src/services/features";

const mockGetFeature = getFeature as jest.MockedFunction<typeof getFeature>;
const mockGetRevision = getRevision as jest.MockedFunction<typeof getRevision>;
const mockPublishRevision = publishRevision as jest.MockedFunction<
  typeof publishRevision
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
  mockAutoMerge.mockReturnValue({ success: true, conflicts: [], result: {} });
  mockCheckIfRevisionNeedsReview.mockReturnValue(false);
});

describe("publishPendingFeatureDraftsForExperiment", () => {
  it("prunes stale entries (already published / discarded) without failing the publish", async () => {
    mockGetRevision.mockResolvedValueOnce({
      version: 4,
      status: "published",
      rules: [],
    } as never);
    mockGetRevision.mockResolvedValueOnce({
      version: 6,
      status: "draft",
      rules: [],
    } as never);

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
});
