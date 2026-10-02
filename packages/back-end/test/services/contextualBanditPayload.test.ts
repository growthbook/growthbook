import { ContextualBanditInterface } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { FeatureDefinition } from "shared/types/sdk";
import { GroupMap } from "shared/types/saved-group";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { getFeatureDefinition } from "back-end/src/util/features";
import { ApiReqContext } from "back-end/types/api";
import {
  buildSDKPayloadForConnection,
  filterUsedContextualBandits,
  generateAutoExperimentsPayload,
} from "back-end/src/services/features";
import {
  CbVisualExperiment,
  getContextualBanditPrerequisiteDependents,
  getCbVisualPrerequisiteIds,
  measureContextualBanditPayload,
} from "back-end/src/services/contextualBanditPayload";

// services/features.ts transitively imports datasource integrations, which
// load native modules (kerberos, lz4) that aren't available in all
// environments. Nothing in these tests touches datasources.
jest.mock("back-end/src/services/datasource", () => ({}));

const groupMap: GroupMap = new Map();
const experimentMap = new Map();
const safeRolloutMap = new Map();

function makeCb(
  overrides: Partial<ContextualBanditInterface> = {},
): ContextualBanditInterface {
  return {
    id: "cb_1",
    organization: "org_1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    project: "",
    name: "CB 1",
    trackingKey: "cb_1_tk",
    status: "running",
    stage: "exploit",
    coverage: 1,
    hashAttribute: "id",
    seed: "cb_1_seed",
    contextualAttributes: ["country", "device"],
    variations: [
      { id: "v0", name: "Control", key: "0", screenshots: [] },
      { id: "v1", name: "Treatment", key: "1", screenshots: [] },
    ],
    variationWeights: [
      { variationId: "v0", weight: 0.5 },
      { variationId: "v1", weight: 0.5 },
    ],
    currentLeafWeights: [
      {
        leafId: 0,
        condition: { country: "US" },
        weights: [
          { variationId: "v0", weight: 0.3 },
          { variationId: "v1", weight: 0.7 },
        ],
      },
      {
        leafId: 1,
        condition: { country: { $in: ["CA", "MX"] } },
        weights: [
          { variationId: "v0", weight: 0.6 },
          { variationId: "v1", weight: 0.4 },
        ],
      },
    ],
    banditVersion: 7,
    linkedFeatures: ["feature"],
    ...overrides,
  } as unknown as ContextualBanditInterface;
}

function makeFeature(
  overrides: Partial<FeatureInterface> = {},
): FeatureInterface {
  return {
    id: "feature",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    defaultValue: "control",
    organization: "org_1",
    owner: "",
    valueType: "string",
    archived: false,
    description: "",
    version: 1,
    environmentSettings: {
      production: {
        enabled: true,
        rules: [
          {
            type: "contextual-bandit-ref",
            id: "rule_1",
            description: "",
            enabled: true,
            contextualBanditId: "cb_1",
            variations: [
              { variationId: "v0", value: "control" },
              { variationId: "v1", value: "treatment" },
            ],
          },
        ],
      },
    },
    ...overrides,
  } as unknown as FeatureInterface;
}

