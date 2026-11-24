import { GrowthBook } from "@growthbook/growthbook";
import { ExperimentInterface, ExperimentPhase } from "shared/types/experiment";
import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import { SavedGroupPayloadStrategy } from "shared/sdk-versioning/saved-groups/types";
import { FeatureInterface } from "shared/types/feature";
import { qaOverrideAppliesToConnection } from "shared/util";
import {
  getFeatureDefinition,
  mergeConditionAndSavedGroups,
} from "../../src/util/features";
import {
  excludeQaMatches,
  planQaOverrides,
  planQaOverridesByExperiment,
  targetingOf,
} from "../../src/util/qaOverrides";
import {
  applyExperimentHashing,
  applyFeatureHashing,
  generateAutoExperimentsPayload,
  getFeatureDefinitionsResponse,
  getUsedSavedGroupIds,
  qaOverridesForConnection,
} from "../../src/services/features";

const savedGroupStrategy = {
  format: "referencesV1",
  groupMap: new Map([
    ["grp_qa", { type: "list", attributeKey: "id", hasValues: true }],
  ]),
  createCondition: ({ groupId, include }) =>
    include ? { id: { $inGroup: groupId } } : { id: { $notInGroup: groupId } },
  createSavedGroupsOperatorHandler: () => () => undefined,
  finalizeCondition: () => undefined,
} as unknown as SavedGroupPayloadStrategy;

const compileTargeting: Parameters<
  typeof planQaOverrides
>[0]["compileTargeting"] = (targeting) =>
  mergeConditionAndSavedGroups({ savedGroupStrategy, ...targeting });

const usPhase = {
  condition: '{"country":"US"}',
  coverage: 0.5,
  variationWeights: [0.34, 0.33, 0.33],
  seed: "phase-seed",
  namespace: { enabled: true, name: "ns", range: [0, 0.5] },
  prerequisites: [{ id: "parent", condition: '{"value":true}' }],
} as unknown as ExperimentPhase;

const experiment = {
  id: "exp_1",
  status: "draft",
  trackingKey: "checkout",
  variations: [
    { id: "v0", key: "0", name: "Control" },
    { id: "v1", key: "1", name: "One-page" },
    { id: "v2", key: "2", name: "Apple Pay" },
  ],
  phases: [usPhase],
} as unknown as ExperimentInterface;

const forcedOverride: ExperimentQaOverrideInterface = {
  id: "eqo_1",
  organization: "org",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  experiment: "exp_1",
  environment: "dev",
  order: 0,
  filters: {},
  assignment: { type: "forced", variationId: "v1" },
  createdBy: "u_1",
};
const randomOverride: ExperimentQaOverrideInterface = {
  ...forcedOverride,
  id: "eqo_2",
  assignment: { type: "random" },
};
const removedVariationOverride: ExperimentQaOverrideInterface = {
  ...forcedOverride,
  id: "eqo_3",
  assignment: { type: "forced", variationId: "gone" },
};
const withFilters = (
  override: ExperimentQaOverrideInterface,
  filters: ExperimentQaOverrideInterface["filters"],
  id = override.id,
): ExperimentQaOverrideInterface => ({ ...override, id, filters });

const plansFor = (
  exp: ExperimentInterface,
  overrides: ExperimentQaOverrideInterface[],
) =>
  planQaOverridesByExperiment({
    experiments: new Map([[exp.id, exp]]),
    overrides: new Map([[exp.id, overrides]]),
    compileTargeting,
  });

