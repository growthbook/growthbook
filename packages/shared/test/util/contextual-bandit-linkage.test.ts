import {
  ContextualBanditLinkageState,
  computeContextualBanditLinkageDelta,
  getContextualBanditIdsFromRules,
} from "../../src/util/features";
import { FeatureRule } from "../../types/feature";

function cbRule(
  contextualBanditId: string,
  id = contextualBanditId,
): FeatureRule {
  return {
    id,
    type: "contextual-bandit-ref",
    contextualBanditId,
    variations: [],
    enabled: true,
    description: "",
  } as unknown as FeatureRule;
}

function forceRule(id: string): FeatureRule {
  return {
    id,
    type: "force",
    value: "true",
    enabled: true,
    description: "",
  } as unknown as FeatureRule;
}

function state(
  overrides: Partial<ContextualBanditLinkageState> = {},
): ContextualBanditLinkageState {
  return {
    linkedFeatures: [],
    pendingFeatureDrafts: [],
    ...overrides,
  };
}

describe("getContextualBanditIdsFromRules", () => {
  it("returns only contextual-bandit-ref ids, deduped", () => {
    expect(
      getContextualBanditIdsFromRules([
        cbRule("cb_a", "r1"),
        forceRule("r2"),
        cbRule("cb_a", "r3"),
        cbRule("cb_b", "r4"),
      ]),
    ).toEqual(["cb_a", "cb_b"]);
  });

  it("reads legacy v1 rules keyed by environment", () => {
    expect(
      getContextualBanditIdsFromRules({
        production: [cbRule("cb_a", "r1")],
        staging: [forceRule("r2")],
      }),
    ).toEqual(["cb_a"]);
  });

  it("returns nothing for an empty rule set", () => {
    expect(getContextualBanditIdsFromRules([])).toEqual([]);
  });
});