describe("getFeatureDefinition contextual-bandit-ref rules", () => {
  it("emits a contextualBanditRef pointer instead of inline contexts", () => {
    const cb = makeCb();
    const def = getFeatureDefinition({
      feature: makeFeature(),
      environment: "production",
      groupMap,
      experimentMap,
      safeRolloutMap,
      cbMap: new Map([[cb.id, cb]]),
    });

    expect(def).toBeTruthy();
    const rule = def?.rules?.[0];
    expect(rule?.contextualBanditRef).toEqual("cb_1");
    // Sticky bucketing must be disabled — CB weights retrain each epoch
    expect(rule?.disableStickyBucketing).toEqual(true);
    // Nothing bulky on the rule — it all lives in the top-level map
    expect(rule).not.toHaveProperty("contexts");
    expect(rule).not.toHaveProperty("banditVersion");
    // Variations live under `contextualVariations` (not `variations`) so older
    // SDKs skip the rule; aggregate weights remain for the CB MAB fallback.
    expect(rule).not.toHaveProperty("variations");
    expect(rule?.contextualVariations).toEqual(["control", "treatment"]);
    expect(rule?.weights).toEqual([0.5, 0.5]);
  });

  it("does not emit a contextualBanditRef for non-capable SDKs", () => {
    const cb = makeCb();
    const def = getFeatureDefinition({
      feature: makeFeature(),
      environment: "production",
      groupMap,
      experimentMap,
      safeRolloutMap,
      cbMap: new Map([[cb.id, cb]]),
      capabilities: ["bucketingV2", "stickyBucketing"],
    });

    const rule = def?.rules?.[0];
    expect(rule).toBeTruthy();
    expect(rule).not.toHaveProperty("contextualBanditRef");
    // Non-capable SDKs get neither `contextualVariations` (stripped, CB-gated
    // key) nor `variations`, so they skip the rule instead of running a plain
    // experiment split. Weights remain but are never reached.
    expect(rule).not.toHaveProperty("contextualVariations");
    expect(rule).not.toHaveProperty("variations");
    expect(rule?.weights).toEqual([0.5, 0.5]);
    // Sticky bucketing stays disabled even for the MAB fallback (weights still
    // retrain each epoch), independent of the contextualBandits capability.
    expect(rule?.disableStickyBucketing).toEqual(true);
  });
});

describe("filterUsedContextualBandits", () => {
  const featuresWithRef: Record<string, FeatureDefinition> = {
    feature_a: {
      defaultValue: "control",
      rules: [{ contextualBanditRef: "cb_1" }],
    },
    feature_b: {
      defaultValue: "off",
      rules: [{ contextualBanditRef: "cb_1" }],
    },
  };

  it("emits one map entry per referenced CB with positional leaf weights", () => {
    const cb = makeCb();
    const map = filterUsedContextualBandits(
      new Map([[cb.id, cb]]),
      featuresWithRef,
    );

    // Two rules, ONE entry — this is the dedup
    expect(map).toEqual({
      cb_1: {
        banditVersion: 7,
        contexts: [
          { leafId: 0, condition: { country: "US" }, weights: [0.3, 0.7] },
          {
            leafId: 1,
            condition: { country: { $in: ["CA", "MX"] } },
            weights: [0.6, 0.4],
          },
        ],
      },
    });
  });

  it("prunes CBs that no emitted rule references", () => {
    const cb = makeCb();
    const unreferenced = makeCb({ id: "cb_2" });
    const map = filterUsedContextualBandits(
      new Map([
        [cb.id, cb],
        [unreferenced.id, unreferenced],
      ]),
      featuresWithRef,
    );

    expect(Object.keys(map ?? {})).toEqual(["cb_1"]);
  });

  it("returns undefined when no rules carry a ref", () => {
    const cb = makeCb();
    const map = filterUsedContextualBandits(new Map([[cb.id, cb]]), {
      plain: { defaultValue: "x", rules: [{ force: "y" }] },
    });
    expect(map).toBeUndefined();
  });

  it("returns undefined when cbMap is empty or missing", () => {
    expect(filterUsedContextualBandits(undefined, featuresWithRef)).toBe(
      undefined,
    );
    expect(filterUsedContextualBandits(new Map(), featuresWithRef)).toBe(
      undefined,
    );
  });

  it("emits empty contexts for an explore-stage CB (no leaf weights yet)", () => {
    const cb = makeCb({ currentLeafWeights: [] });
    const map = filterUsedContextualBandits(
      new Map([[cb.id, cb]]),
      featuresWithRef,
    );
    expect(map?.cb_1?.contexts).toEqual([]);
  });
});