describe("planQaOverrides", () => {
  const plan = (overrides: ExperimentQaOverrideInterface[]) =>
    planQaOverrides({ experiment, overrides, compileTargeting });

  it("serves the experiment as configured for random assignment with no targeting", () => {
    const [serving] = plan([randomOverride]);
    expect(serving.phase).toBe(usPhase);
    expect(serving.match).toEqual({ country: "US" });
    expect(serving.exclude).toBeUndefined();
  });

  it("forces one variation for everyone when there is no targeting", () => {
    const [serving] = plan([forcedOverride]);
    expect(serving.phase).toMatchObject({
      condition: "",
      coverage: 1,
      variationWeights: [0, 1, 0],
      seed: "phase-seed",
    });
    expect(serving.phase.savedGroups).toBeUndefined();
    expect(serving.phase.namespace).toBeUndefined();
    expect(serving.phase.prerequisites).toBeUndefined();
    expect(serving.match).toBeUndefined();
  });

  it("replaces the experiment's targeting, traffic split, namespace and prerequisites when the override has targeting of its own", () => {
    const filters = {
      condition: '{"email":{"$in":["a@x.com"]}}',
      savedGroups: [{ match: "all" as const, ids: ["grp_qa"] }],
    };
    const match = {
      $and: [{ email: { $in: ["a@x.com"] } }, { id: { $inGroup: "grp_qa" } }],
    };

    const [random] = plan([withFilters(randomOverride, filters)]);
    expect(random.phase).toMatchObject({
      ...filters,
      coverage: 1,
      variationWeights: [0.34, 0.33, 0.33],
    });
    expect(random.phase.namespace).toBeUndefined();
    expect(random.phase.prerequisites).toBeUndefined();
    expect(random.match).toEqual(match);

    const [forced] = plan([withFilters(forcedOverride, filters)]);
    expect(forced.phase).toMatchObject({
      ...filters,
      coverage: 1,
      variationWeights: [0, 1, 0],
    });
    expect(forced.match).toEqual(match);
  });

  it("counts a Saved Group alone as targeting, but not connection or project filters", () => {
    const [grouped] = plan([
      withFilters(randomOverride, {
        savedGroups: [{ match: "all", ids: ["grp_qa"] }],
      }),
    ]);
    expect(grouped.phase.condition).toBe("");
    expect(grouped.match).toEqual({ id: { $inGroup: "grp_qa" } });

    const [scoped] = plan([
      withFilters(randomOverride, { sdkConnections: ["sdk"], projects: ["p"] }),
    ]);
    expect(scoped.phase).toBe(usPhase);
  });

  it("gives each tester the first override they match", () => {
    const servings = plan([
      withFilters(forcedOverride, { condition: '{"id":"123"}' }, "a"),
      withFilters(randomOverride, { condition: '{"country":"CA"}' }, "b"),
      withFilters(randomOverride, {}, "c"),
    ]);
    expect(servings.map((s) => s.exclude)).toEqual([
      undefined,
      { $not: { id: "123" } },
      { $not: { $or: [{ id: "123" }, { country: "CA" }] } },
    ]);
  });

  it("excludes by targeting, whatever the traffic split of the earlier override", () => {
    const servings = plan([randomOverride, forcedOverride]);
    expect(servings[0].phase.coverage).toBe(0.5);
    expect(servings[1].exclude).toEqual({ $not: { country: "US" } });
  });

  it("stops after an override that matches everyone", () => {
    expect(
      plan([forcedOverride, randomOverride]).map((s) => s.override.id),
    ).toEqual(["eqo_1"]);
  });

  it("does not serve an override whose variation was removed, or let it block the ones below", () => {
    const servings = plan([removedVariationOverride, randomOverride]);
    expect(servings.map((s) => s.override.id)).toEqual(["eqo_2"]);
    expect(servings[0].exclude).toBeUndefined();
  });

  it("hands out copies of the earlier conditions", () => {
    const servings = plan([
      withFilters(forcedOverride, { condition: '{"id":"123"}' }),
      randomOverride,
    ]);
    expect(servings[1].exclude).toEqual({ $not: { id: "123" } });
    expect((servings[1].exclude as { $not: unknown }).$not).not.toBe(
      servings[0].match,
    );
  });
});

describe("planQaOverridesByExperiment", () => {
  it("plans drafts only and leaves out experiments with nothing to serve", () => {
    const running = { ...experiment, id: "exp_2", status: "running" };
    const removedOnly = { ...experiment, id: "exp_3" };
    const plans = planQaOverridesByExperiment({
      experiments: new Map(
        [experiment, running, removedOnly].map((e) => [
          e.id,
          e as ExperimentInterface,
        ]),
      ),
      overrides: new Map([
        ["exp_1", [forcedOverride]],
        ["exp_2", [forcedOverride]],
        ["exp_3", [removedVariationOverride]],
        ["exp_missing", [forcedOverride]],
      ]),
      compileTargeting,
    });
    expect([...(plans?.keys() ?? [])]).toEqual(["exp_1"]);
  });

  it("is undefined when nothing is served", () => {
    expect(
      planQaOverridesByExperiment({
        experiments: new Map(),
        overrides: undefined,
        compileTargeting,
      }),
    ).toBeUndefined();
  });
});

describe("excludeQaMatches", () => {
  it("is undefined with nothing to exclude and null once one matches everyone", () => {
    expect(excludeQaMatches([])).toBeUndefined();
    expect(excludeQaMatches([{ id: "a" }, undefined])).toBeNull();
  });

  it("negates one condition, or the OR of several", () => {
    expect(excludeQaMatches([{ id: "a" }])).toEqual({ $not: { id: "a" } });
    expect(excludeQaMatches([{ id: "a" }, { email: "b" }])).toEqual({
      $not: { $or: [{ id: "a" }, { email: "b" }] },
    });
  });
});