describe("computeContextualBanditLinkageDelta", () => {
  it("links a bandit the live revision serves", () => {
    expect(
      computeContextualBanditLinkageDelta({
        featureId: "feat_1",
        liveRules: [cbRule("cb_1")],
        openDrafts: [],
        currentStateByBandit: { cb_1: state() },
      }),
    ).toEqual([
      {
        contextualBanditId: "cb_1",
        link: true,
        unlink: false,
        draftsToQueue: [],
        draftsToDrop: [],
      },
    ]);
  });

  // A draft reference alone isn't a link: the rule serves nobody until the
  // draft publishes, so it is tracked as a pending draft instead.
  it("queues a draft-only reference without linking it", () => {
    expect(
      computeContextualBanditLinkageDelta({
        featureId: "feat_1",
        liveRules: [],
        openDrafts: [{ version: 4, rules: [cbRule("cb_1")] }],
        currentStateByBandit: { cb_1: state() },
      }),
    ).toEqual([
      {
        contextualBanditId: "cb_1",
        link: false,
        unlink: false,
        draftsToQueue: [4],
        draftsToDrop: [],
      },
    ]);
  });

  it("keeps a live feature linked while a draft edit is queued", () => {
    expect(
      computeContextualBanditLinkageDelta({
        featureId: "feat_1",
        liveRules: [cbRule("cb_1")],
        openDrafts: [{ version: 5, rules: [cbRule("cb_1")] }],
        currentStateByBandit: {
          cb_1: state({ linkedFeatures: ["feat_1"] }),
        },
      }),
    ).toEqual([
      {
        contextualBanditId: "cb_1",
        link: false,
        unlink: false,
        draftsToQueue: [5],
        draftsToDrop: [],
      },
    ]);
  });

  // The staged-removal case: live still serves the rule, so the feature stays
  // linked, and the draft stops being something the bandit would publish.
  it("drops the queue entry for a draft that no longer references the bandit", () => {
    expect(
      computeContextualBanditLinkageDelta({
        featureId: "feat_1",
        liveRules: [cbRule("cb_1")],
        openDrafts: [{ version: 4, rules: [forceRule("r1")] }],
        currentStateByBandit: {
          cb_1: state({
            linkedFeatures: ["feat_1"],
            pendingFeatureDrafts: [{ featureId: "feat_1", revisionVersion: 4 }],
          }),
        },
      }),
    ).toEqual([
      {
        contextualBanditId: "cb_1",
        link: false,
        unlink: false,
        draftsToQueue: [],
        draftsToDrop: [4],
      },
    ]);
  });

  it("unlinks once the rule is gone from live", () => {
    expect(
      computeContextualBanditLinkageDelta({
        featureId: "feat_1",
        liveRules: [forceRule("r1")],
        openDrafts: [],
        currentStateByBandit: {
          cb_1: state({ linkedFeatures: ["feat_1"] }),
        },
      }),
    ).toEqual([
      {
        contextualBanditId: "cb_1",
        link: false,
        unlink: true,
        draftsToQueue: [],
        draftsToDrop: [],
      },
    ]);
  });

  // Subsumes the old clearStale sweeps: a bandit no revision mentions still
  // holds entries, and they all come off.
  it("sweeps a bandit no revision references any more", () => {
    expect(
      computeContextualBanditLinkageDelta({
        featureId: "feat_1",
        liveRules: [],
        openDrafts: [],
        currentStateByBandit: {
          cb_1: state({
            linkedFeatures: ["feat_1"],
            pendingFeatureDrafts: [
              { featureId: "feat_1", revisionVersion: 3 },
              { featureId: "feat_1", revisionVersion: 4 },
            ],
          }),
        },
      }),
    ).toEqual([
      {
        contextualBanditId: "cb_1",
        link: false,
        unlink: true,
        draftsToQueue: [],
        draftsToDrop: [3, 4],
      },
    ]);
  });

  it("tracks every open draft that references the bandit", () => {
    expect(
      computeContextualBanditLinkageDelta({
        featureId: "feat_1",
        liveRules: [],
        openDrafts: [
          { version: 4, rules: [cbRule("cb_1")] },
          { version: 6, rules: [cbRule("cb_1")] },
        ],
        currentStateByBandit: {
          cb_1: state({
            pendingFeatureDrafts: [{ featureId: "feat_1", revisionVersion: 4 }],
          }),
        },
      }),
    ).toEqual([
      {
        contextualBanditId: "cb_1",
        link: false,
        unlink: false,
        draftsToQueue: [6],
        draftsToDrop: [],
      },
    ]);
  });

  it("leaves other features' entries alone", () => {
    expect(
      computeContextualBanditLinkageDelta({
        featureId: "feat_1",
        liveRules: [cbRule("cb_1")],
        openDrafts: [],
        currentStateByBandit: {
          cb_1: state({
            linkedFeatures: ["feat_1", "feat_2"],
            pendingFeatureDrafts: [{ featureId: "feat_2", revisionVersion: 2 }],
          }),
        },
      }),
    ).toEqual([]);
  });

  it("returns nothing when the linkage already matches the rules", () => {
    expect(
      computeContextualBanditLinkageDelta({
        featureId: "feat_1",
        liveRules: [cbRule("cb_1")],
        openDrafts: [{ version: 7, rules: [cbRule("cb_1")] }],
        currentStateByBandit: {
          cb_1: state({
            linkedFeatures: ["feat_1"],
            pendingFeatureDrafts: [{ featureId: "feat_1", revisionVersion: 7 }],
          }),
        },
      }),
    ).toEqual([]);
  });

  it("handles several bandits independently", () => {
    expect(
      computeContextualBanditLinkageDelta({
        featureId: "feat_1",
        liveRules: [cbRule("cb_1")],
        openDrafts: [{ version: 9, rules: [cbRule("cb_2")] }],
        currentStateByBandit: {
          cb_1: state(),
          cb_2: state({ linkedFeatures: ["feat_1"] }),
        },
      }),
    ).toEqual([
      {
        contextualBanditId: "cb_1",
        link: true,
        unlink: false,
        draftsToQueue: [],
        draftsToDrop: [],
      },
      {
        contextualBanditId: "cb_2",
        link: false,
        unlink: true,
        draftsToQueue: [9],
        draftsToDrop: [],
      },
    ]);
  });
});
