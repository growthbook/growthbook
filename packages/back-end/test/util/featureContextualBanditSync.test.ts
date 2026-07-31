import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ReqContext } from "back-end/types/request";
import { syncFeatureContextualBanditLinkages } from "back-end/src/util/featureContextualBanditSync";

const cbModel = {
  getById: jest.fn(),
  addLinkedFeature: jest.fn(),
  removeLinkedFeature: jest.fn(),
  addPendingFeatureDraft: jest.fn(),
  removePendingFeatureDraft: jest.fn(),
  clearStaleLinkedFeatures: jest.fn(),
  clearStalePendingFeatureDrafts: jest.fn(),
};

function makeContext(): ReqContext {
  return {
    models: { contextualBandits: cbModel },
  } as unknown as ReqContext;
}

function cbRule(contextualBanditId: string) {
  return {
    id: `fr_${contextualBanditId}`,
    type: "contextual-bandit-ref",
    contextualBanditId,
    allEnvironments: true,
    description: "",
    enabled: true,
    variations: [],
  };
}

function revision(
  version: number,
  contextualBanditIds: string[],
): Pick<FeatureRevisionInterface, "version" | "rules"> {
  return {
    version,
    rules: contextualBanditIds.map(cbRule),
  } as unknown as Pick<FeatureRevisionInterface, "version" | "rules">;
}

beforeEach(() => {
  jest.clearAllMocks();
  cbModel.getById.mockImplementation(async (id: string) => ({
    id,
    linkedFeatures: [],
    pendingFeatureDrafts: [],
  }));
});

describe("syncFeatureContextualBanditLinkages", () => {
  it("links a feature whose live revision serves the bandit", async () => {
    await syncFeatureContextualBanditLinkages(
      makeContext(),
      "feat_1",
      [],
      revision(3, ["cb_1"]),
    );

    expect(cbModel.addLinkedFeature).toHaveBeenCalledWith("cb_1", "feat_1");
    expect(cbModel.removeLinkedFeature).not.toHaveBeenCalled();
    expect(cbModel.clearStaleLinkedFeatures).toHaveBeenCalledWith("feat_1", [
      "cb_1",
    ]);
  });

  it("queues a draft-only reference without linking the feature", async () => {
    await syncFeatureContextualBanditLinkages(
      makeContext(),
      "feat_1",
      [revision(4, ["cb_1"])],
      revision(3, []),
    );

    expect(cbModel.addLinkedFeature).not.toHaveBeenCalled();
    expect(cbModel.removeLinkedFeature).toHaveBeenCalledWith("cb_1", "feat_1");
    expect(cbModel.addPendingFeatureDraft).toHaveBeenCalledWith(
      "cb_1",
      "feat_1",
      4,
    );
    // Nothing is live, so no bandit may keep this feature linked.
    expect(cbModel.clearStaleLinkedFeatures).toHaveBeenCalledWith("feat_1", []);
  });

  it("keeps a live feature linked while a draft edit is queued alongside", async () => {
    await syncFeatureContextualBanditLinkages(
      makeContext(),
      "feat_1",
      [revision(4, ["cb_1"])],
      revision(3, ["cb_1"]),
    );

    expect(cbModel.addLinkedFeature).toHaveBeenCalledWith("cb_1", "feat_1");
    expect(cbModel.addPendingFeatureDraft).toHaveBeenCalledWith(
      "cb_1",
      "feat_1",
      4,
    );
  });

  it("drops queue entries for drafts that no longer reference the bandit", async () => {
    cbModel.getById.mockResolvedValue({
      id: "cb_1",
      linkedFeatures: ["feat_1"],
      pendingFeatureDrafts: [
        { featureId: "feat_1", revisionVersion: 4 },
        { featureId: "feat_2", revisionVersion: 9 },
      ],
    });

    await syncFeatureContextualBanditLinkages(
      makeContext(),
      "feat_1",
      [revision(4, [])],
      revision(3, ["cb_1"]),
    );

    expect(cbModel.removePendingFeatureDraft).toHaveBeenCalledWith(
      "cb_1",
      "feat_1",
      4,
    );
    // Another feature's queue entry is none of this sync's business.
    expect(cbModel.removePendingFeatureDraft).toHaveBeenCalledTimes(1);
    expect(cbModel.addLinkedFeature).toHaveBeenCalledWith("cb_1", "feat_1");
  });
});