describe("qaOverrideAppliesToConnection", () => {
  const connection = { id: "sdk_1", environment: "dev", projects: ["p1"] };

  it("requires the same environment", () => {
    expect(qaOverrideAppliesToConnection(forcedOverride, connection)).toBe(
      true,
    );
    expect(
      qaOverrideAppliesToConnection(forcedOverride, {
        ...connection,
        environment: "staging",
      }),
    ).toBe(false);
  });

  it("honors the connection filter", () => {
    const override = {
      ...forcedOverride,
      filters: { sdkConnections: ["sdk_2"] },
    };
    expect(qaOverrideAppliesToConnection(override, connection)).toBe(false);
    expect(
      qaOverrideAppliesToConnection(override, { ...connection, id: "sdk_2" }),
    ).toBe(true);
  });

  it("honors the project filter, treating an unscoped connection as matching", () => {
    const override = { ...forcedOverride, filters: { projects: ["p2"] } };
    expect(qaOverrideAppliesToConnection(override, connection)).toBe(false);
    expect(
      qaOverrideAppliesToConnection(override, { ...connection, projects: [] }),
    ).toBe(true);
    expect(
      qaOverrideAppliesToConnection(override, {
        ...connection,
        projects: ["p1", "p2"],
      }),
    ).toBe(true);
  });
});