describe("add/remove variation payload behavior (P5)", () => {
  const V0 = { id: "v0", name: "Control", key: "0", screenshots: [] };
  const V1 = { id: "v1", name: "Treatment", key: "1", screenshots: [] };
  const V2 = { id: "v2", name: "Added", key: "2", screenshots: [] };

  const cbMapOf = (cb: ContextualBanditInterface) =>
    new Map([[cb.id, cb]]) as Map<string, ContextualBanditInterface>;

  const refFeatures: Record<string, FeatureDefinition> = {
    f: { defaultValue: "x", rules: [{ contextualBanditRef: "cb_1" }] },
  };

  function featureWithValues(
    pairs: { variationId: string; value: string }[],
  ): FeatureInterface {
    return makeFeature({
      environmentSettings: {
        production: {
          enabled: true,
          rules: [
            {
              type: "contextual-bandit-ref",
              id: "rule_1",
              description: "",
              enabled: true,
              contextualBanditId: "cb_1",
              variations: pairs,
            },
          ],
        },
      },
    } as unknown as Partial<FeatureInterface>);
  }

  function ruleFor(cb: ContextualBanditInterface, feature: FeatureInterface) {
    const def = getFeatureDefinition({
      feature,
      environment: "production",
      groupMap,
      experimentMap,
      safeRolloutMap,
      cbMap: cbMapOf(cb),
    });
    return def?.rules?.[0];
  }

  it("add in explore: aggregate weights include the new arm at 1/n; contexts stay empty", () => {
    const cb = makeCb({
      stage: "explore",
      variations: [V0, V1, V2],
      variationWeights: [
        { variationId: "v0", weight: 1 / 3 },
        { variationId: "v1", weight: 1 / 3 },
        { variationId: "v2", weight: 1 / 3 },
      ],
      currentLeafWeights: [],
      banditVersion: 8,
    } as unknown as Partial<ContextualBanditInterface>);

    const rule = ruleFor(
      cb,
      featureWithValues([
        { variationId: "v0", value: "control" },
        { variationId: "v1", value: "treatment" },
        { variationId: "v2", value: "added" },
      ]),
    );

    expect(rule?.contextualVariations).toEqual([
      "control",
      "treatment",
      "added",
    ]);
    expect(rule?.weights?.length).toEqual(3);
    (rule?.weights ?? []).forEach((w) => expect(w).toBeCloseTo(1 / 3, 3));

    const map = filterUsedContextualBandits(cbMapOf(cb), refFeatures);
    expect(map?.cb_1?.banditVersion).toEqual(8);
    expect(map?.cb_1?.contexts).toEqual([]);
  });

  it("add: an arm with no linked-feature value emits null (linked feature must be updated)", () => {
    const cb = makeCb({
      stage: "explore",
      variations: [V0, V1, V2],
      variationWeights: [
        { variationId: "v0", weight: 1 / 3 },
        { variationId: "v1", weight: 1 / 3 },
        { variationId: "v2", weight: 1 / 3 },
      ],
      currentLeafWeights: [],
    } as unknown as Partial<ContextualBanditInterface>);

    const rule = ruleFor(
      cb,
      featureWithValues([
        { variationId: "v0", value: "control" },
        { variationId: "v1", value: "treatment" },
      ]),
    );

    expect(rule?.contextualVariations).toEqual(["control", "treatment", null]);
    expect(rule?.weights?.length).toEqual(3);
  });

  it("remove: the dropped arm appears nowhere in the payload", () => {
    const cb = makeCb({
      variations: [V0, V2],
      variationWeights: [
        { variationId: "v0", weight: 0.5 },
        { variationId: "v2", weight: 0.5 },
      ],
      currentLeafWeights: [
        {
          leafId: 0,
          condition: { country: "US" },
          weights: [
            { variationId: "v0", weight: 0.3 },
            { variationId: "v2", weight: 0.7 },
          ],
        },
      ],
    } as unknown as Partial<ContextualBanditInterface>);

    const rule = ruleFor(
      cb,
      featureWithValues([
        { variationId: "v0", value: "control" },
        { variationId: "v2", value: "added" },
      ]),
    );

    expect(rule?.contextualVariations).toEqual(["control", "added"]);
    expect(rule?.weights).toEqual([0.5, 0.5]);
    expect(JSON.stringify(rule)).not.toContain("treatment");

    const map = filterUsedContextualBandits(cbMapOf(cb), refFeatures);
    expect(map?.cb_1?.contexts).toEqual([
      { leafId: 0, condition: { country: "US" }, weights: [0.3, 0.7] },
    ]);
  });

  it("positional: an arm with no stored leaf weight resolves to 0 in that leaf", () => {
    const cb = makeCb({
      variations: [V0, V1, V2],
      variationWeights: [
        { variationId: "v0", weight: 1 / 3 },
        { variationId: "v1", weight: 1 / 3 },
        { variationId: "v2", weight: 1 / 3 },
      ],
      currentLeafWeights: [
        {
          leafId: 0,
          condition: { country: "US" },
          weights: [
            { variationId: "v0", weight: 0.3 },
            { variationId: "v1", weight: 0.7 },
          ],
        },
      ],
    } as unknown as Partial<ContextualBanditInterface>);

    const map = filterUsedContextualBandits(cbMapOf(cb), refFeatures);
    expect(map?.cb_1?.contexts?.[0]?.weights).toEqual([0.3, 0.7, 0]);
  });
});

