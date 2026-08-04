import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ReqContext } from "back-end/types/request";
import {
  applyFeatureContextualBanditLinkage,
  planFeatureContextualBanditLinkage,
  reverseFeatureContextualBanditLinkage,
} from "back-end/src/util/featureContextualBanditSync";

// What each bandit's linkage should look like is decided by
// `computeContextualBanditLinkageDelta` and covered by its own table tests in
// shared. These cover the layer around it: what gets read, and what gets written.
const cbModel = {
  getLinkageCandidates: jest.fn(),
  applyLinkageDelta: jest.fn(),
  setLinkageState: jest.fn(),
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
  cbModel.getLinkageCandidates.mockResolvedValue([]);
});

describe("planFeatureContextualBanditLinkage", () => {
  it("plans off the bandits the rules reference", async () => {
    cbModel.getLinkageCandidates.mockResolvedValue([
      { id: "cb_1", linkedFeatures: [], pendingFeatureDrafts: [] },
    ]);

    const plan = await planFeatureContextualBanditLinkage(
      makeContext(),
      "feat_1",
      [],
      revision(3, ["cb_1"]).rules,
    );

    expect(cbModel.getLinkageCandidates).toHaveBeenCalledWith("feat_1", [
      "cb_1",
    ]);
    expect(plan).toEqual({
      featureId: "feat_1",
      deltas: [
        {
          contextualBanditId: "cb_1",
          link: true,
          unlink: false,
          draftsToQueue: [],
          draftsToDrop: [],
        },
      ],
      preImage: {
        cb_1: { linkedFeatures: [], pendingFeatureDrafts: [] },
      },
    });
  });

  // The sweep the old clearStale* queries did: a bandit holding linkage the
  // rules no longer justify is only discoverable by asking for it. With no
  // rules referencing anything, the query's $in clause is skipped entirely.
  it("also plans off bandits still holding linkage for the feature", async () => {
    cbModel.getLinkageCandidates.mockResolvedValue([
      {
        id: "cb_stale",
        linkedFeatures: ["feat_1"],
        pendingFeatureDrafts: [{ featureId: "feat_1", revisionVersion: 2 }],
      },
    ]);

    const plan = await planFeatureContextualBanditLinkage(
      makeContext(),
      "feat_1",
      [],
      [],
    );

    expect(cbModel.getLinkageCandidates).toHaveBeenCalledWith("feat_1", []);
    expect(plan?.deltas).toEqual([
      {
        contextualBanditId: "cb_stale",
        link: false,
        unlink: true,
        draftsToQueue: [],
        draftsToDrop: [2],
      },
    ]);
  });

  it("captures the pre-image a rewind converges on", async () => {
    cbModel.getLinkageCandidates.mockResolvedValue([
      {
        id: "cb_1",
        linkedFeatures: ["feat_1", "feat_2"],
        pendingFeatureDrafts: [{ featureId: "feat_2", revisionVersion: 8 }],
      },
    ]);

    const plan = await planFeatureContextualBanditLinkage(
      makeContext(),
      "feat_1",
      [],
      [],
    );

    expect(plan?.preImage.cb_1).toEqual({
      linkedFeatures: ["feat_1", "feat_2"],
      pendingFeatureDrafts: [{ featureId: "feat_2", revisionVersion: 8 }],
    });
  });

  it("reads referenced and stale-linked bandits in a single query", async () => {
    cbModel.getLinkageCandidates.mockResolvedValue([
      { id: "cb_1", linkedFeatures: ["feat_1"], pendingFeatureDrafts: [] },
    ]);

    await planFeatureContextualBanditLinkage(
      makeContext(),
      "feat_1",
      [revision(4, ["cb_1"])],
      revision(3, ["cb_1"]).rules,
    );

    expect(cbModel.getLinkageCandidates).toHaveBeenCalledTimes(1);
  });

  // A referenced id absent from the query result no longer exists; it is left
  // out of the delta since there is nothing to write for it.
  it("skips a referenced bandit that no longer exists", async () => {
    cbModel.getLinkageCandidates.mockResolvedValue([]);

    const plan = await planFeatureContextualBanditLinkage(
      makeContext(),
      "feat_1",
      [],
      revision(3, ["cb_gone"]).rules,
    );

    expect(plan).toBeNull();
  });

  it("returns null when the linkage already matches the rules", async () => {
    cbModel.getLinkageCandidates.mockResolvedValue([
      { id: "cb_1", linkedFeatures: ["feat_1"], pendingFeatureDrafts: [] },
    ]);

    const plan = await planFeatureContextualBanditLinkage(
      makeContext(),
      "feat_1",
      [],
      revision(3, ["cb_1"]).rules,
    );

    expect(plan).toBeNull();
  });
});

describe("applyFeatureContextualBanditLinkage", () => {
  it("writes one delta per bandit", async () => {
    const delta = {
      contextualBanditId: "cb_1",
      link: true,
      unlink: false,
      draftsToQueue: [4],
      draftsToDrop: [],
    };

    await applyFeatureContextualBanditLinkage(makeContext(), {
      featureId: "feat_1",
      deltas: [delta],
      preImage: { cb_1: { linkedFeatures: [], pendingFeatureDrafts: [] } },
    });

    expect(cbModel.applyLinkageDelta).toHaveBeenCalledWith("feat_1", delta);
  });
});

describe("reverseFeatureContextualBanditLinkage", () => {
  it("converges each bandit back to its pre-image", async () => {
    const preImage = {
      cb_1: {
        linkedFeatures: ["feat_1"],
        pendingFeatureDrafts: [{ featureId: "feat_1", revisionVersion: 2 }],
      },
    };

    await reverseFeatureContextualBanditLinkage(makeContext(), {
      featureId: "feat_1",
      deltas: [
        {
          contextualBanditId: "cb_1",
          link: false,
          unlink: true,
          draftsToQueue: [],
          draftsToDrop: [2],
        },
      ],
      preImage,
    });

    expect(cbModel.setLinkageState).toHaveBeenCalledWith(
      "cb_1",
      "feat_1",
      preImage.cb_1,
    );
  });
});