describe("getFeatureDefinition with QA overrides", () => {
  const draftExperiment = {
    id: "exp_1",
    archived: false,
    status: "draft",
    trackingKey: "checkout",
    hashAttribute: "id",
    hashVersion: 2,
    variations: [
      { id: "v0", key: "0", name: "Control" },
      { id: "v1", key: "1", name: "One-page" },
    ],
    phases: [
      {
        condition: '{"country":"US"}',
        coverage: 1,
        variationWeights: [0.5, 0.5],
        seed: "phase-seed",
      },
    ],
    linkedFeatures: ["feature"],
  } as unknown as ExperimentInterface;
  const withPhase = (phase: Partial<ExperimentPhase>) =>
    ({
      ...draftExperiment,
      phases: [{ ...draftExperiment.phases[0], ...phase }],
    }) as ExperimentInterface;

  const feature = {
    id: "feature",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    defaultValue: "default",
    organization: "org",
    owner: "",
    valueType: "string",
    archived: false,
    description: "",
    version: 1,
    environmentSettings: {
      dev: {
        enabled: true,
        rules: [
          {
            type: "experiment-ref",
            experimentId: "exp_1",
            description: "",
            id: "fr_abc",
            enabled: true,
            variations: [
              { variationId: "v0", value: "control" },
              { variationId: "v1", value: "one-page" },
            ],
          },
        ],
      },
    },
  } as unknown as FeatureInterface;

  const build = (
    overrides: ExperimentQaOverrideInterface[] = [],
    {
      exp = draftExperiment,
      ...extra
    }: Partial<Parameters<typeof getFeatureDefinition>[0]> & {
      exp?: ExperimentInterface;
    } = {},
  ) =>
    getFeatureDefinition({
      feature,
      environment: "dev",
      groupMap: new Map(),
      experimentMap: new Map([["exp_1", exp]]),
      safeRolloutMap: new Map(),
      capabilities: ["looseUnmarshalling", "prerequisites"],
      includeRuleIds: true,
      qaPlans: plansFor(exp, overrides),
      ...extra,
    });

  const evaluate = (
    def: ReturnType<typeof build>,
    attributes: Record<string, string>,
  ) => {
    if (!def) throw new Error("Feature is not in the payload");
    return new GrowthBook({
      attributes,
      features: { feature: def },
    }).evalFeature("feature");
  };

  it("serves nothing for a draft without overrides", () => {
    expect(build()?.rules ?? []).toEqual([]);
  });

  it("emits one rule per override, in order, on the QA key with the live seed", () => {
    const def = build([
      withFilters(forcedOverride, { condition: '{"id":"tester"}' }),
      randomOverride,
    ]);
    expect(def?.rules).toHaveLength(2);
    expect(def?.rules?.[0]).toMatchObject({
      id: "fr_abc",
      key: "checkout::qa",
      seed: "phase-seed",
      condition: { id: "tester" },
      weights: [0, 1],
      coverage: 1,
      disableStickyBucketing: true,
    });
    expect(def?.rules?.[1]).toMatchObject({
      id: "fr_abc",
      key: "checkout::qa",
      seed: "phase-seed",
      condition: { $and: [{ country: "US" }, { $not: { id: "tester" } }] },
      weights: [0.5, 0.5],
      coverage: 1,
    });
  });

  it("falls back to the tracking key as seed when the phase has none", () => {
    const def = build([forcedOverride], {
      exp: withPhase({ seed: undefined }),
    });
    expect(def?.rules?.[0]?.seed).toBe("checkout");
  });

  it("serves the experiment's targeting first, then an override for Canada", () => {
    const def = build([
      randomOverride,
      withFilters(forcedOverride, { condition: '{"country":"CA"}' }),
    ]);
    expect(evaluate(def, { id: "1", country: "CA" })).toMatchObject({
      value: "one-page",
      source: "experiment",
    });
    expect(evaluate(def, { id: "1", country: "US" }).source).toBe("experiment");
    expect(evaluate(def, { id: "1", country: "FR" })).toMatchObject({
      value: "default",
      source: "defaultValue",
    });
  });

  it("lets a tester who does not match the first override reach the experiment's targeting below it", () => {
    const def = build([
      withFilters(forcedOverride, { condition: '{"id":"123"}' }),
      randomOverride,
    ]);
    expect(evaluate(def, { id: "123", country: "FR" }).value).toBe("one-page");
    expect(evaluate(def, { id: "234", country: "US" }).source).toBe(
      "experiment",
    );
    expect(evaluate(def, { id: "234", country: "FR" }).source).toBe(
      "defaultValue",
    );
  });

  it("gives nothing to a tester who matches an override but is not bucketed", () => {
    const def = build([randomOverride, forcedOverride], {
      exp: withPhase({ coverage: 0 }),
    });
    expect(evaluate(def, { id: "1", country: "US" }).source).toBe(
      "defaultValue",
    );
    expect(evaluate(def, { id: "1", country: "FR" }).value).toBe("one-page");
  });

  it("drops the namespace and prerequisites for an override with its own targeting, and keeps them for the experiment as configured", () => {
    const exp = withPhase({
      namespace: { enabled: true, name: "ns", range: [0, 0.5] },
      prerequisites: [{ id: "parent", condition: '{"value":true}' }],
    });
    const def = build(
      [
        withFilters(randomOverride, { condition: '{"id":"123"}' }),
        randomOverride,
      ],
      { exp },
    );
    expect(def?.rules?.[0]?.namespace).toBeUndefined();
    expect(def?.rules?.[0]?.parentConditions).toBeUndefined();
    expect(def?.rules?.[1]?.namespace).toEqual(["ns", 0, 0.5]);
    expect(def?.rules?.[1]?.parentConditions).toEqual([
      { id: "parent", condition: { value: true } },
    ]);
  });

  it("does not serve an override whose variation was removed", () => {
    expect(build([removedVariationOverride])?.rules ?? []).toEqual([]);
    expect(
      build([removedVariationOverride, randomOverride])?.rules,
    ).toHaveLength(1);
  });

  it("without the prerequisites capability, serves the flag only when no override keeps the experiment's prerequisites", () => {
    const exp = withPhase({
      prerequisites: [{ id: "parent", condition: '{"value":true}' }],
    });
    const capabilities: Parameters<
      typeof getFeatureDefinition
    >[0]["capabilities"] = ["looseUnmarshalling"];

    const forcedOnly = build([forcedOverride], { exp, capabilities });
    expect(forcedOnly?.rules).toHaveLength(1);
    expect(forcedOnly?.rules?.[0]?.parentConditions).toBeUndefined();
    expect(
      forcedOnly?.rules?.[0]?.metadata?.qaOverride?.parentConditions,
    ).toEqual([{ id: "parent", condition: { value: true } }]);

    const ownTargeting = build(
      [withFilters(randomOverride, { condition: '{"id":"123"}' })],
      { exp, capabilities },
    );
    expect(ownTargeting?.rules).toHaveLength(1);

    expect(
      build(
        [
          withFilters(forcedOverride, { condition: '{"id":"123"}' }),
          randomOverride,
        ],
        { exp, capabilities },
      ),
    ).toBeNull();
  });

  describe("metadata", () => {
    const exp = withPhase({
      coverage: 0.5,
      namespace: { enabled: true, name: "ns", range: [0, 0.5] },
      prerequisites: [{ id: "parent", condition: '{"value":true}' }],
    });

    it("describes the override and the experiment's own configuration, whatever the metadata options", () => {
      const def = build(
        [withFilters(forcedOverride, { condition: '{"id":"tester"}' })],
        { exp },
      );
      expect(def?.rules?.[0]).toMatchObject({
        key: "checkout::qa",
        condition: { id: "tester" },
        coverage: 1,
        weights: [0, 1],
      });
      expect(def?.rules?.[0]?.metadata).toEqual({
        qaOverride: {
          id: "eqo_1",
          type: "forced",
          key: "checkout",
          status: "draft",
          weights: [0.5, 0.5],
          coverage: 0.5,
          condition: { country: "US" },
          parentConditions: [{ id: "parent", condition: { value: true } }],
          namespace: ["ns", 0, 0.5],
        },
      });
    });

    it("is added to the experiment's other metadata", () => {
      const def = build([forcedOverride], {
        exp: { ...exp, tags: ["checkout-team"] },
        metadataOptions: { includeTagsInMetadata: true },
      });
      expect(def?.rules?.[0]?.metadata).toMatchObject({
        tags: ["checkout-team"],
        qaOverride: { id: "eqo_1" },
      });
    });

    it("gives each copy its own conditions", () => {
      const def = build([randomOverride], { exp });
      const rule = def?.rules?.[0];
      expect(rule?.metadata?.qaOverride?.condition).toEqual(rule?.condition);
      expect(rule?.metadata?.qaOverride?.condition).not.toBe(rule?.condition);
    });

    it("is not sent to SDKs that reject unknown rule fields", () => {
      const def = build([forcedOverride], { capabilities: ["prerequisites"] });
      expect(def?.rules).toHaveLength(1);
      expect(def?.rules?.[0]?.metadata).toBeUndefined();
    });

    it("has its Saved Groups resolved with the rule's own", () => {
      const finalizeCondition = jest.fn();
      const def = build(
        [withFilters(forcedOverride, { condition: '{"id":"tester"}' })],
        {
          exp,
          savedGroupStrategy: { ...savedGroupStrategy, finalizeCondition },
        },
      );
      const rule = def?.rules?.[0];
      const finalized = finalizeCondition.mock.calls.map(([c]) => c);
      expect(finalized).toContain(rule?.condition);
      expect(finalized).toContain(rule?.metadata?.qaOverride?.condition);
      expect(finalized).toContain(rule?.metadata?.qaOverride?.parentConditions);
    });
  });

  describe("holdout", () => {
    const holdoutFeature = {
      ...feature,
      holdout: { id: "hld_1", value: "holdout" },
    } as unknown as FeatureInterface;
    const holdoutsMap = new Map([
      [
        "hld_1",
        {
          holdout: { environmentSettings: { dev: { enabled: true } } },
          holdoutExperiment: {},
        },
      ],
    ]) as unknown as Parameters<typeof getFeatureDefinition>[0]["holdoutsMap"];
    const buildHoldout = (overrides: ExperimentQaOverrideInterface[]) =>
      build(overrides, { feature: holdoutFeature, holdoutsMap });

    it("is untouched without overrides", () => {
      const def = buildHoldout([]);
      expect(def?.rules).toHaveLength(1);
      expect(def?.rules?.[0]?.parentConditions?.[0]?.id).toBe("$holdout:hld_1");
      expect(def?.rules?.[0]?.condition).toBeUndefined();
    });

    it("is skipped by testers who match an override with its own targeting", () => {
      const def = buildHoldout([
        withFilters(forcedOverride, { condition: '{"id":"tester"}' }),
      ]);
      expect(def?.rules).toHaveLength(2);
      expect(def?.rules?.[0]).toMatchObject({
        parentConditions: [{ id: "$holdout:hld_1" }],
        condition: { $not: { id: "tester" } },
      });
      expect(def?.rules?.[1]?.key).toBe("checkout::qa");
    });

    it("is skipped by testers who match the experiment's targeting when it is served as configured", () => {
      const def = buildHoldout([
        withFilters(forcedOverride, { condition: '{"id":"tester"}' }),
        randomOverride,
      ]);
      expect(def?.rules?.[0]?.condition).toEqual({
        $not: { $or: [{ id: "tester" }, { country: "US" }] },
      });
    });

    it("is dropped when an override matches everyone", () => {
      const def = buildHoldout([forcedOverride]);
      expect(def?.rules).toHaveLength(1);
      expect(def?.rules?.[0]?.key).toBe("checkout::qa");
    });

    it("is kept when the only override is not served", () => {
      const def = buildHoldout([removedVariationOverride]);
      expect(def?.rules).toHaveLength(1);
      expect(def?.rules?.[0]?.condition).toBeUndefined();
    });

    it("is kept when the experiment rule is disabled or not yet scheduled", () => {
      const withRule = (rule: Record<string, unknown>) =>
        ({
          ...holdoutFeature,
          environmentSettings: {
            dev: {
              enabled: true,
              rules: [
                {
                  ...holdoutFeature.environmentSettings.dev.rules[0],
                  ...rule,
                },
              ],
            },
          },
        }) as unknown as FeatureInterface;
      const future = new Date(Date.now() + 86400000).toISOString();

      for (const rule of [
        { enabled: false },
        { scheduleRules: [{ enabled: true, timestamp: future }] },
      ]) {
        const def = build([forcedOverride], {
          feature: withRule(rule),
          holdoutsMap,
        });
        expect(def?.rules).toHaveLength(1);
        expect(def?.rules?.[0]?.parentConditions?.[0]?.id).toBe(
          "$holdout:hld_1",
        );
        expect(def?.rules?.[0]?.condition).toBeUndefined();
      }
    });
  });
});