describe("pending / deactivated leaf-weight alignment", () => {
  // Leaf weights must positionalize over the same active list as the rule.
  // Length mismatch → SDK falls back to equal weights (getBucketRanges).
  const V0 = { id: "v0", name: "Control", key: "0", screenshots: [] };
  const V1 = { id: "v1", name: "Treatment", key: "1", screenshots: [] };
  const V2 = { id: "v2", name: "Added", key: "2", screenshots: [] };

  const cbMapOf = (cb: ContextualBanditInterface) =>
    new Map([[cb.id, cb]]) as Map<string, ContextualBanditInterface>;
  const refFeatures: Record<string, FeatureDefinition> = {
    f: { defaultValue: "x", rules: [{ contextualBanditRef: "cb_1" }] },
  };

  function featureWithValues(
    pairs: { variationId: string; value: string }[],
  ): FeatureInterface {
    return makeFeature({
      environmentSettings: {
        production: {
          enabled: true,
          rules: [
            {
              type: "contextual-bandit-ref",
              id: "rule_1",
              description: "",
              enabled: true,
              contextualBanditId: "cb_1",
              variations: pairs,
            },
          ],
        },
      },
    } as unknown as Partial<FeatureInterface>);
  }

  function ruleFor(cb: ContextualBanditInterface, feature: FeatureInterface) {
    return getFeatureDefinition({
      feature,
      environment: "production",
      groupMap,
      experimentMap,
      safeRolloutMap,
      cbMap: cbMapOf(cb),
    })?.rules?.[0];
  }

  it("middle-array pending arm: rule and leaf both length 2, split lands on v0/v2", () => {
    const cb = makeCb({
      variations: [V0, { ...V1, status: "pending" }, V2],
      variationWeights: [
        { variationId: "v0", weight: 0.4 },
        { variationId: "v2", weight: 0.6 },
      ],
      currentLeafWeights: [
        {
          leafId: 0,
          condition: { country: "US" },
          weights: [
            { variationId: "v0", weight: 0.2 },
            { variationId: "v2", weight: 0.8 },
          ],
        },
      ],
    } as unknown as Partial<ContextualBanditInterface>);

    const rule = ruleFor(
      cb,
      featureWithValues([
        { variationId: "v0", value: "control" },
        { variationId: "v1", value: "treatment" },
        { variationId: "v2", value: "added" },
      ]),
    );

    expect(rule?.contextualVariations).toEqual(["control", "added"]);
    expect(rule?.weights).toEqual([0.4, 0.6]);

    const leaf = filterUsedContextualBandits(cbMapOf(cb), refFeatures)?.cb_1
      ?.contexts?.[0];
    expect(leaf?.weights?.length).toEqual(rule?.contextualVariations?.length);
    expect(leaf?.weights).toEqual([0.2, 0.8]);
  });

  it("tail deactivated tombstone: length parity + values not shifted by the tombstone", () => {
    const cb = makeCb({
      variations: [V0, V2, { ...V1, status: "deactivated" }],
      variationWeights: [
        { variationId: "v0", weight: 0.5 },
        { variationId: "v2", weight: 0.5 },
      ],
      currentLeafWeights: [
        {
          leafId: 0,
          condition: { country: "US" },
          weights: [
            { variationId: "v0", weight: 0.3 },
            { variationId: "v2", weight: 0.7 },
          ],
        },
      ],
    } as unknown as Partial<ContextualBanditInterface>);

    const rule = ruleFor(
      cb,
      featureWithValues([
        { variationId: "v0", value: "control" },
        { variationId: "v1", value: "treatment" },
        { variationId: "v2", value: "added" },
      ]),
    );

    expect(rule?.contextualVariations).toEqual(["control", "added"]);
    expect(rule?.weights).toEqual([0.5, 0.5]);
    expect(JSON.stringify(rule)).not.toContain("treatment");

    const leaf = filterUsedContextualBandits(cbMapOf(cb), refFeatures)?.cb_1
      ?.contexts?.[0];
    expect(leaf?.weights?.length).toEqual(rule?.contextualVariations?.length);
    expect(leaf?.weights).toEqual([0.3, 0.7]);
  });

  it("pending + deactivated combined: both drop cleanly", () => {
    const V_OLD = { id: "v_old", name: "Old", key: "9", screenshots: [] };
    const cb = makeCb({
      variations: [
        V0,
        { ...V1, status: "pending" },
        V2,
        { ...V_OLD, status: "deactivated" },
      ],
      variationWeights: [
        { variationId: "v0", weight: 0.4 },
        { variationId: "v2", weight: 0.6 },
      ],
      currentLeafWeights: [
        {
          leafId: 0,
          condition: { country: "US" },
          weights: [
            { variationId: "v0", weight: 0.25 },
            { variationId: "v2", weight: 0.75 },
          ],
        },
      ],
    } as unknown as Partial<ContextualBanditInterface>);

    const rule = ruleFor(
      cb,
      featureWithValues([
        { variationId: "v0", value: "control" },
        { variationId: "v1", value: "treatment" },
        { variationId: "v2", value: "added" },
        { variationId: "v_old", value: "old" },
      ]),
    );

    expect(rule?.contextualVariations).toEqual(["control", "added"]);

    const leaf = filterUsedContextualBandits(cbMapOf(cb), refFeatures)?.cb_1
      ?.contexts?.[0];
    expect(leaf?.weights?.length).toEqual(rule?.contextualVariations?.length);
    expect(leaf?.weights).toEqual([0.25, 0.75]);
  });
});