describe("qaOverridesForConnection", () => {
  const environments = [
    { id: "dev", description: "", isProduction: false },
    { id: "production", description: "", isProduction: true },
  ];
  const dev = { id: "sdk_dev", environment: "dev", projects: [] };
  const overrides = [
    { ...randomOverride, order: 1 },
    { ...forcedOverride, order: 0 },
  ];

  it("never serves production or unknown environments", () => {
    expect(
      qaOverridesForConnection({
        overrides: overrides.map((o) => ({ ...o, environment: "production" })),
        connection: { ...dev, environment: "production" },
        environments,
      }),
    ).toBeUndefined();
    expect(
      qaOverridesForConnection({
        overrides: overrides.map((o) => ({ ...o, environment: "staging" })),
        connection: { ...dev, environment: "staging" },
        environments,
      }),
    ).toBeUndefined();
  });

  it("groups by experiment in priority order", () => {
    const result = qaOverridesForConnection({
      overrides,
      connection: dev,
      environments,
    });
    expect(result?.get("exp_1")?.map((o) => o.id)).toEqual(["eqo_1", "eqo_2"]);
  });

  it("applies connection and project filters against the effective project scope", () => {
    const scoped = [
      { ...forcedOverride, filters: { sdkConnections: ["sdk_other"] } },
      { ...randomOverride, filters: { projects: ["p2"] } },
    ];
    expect(
      qaOverridesForConnection({
        overrides: scoped,
        connection: dev,
        environments,
      })
        ?.get("exp_1")
        ?.map((o) => o.id),
    ).toEqual(["eqo_2"]);
    expect(
      qaOverridesForConnection({
        overrides: scoped,
        connection: { ...dev, projects: ["p1"] },
        environments,
      }),
    ).toBeUndefined();
    expect(
      qaOverridesForConnection({
        overrides,
        connection: { ...dev, projects: null },
        environments,
      }),
    ).toBeUndefined();
  });
});

describe("generateAutoExperimentsPayload with QA overrides", () => {
  const visualDraft = {
    id: "exp_1",
    archived: false,
    status: "draft",
    trackingKey: "checkout",
    hashAttribute: "id",
    hashVersion: 2,
    hasVisualChangesets: true,
    variations: [
      { id: "v0", key: "0", name: "Control" },
      { id: "v1", key: "1", name: "Treatment" },
    ],
    phases: [
      {
        condition: '{"country":"US"}',
        coverage: 0.5,
        variationWeights: [0.5, 0.5],
        seed: "phase-seed",
      },
    ],
  } as unknown as ExperimentInterface;
  const changeset = {
    id: "vc_1",
    experiment: "exp_1",
    urlPatterns: [{ include: true, type: "simple", pattern: "/" }],
    visualChanges: [
      { id: "c0", variation: "v0", css: "", js: "", domMutations: [] },
      { id: "c1", variation: "v1", css: ".x{}", js: "", domMutations: [] },
    ],
  };
  type AutoInput = Parameters<typeof generateAutoExperimentsPayload>[0];

  const build = (
    overrides: ExperimentQaOverrideInterface[],
    {
      exp = visualDraft,
      ...extra
    }: Partial<AutoInput> & { exp?: ExperimentInterface } = {},
  ) =>
    generateAutoExperimentsPayload({
      visualExperiments: [
        {
          type: "visual",
          experiment: exp,
          visualChangeset: changeset,
        } as unknown as AutoInput["visualExperiments"][number],
      ],
      urlRedirectExperiments: [],
      cbVisualExperiments: [],
      groupMap: new Map(),
      features: [],
      environment: "dev",
      capabilities: ["looseUnmarshalling", "prerequisites"],
      qaPlans: plansFor(exp, overrides),
      ...extra,
    });

  it("runs the QA copy on the QA key while the stored experiment stays a draft", () => {
    const [exp] = build([forcedOverride]);
    expect(exp).toMatchObject({
      key: "checkout::qa",
      status: "running",
      weights: [0, 1],
      coverage: 1,
      seed: "phase-seed",
      disableStickyBucketing: true,
    });
    expect(exp.condition).toBeUndefined();
    expect(visualDraft.status).toBe("draft");
  });

  it("keeps the namespace only when the experiment is served as configured", () => {
    const exp = {
      ...visualDraft,
      phases: [
        {
          ...visualDraft.phases[0],
          namespace: { enabled: true, name: "ns", range: [0, 0.5] },
        },
      ],
    } as unknown as ExperimentInterface;

    const [forced] = build([forcedOverride], { exp });
    expect(forced.namespace).toBeUndefined();
    expect(forced.filters).toBeUndefined();

    const [targeted] = build(
      [withFilters(randomOverride, { condition: '{"id":"123"}' })],
      { exp },
    );
    expect(targeted.namespace).toBeUndefined();
    expect(targeted).toMatchObject({ coverage: 1, condition: { id: "123" } });

    const [asConfigured] = build([randomOverride], { exp });
    expect(asConfigured.namespace).toEqual(["ns", 0, 0.5]);
    expect(asConfigured.coverage).toBe(0.5);
  });

  it("emits one copy per override, each leaving out the testers earlier ones match", () => {
    const payload = build([
      withFilters(forcedOverride, { condition: '{"id":"tester"}' }),
      randomOverride,
    ]);
    expect(payload).toHaveLength(2);
    expect(payload[0].condition).toEqual({ id: "tester" });
    expect(payload[0].changeId).not.toEqual(payload[1].changeId);
    expect(payload[1]).toMatchObject({
      weights: [0.5, 0.5],
      coverage: 0.5,
      condition: { $and: [{ country: "US" }, { $not: { id: "tester" } }] },
    });
  });

  it("stops after an override that matches everyone", () => {
    const payload = build([forcedOverride, randomOverride]);
    expect(payload).toHaveLength(1);
    expect(payload[0].weights).toEqual([0, 1]);
  });

  it("keeps testers who match the experiment's targeting out of later overrides, bucketed or not", () => {
    const payload = build([randomOverride, forcedOverride]);
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ weights: [0.5, 0.5], coverage: 0.5 });
    expect(payload[1]).toMatchObject({
      weights: [0, 1],
      coverage: 1,
      condition: { $not: { country: "US" } },
    });
  });

  it("drops prerequisites for an override with its own targeting, so it needs no prerequisites capability", () => {
    const exp = {
      ...visualDraft,
      phases: [
        {
          ...visualDraft.phases[0],
          prerequisites: [{ id: "parent", condition: '{"value":true}' }],
        },
      ],
    } as unknown as ExperimentInterface;
    const payload = build(
      [
        withFilters(forcedOverride, { condition: '{"id":"123"}' }),
        randomOverride,
      ],
      { exp, capabilities: ["looseUnmarshalling"] },
    );
    expect(payload).toHaveLength(1);
    expect(payload[0].parentConditions).toBeUndefined();
  });

  it("is not removed by a prerequisite the override does not keep", () => {
    const exp = {
      ...visualDraft,
      phases: [
        {
          ...visualDraft.phases[0],
          prerequisites: [{ id: "parent", condition: '{"value":true}' }],
        },
      ],
    } as unknown as ExperimentInterface;
    // Off in this environment, so the prerequisite can never pass.
    const parent = {
      id: "parent",
      defaultValue: "true",
      valueType: "boolean",
      environmentSettings: { dev: { enabled: false, rules: [] } },
    } as unknown as FeatureInterface;

    expect(build([randomOverride], { exp, features: [parent] })).toEqual([]);

    const [forced] = build([forcedOverride], { exp, features: [parent] });
    expect(forced).toMatchObject({ key: "checkout::qa", weights: [0, 1] });
    expect(forced.metadata?.qaOverride?.parentConditions).toEqual([
      { id: "parent", condition: { value: true } },
    ]);
  });

  it("keeps the experiment's own configuration and change id in metadata on every copy", () => {
    const [original] = build([]);
    const payload = build([
      withFilters(forcedOverride, { condition: '{"id":"tester"}' }),
      randomOverride,
    ]);
    expect(payload.map((e) => e.metadata?.qaOverride)).toEqual(
      ["eqo_1", "eqo_2"].map((id, i) => ({
        id,
        type: i === 0 ? "forced" : "random",
        key: "checkout",
        status: "draft",
        weights: [0.5, 0.5],
        coverage: 0.5,
        condition: { country: "US" },
        changeId: original.changeId,
      })),
    );
    expect(payload.map((e) => e.changeId)).not.toContain(original.changeId);
  });

  it("is delivered to a connection that leaves draft experiments out", async () => {
    const [qaCopy] = build([forcedOverride]);
    const { experiments } = await getFeatureDefinitionsResponse({
      features: {},
      experiments: [qaCopy, { ...qaCopy, key: "other::qa", status: "draft" }],
      dateUpdated: new Date(),
      projects: [],
      capabilities: ["looseUnmarshalling"],
      usedSavedGroups: [],
      includeDraftExperiments: false,
    });
    expect(experiments?.map((e) => e.key)).toEqual(["checkout::qa"]);
  });

  it("serves each override to the same testers as the flag rule does", () => {
    const overrides = [
      withFilters(forcedOverride, { condition: '{"id":"tester"}' }),
      withFilters(randomOverride, {
        savedGroups: [{ match: "all", ids: ["grp_qa"] }],
      }),
      randomOverride,
    ];
    const flag = getFeatureDefinition({
      feature: {
        id: "feature",
        defaultValue: "false",
        valueType: "boolean",
        environmentSettings: {
          dev: {
            enabled: true,
            rules: [
              {
                type: "experiment-ref",
                experimentId: "exp_1",
                id: "fr_abc",
                enabled: true,
                variations: [
                  { variationId: "v0", value: "false" },
                  { variationId: "v1", value: "true" },
                ],
              },
            ],
          },
        },
      } as unknown as FeatureInterface,
      environment: "dev",
      groupMap: savedGroupStrategy.groupMap,
      experimentMap: new Map([["exp_1", visualDraft]]),
      safeRolloutMap: new Map(),
      savedGroupStrategy,
      qaPlans: plansFor(visualDraft, overrides),
    });
    const auto = build(overrides, { savedGroupStrategy });

    const served = ({
      key,
      seed,
      condition,
      weights,
      coverage,
    }: {
      key?: string;
      seed?: string;
      condition?: unknown;
      weights?: number[];
      coverage?: number;
    }) => ({ key, seed, condition, weights, coverage });
    expect(auto).toHaveLength(3);
    expect(auto.map(served)).toEqual(flag?.rules?.map(served));
  });
});