describe("measureContextualBanditPayload", () => {
  const smallEntry = {
    banditVersion: 1,
    contexts: [{ leafId: 0, condition: { country: "US" }, weights: [1, 0] }],
  };
  const bigEntry = {
    banditVersion: 2,
    contexts: [
      {
        leafId: 0,
        condition: { country: { $in: ["US", "CA", "MX", "DE", "FR"] } },
        weights: [0.5, 0.5],
      },
      { leafId: 1, condition: {}, weights: [0.4, 0.6] },
      { leafId: 2, condition: { country: "GB" }, weights: [0.7, 0.3] },
    ],
  };

  it("counts distinct CBs, referencing rules, bytes, and max leaves", () => {
    const stats = measureContextualBanditPayload(
      { cb_small: smallEntry, cb_big: bigEntry },
      {
        f1: {
          defaultValue: "x",
          rules: [{ contextualBanditRef: "cb_small" }],
        },
        f2: {
          defaultValue: "y",
          rules: [{ contextualBanditRef: "cb_big" }, { force: "z" }],
        },
        f3: {
          defaultValue: "z",
          rules: [{ contextualBanditRef: "cb_big" }],
        },
      },
    );

    expect(stats.cbCount).toEqual(2);
    // 3 rules point at the map; ratio 3:2 shows a shared CB
    expect(stats.cbRuleCount).toEqual(3);
    expect(stats.maxLeaves).toEqual(3);

    const smallBytes = Buffer.byteLength(
      JSON.stringify({ cb_small: smallEntry }),
    );
    const bigBytes = Buffer.byteLength(JSON.stringify({ cb_big: bigEntry }));
    expect(stats.cbBytes).toEqual(smallBytes + bigBytes);
    expect(stats.maxSingleCbBytes).toEqual(bigBytes);
  });

  it("handles features with no CB rules", () => {
    const stats = measureContextualBanditPayload(
      { cb_small: smallEntry },
      { plain: { defaultValue: "x", rules: [{ force: "y" }] } },
    );
    expect(stats.cbCount).toEqual(1);
    expect(stats.cbRuleCount).toEqual(0);
    expect(stats.cbBytes).toBeGreaterThan(0);
  });

  it("returns zeros for an empty map", () => {
    const stats = measureContextualBanditPayload({}, {});
    expect(stats).toEqual({
      cbCount: 0,
      cbRuleCount: 0,
      cbBytes: 0,
      maxSingleCbBytes: 0,
      maxLeaves: 0,
    });
  });
});