describe("the experiment's targeting kept in QA override metadata", () => {
  const rule = () => ({
    condition: { email: "tester@x.com" },
    metadata: {
      qaOverride: {
        id: "eqo_1",
        type: "forced" as const,
        key: "checkout",
        status: "draft" as const,
        condition: { id: "123", vip: { id: { $inGroup: "grp_qa" } } },
        parentConditions: [{ id: "parent", condition: { value: true } }],
      },
    },
  });
  const secureId = [
    { property: "id", datatype: "secureString" as const },
    { property: "email", datatype: "secureString" as const },
  ];

  it("is listed alongside the rule's own", () => {
    const r = rule();
    expect(targetingOf(r)).toEqual([r, r.metadata.qaOverride]);
    expect(targetingOf({ condition: { id: "1" } })).toHaveLength(1);
  });

  it("has secure attribute values hashed on Feature Flag rules, and prerequisite ids left alone", () => {
    const { feature } = applyFeatureHashing(
      { feature: { defaultValue: false, rules: [rule()] } },
      secureId,
      "salt",
    );
    const hashed = feature.rules?.[0];
    expect(hashed?.condition?.email).not.toBe("tester@x.com");
    expect(hashed?.metadata?.qaOverride?.condition?.id).not.toBe("123");
    expect(hashed?.metadata?.qaOverride?.parentConditions).toEqual([
      { id: "parent", condition: { value: true } },
    ]);
  });

  it("has secure attribute values hashed on auto experiments", () => {
    const [hashed] = applyExperimentHashing(
      [rule() as unknown as Parameters<typeof applyExperimentHashing>[0][0]],
      secureId,
      "salt",
    );
    expect(targetingOf(hashed)[1].condition?.id).not.toBe("123");
    expect(targetingOf(hashed)[1].parentConditions).toEqual([
      { id: "parent", condition: { value: true } },
    ]);
  });

  it("keeps a Saved Group in the payload when only the experiment's targeting uses it", () => {
    const groupMap = savedGroupStrategy.groupMap;
    expect(
      getUsedSavedGroupIds(
        { feature: { defaultValue: false, rules: [rule()] } },
        [],
        groupMap,
      ),
    ).toEqual(new Set(["grp_qa"]));
    expect(
      getUsedSavedGroupIds(
        {},
        [rule() as unknown as Parameters<typeof getUsedSavedGroupIds>[1][0]],
        groupMap,
      ),
    ).toEqual(new Set(["grp_qa"]));
  });
});