describe("CB visual changesets in the auto-experiments payload", () => {
  const V0 = { id: "v0", name: "Control", key: "0", screenshots: [] };
  const V1 = { id: "v1", name: "Treatment", key: "1", screenshots: [] };
  const V2 = { id: "v2", name: "Added", key: "2", screenshots: [] };

  function makeChangeset(
    variationIds: string[],
    overrides: Partial<VisualChangesetInterface> = {},
  ): VisualChangesetInterface {
    return {
      id: "vcs_1",
      organization: "org_1",
      contextualBandit: "cb_1",
      editorUrl: "https://example.com/",
      urlPatterns: [
        { include: true, type: "simple", pattern: "https://example.com/" },
      ],
      visualChanges: variationIds.map((id) => ({
        id: `vc_${id}`,
        variation: id,
        description: "",
        css: id === "v0" ? "" : `.${id} { display: block; }`,
        domMutations: [],
      })),
      ...overrides,
    } as VisualChangesetInterface;
  }

  function payloadFor(
    cb: ContextualBanditInterface,
    vcs: VisualChangesetInterface,
  ) {
    return generateAutoExperimentsPayload({
      visualExperiments: [],
      urlRedirectExperiments: [],
      cbVisualExperiments: [
        { type: "cb-visual", contextualBandit: cb, visualChangeset: vcs },
      ],
      groupMap,
      features: [],
      environment: "production",
      capabilities: ["contextualBandits", "contextualBanditsAuto"],
      includeExperimentNames: true,
    });
  }

  it("emits one entry per changeset, keyed by the CB tracking key with its ref", () => {
    const cb = makeCb({ variations: [V0, V1], hasVisualChangesets: true });
    const [exp] = payloadFor(cb, makeChangeset(["v0", "v1"]));
    expect(exp).toMatchObject({
      key: "cb_1_tk",
      contextualBanditRef: "cb_1",
      disableStickyBucketing: true,
      hashVersion: 2,
      hashAttribute: "id",
      status: "running",
    });
    expect(exp.variations).toHaveLength(2);
    expect(exp.meta).toEqual([
      { key: "0", name: "Control" },
      { key: "1", name: "Treatment" },
    ]);
    expect(exp.variations[1]).toMatchObject({ css: ".v1 { display: block; }" });
  });

  it("emits nothing for a changeset with no visual content", () => {
    const cb = makeCb({ variations: [V0, V1], hasVisualChangesets: true });
    const empty = makeChangeset(["v0", "v1"], {
      visualChanges: ["v0", "v1"].map((id) => ({
        id: `vc_${id}`,
        variation: id,
        description: "",
        css: "",
        domMutations: [],
      })),
    });
    expect(payloadFor(cb, empty)).toHaveLength(0);
  });

  it("emits nothing for a draft CB", () => {
    const cb = makeCb({ status: "draft", hasVisualChangesets: true });
    expect(payloadFor(cb, makeChangeset(["v0", "v1"]))).toHaveLength(0);
  });

  it("serves nothing to an SDK without contextualBanditsAuto", () => {
    const cb = makeCb({ hasVisualChangesets: true });
    const payload = generateAutoExperimentsPayload({
      visualExperiments: [],
      urlRedirectExperiments: [],
      cbVisualExperiments: [
        {
          type: "cb-visual",
          contextualBandit: cb,
          visualChangeset: makeChangeset(["v0", "v1"]),
        },
      ],
      groupMap,
      features: [],
      environment: "production",
      capabilities: ["contextualBandits"],
    });
    expect(payload).toHaveLength(0);
  });

  it("serves only active arms, in the same positions as the leaf weights", () => {
    const cb = makeCb({
      variations: [
        V0,
        { ...V1, status: "pending" },
        V2,
        {
          ...{ id: "v3", name: "Gone", key: "3", screenshots: [] },
          status: "deactivated",
        },
      ],
      variationWeights: [
        { variationId: "v0", weight: 0.5 },
        { variationId: "v2", weight: 0.5 },
      ],
      currentLeafWeights: [
        {
          leafId: 0,
          condition: { country: "US" },
          weights: [
            { variationId: "v0", weight: 0.2 },
            { variationId: "v2", weight: 0.8 },
          ],
        },
      ],
      hasVisualChangesets: true,
    } as unknown as Partial<ContextualBanditInterface>);
    const vcs = makeChangeset(["v0", "v1", "v2", "v3"]);
    const [exp] = payloadFor(cb, vcs);

    expect(exp.meta?.map((m) => m.key)).toEqual(["0", "2"]);
    expect(exp.variations).toHaveLength(2);
    expect(exp.variations[1]).toMatchObject({ css: ".v2 { display: block; }" });
    expect(exp.weights).toEqual([0.5, 0.5]);

    const map = filterUsedContextualBandits(new Map([[cb.id, cb]]), {}, [exp]);
    expect(map?.cb_1.contexts[0].weights).toEqual([0.2, 0.8]);
    expect(map?.cb_1.contexts[0].weights).toHaveLength(exp.variations.length);
  });

  it("emits nothing when no arm is active", () => {
    const cb = makeCb({
      variations: [
        { ...V0, status: "deactivated" },
        { ...V1, status: "pending" },
      ],
      hasVisualChangesets: true,
    } as unknown as Partial<ContextualBanditInterface>);
    expect(payloadFor(cb, makeChangeset(["v0", "v1"]))).toHaveLength(0);
  });
});

describe("CB visual prerequisites in another project", () => {
  const prerequisite = { id: "parent", condition: '{"value": true}' };

  function cbVisual(
    cb: ContextualBanditInterface,
    id = "vcs_1",
  ): CbVisualExperiment {
    return {
      type: "cb-visual",
      contextualBandit: cb,
      visualChangeset: {
        id,
        organization: "org_1",
        contextualBandit: cb.id,
        editorUrl: "https://example.com/",
        urlPatterns: [
          { include: true, type: "simple", pattern: "https://example.com/" },
        ],
        visualChanges: ["v0", "v1"].map((v) => ({
          id: `vc_${v}`,
          variation: v,
          description: "",
          css: v === "v0" ? "" : `.${v} { display: block; }`,
          domMutations: [],
        })),
      } as VisualChangesetInterface,
    };
  }

  const parent = {
    id: "parent",
    project: "prj_b",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    defaultValue: "true",
    organization: "org_1",
    owner: "",
    valueType: "boolean",
    archived: false,
    description: "",
    version: 1,
    environmentSettings: {
      production: {
        enabled: true,
        rules: [
          {
            type: "experiment",
            id: "parent-exp",
            enabled: true,
            coverage: 1,
            values: [
              { value: "false", weight: 0.5 },
              { value: "true", weight: 0.5 },
            ],
            hashAttribute: "id",
          },
        ],
      },
    },
  } as unknown as FeatureInterface;

  const gatedCb = () =>
    makeCb({
      project: "prj_a",
      hasVisualChangesets: true,
      prerequisites: [prerequisite],
    } as unknown as Partial<ContextualBanditInterface>);

  const context = {
    org: { id: "org_1", name: "Org", settings: {} },
    models: {},
  } as unknown as ApiReqContext;

  function build(includeReferencedPrerequisites: boolean) {
    return buildSDKPayloadForConnection({
      context,
      connection: {
        capabilities: [
          "bucketingV2",
          "prerequisites",
          "contextualBandits",
          "contextualBanditsAuto",
        ],
        environment: "production",
        projects: ["prj_a"],
        includeReferencedPrerequisites,
        includeVisualExperiments: true,
      },
      data: {
        features: [parent],
        experimentMap: new Map(),
        groupMap: new Map(),
        safeRolloutMap: new Map(),
        savedGroups: [],
        holdoutsMap: new Map(),
        visualExperiments: [],
        urlRedirectExperiments: [],
        cbVisualExperiments: [cbVisual(gatedCb())],
      },
    });
  }

  it("carries the parent so the gated visual experiment is served", async () => {
    const out = await build(true);

    expect(out.features.parent).toBeDefined();
    expect(out.experiments).toHaveLength(1);
    expect(out.experiments?.[0].parentConditions).toEqual([
      expect.objectContaining({ id: "parent" }),
    ]);
  });

  it("drops the gated visual experiment when the parent is not carried", async () => {
    const out = await build(false);

    expect(out.features.parent).toBeUndefined();
    expect(out.experiments ?? []).toHaveLength(0);
  });

  it("collects each bandit's prerequisites once across its changesets", () => {
    const cb = gatedCb();
    expect(
      getCbVisualPrerequisiteIds([cbVisual(cb), cbVisual(cb, "vcs_2")]),
    ).toEqual(["parent"]);
  });

  it("collects prerequisites only for bandits the connection will serve", () => {
    const cb = gatedCb();
    const draft = { ...cb, status: "draft" as const };
    const empty = cbVisual(cb, "vcs_empty");
    empty.visualChangeset.visualChanges =
      empty.visualChangeset.visualChanges.map((c) => ({
        ...c,
        css: "",
        js: "",
        domMutations: [],
      }));
    expect(getCbVisualPrerequisiteIds([cbVisual(draft)])).toEqual([]);
    expect(getCbVisualPrerequisiteIds([empty])).toEqual([]);
    expect(
      getCbVisualPrerequisiteIds([cbVisual(cb)], ["prerequisites"]),
    ).toEqual([]);
    expect(
      getCbVisualPrerequisiteIds(
        [cbVisual(cb)],
        ["prerequisites", "contextualBanditsAuto"],
      ),
    ).toEqual(["parent"]);
  });

  it("lists bandits with a project and prerequisites as dependents", () => {
    expect(
      getContextualBanditPrerequisiteDependents([
        gatedCb(),
        makeCb({
          id: "cb_2",
          prerequisites: [prerequisite],
        } as unknown as Partial<ContextualBanditInterface>),
        makeCb({ id: "cb_3", project: "prj_c" }),
      ]),
    ).toEqual([{ projects: ["prj_a"], prerequisiteIds: ["parent"] }]);
  });
});
