import { ExperimentInterface, ExperimentPhase } from "shared/types/experiment";
import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import { FeatureDefinitionRule } from "shared/types/sdk";
import { SavedGroupPayloadStrategy } from "shared/sdk-versioning/saved-groups/types";
import { FeatureInterface } from "shared/types/feature";
import { qaOverrideAppliesToConnection } from "shared/util";
import {
  applyQaOverrideToRule,
  getFeatureDefinition,
  qaOverrideCondition,
  qaOverridesExclusionCondition,
  qaOverrideWeights,
} from "../../src/util/features";
import {
  generateAutoExperimentsPayload,
  qaOverridesForConnection,
} from "../../src/services/features";

const experiment = {
  trackingKey: "checkout",
  variations: [
    { id: "v0", key: "0", name: "Control" },
    { id: "v1", key: "1", name: "One-page" },
    { id: "v2", key: "2", name: "Apple Pay" },
  ],
  phases: [{ variationWeights: [0.34, 0.33, 0.33] }],
} as unknown as ExperimentInterface;

const phase = {
  variationWeights: [0.34, 0.33, 0.33],
  coverage: 0.5,
  condition: '{"country":"US"}',
  seed: "phase-seed",
} as unknown as ExperimentPhase;

// Inline strategy: saved groups become `$inGroup` references, nothing is rewritten.
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

describe("qaOverrideWeights", () => {
  it("forces one variation with one-hot weights", () => {
    expect(qaOverrideWeights(forcedOverride, experiment, phase)).toEqual([
      0, 1, 0,
    ]);
  });

  it("keeps the phase weights for random assignment", () => {
    expect(qaOverrideWeights(randomOverride, experiment, phase)).toEqual([
      0.34, 0.33, 0.33,
    ]);
  });

  it("falls back to the phase weights when the variation is missing", () => {
    expect(
      qaOverrideWeights(
        {
          ...forcedOverride,
          assignment: { type: "forced", variationId: "nope" },
        },
        experiment,
        phase,
      ),
    ).toEqual([0.34, 0.33, 0.33]);
  });
});

describe("qaOverrideCondition", () => {
  const experimentCondition = { country: "US" };

  it("ignores the experiment condition when forcing a variation", () => {
    expect(
      qaOverrideCondition({
        override: forcedOverride,
        experimentCondition,
        savedGroupStrategy,
      }),
    ).toBeUndefined();
  });

  it("keeps the experiment condition for random assignment", () => {
    expect(
      qaOverrideCondition({
        override: randomOverride,
        experimentCondition,
        savedGroupStrategy,
      }),
    ).toEqual(experimentCondition);
  });

  it("compiles the filters and ANDs them with the experiment condition only for random assignment", () => {
    const filters = {
      condition: '{"email":{"$in":["a@x.com"]}}',
      savedGroups: [{ match: "all" as const, ids: ["grp_qa"] }],
    };
    const compiled = {
      $and: [{ email: { $in: ["a@x.com"] } }, { id: { $inGroup: "grp_qa" } }],
    };
    expect(
      qaOverrideCondition({
        override: { ...forcedOverride, filters },
        experimentCondition,
        savedGroupStrategy,
      }),
    ).toEqual(compiled);
    expect(
      qaOverrideCondition({
        override: { ...randomOverride, filters },
        experimentCondition,
        savedGroupStrategy,
      }),
    ).toEqual({ $and: [experimentCondition, compiled] });
  });
});

describe("applyQaOverrideToRule", () => {
  const buildRule = (): FeatureDefinitionRule => ({
    key: "checkout",
    coverage: 0.5,
    weights: [0.34, 0.33, 0.33],
    variations: ["a", "b", "c"],
    condition: { country: "US" },
    parentConditions: [{ id: "parent", condition: { value: true } }],
    namespace: ["ns", 0, 0.5],
    seed: "phase-seed",
  });

  it("falls back to the tracking key as seed when the phase has none", () => {
    const rule = applyQaOverrideToRule(
      buildRule(),
      experiment,
      { ...phase, seed: undefined } as ExperimentPhase,
      forcedOverride,
      savedGroupStrategy,
    );
    expect(rule.seed).toBe("checkout");
  });

  it("keeps the feature rule's id so dev tools can still resolve it", () => {
    const rule = applyQaOverrideToRule(
      { ...buildRule(), id: "fr_abc" },
      experiment,
      phase,
      forcedOverride,
      savedGroupStrategy,
    );
    expect(rule.id).toBe("fr_abc");
  });

  it("forcing a variation also drops multi-range namespace filters", () => {
    const filters = [
      { attribute: "id", seed: "ns", hashVersion: 2, ranges: [[0, 0.5]] },
    ];
    const forced = applyQaOverrideToRule(
      { ...buildRule(), filters } as FeatureDefinitionRule,
      experiment,
      phase,
      forcedOverride,
      savedGroupStrategy,
    );
    expect(forced.filters).toBeUndefined();
    const random = applyQaOverrideToRule(
      { ...buildRule(), filters } as FeatureDefinitionRule,
      experiment,
      phase,
      randomOverride,
      savedGroupStrategy,
    );
    expect(random.filters).toEqual(filters);
  });

  it("forcing a variation strips targeting, coverage, prerequisites and namespace", () => {
    const rule = applyQaOverrideToRule(
      buildRule(),
      experiment,
      phase,
      forcedOverride,
      savedGroupStrategy,
    );
    expect(rule.key).toBe("checkout::qa");
    expect(rule.seed).toBe("phase-seed");
    expect(rule.weights).toEqual([0, 1, 0]);
    expect(rule.coverage).toBe(1);
    expect(rule.disableStickyBucketing).toBe(true);
    expect(rule.condition).toBeUndefined();
    expect(rule.parentConditions).toBeUndefined();
    expect(rule.namespace).toBeUndefined();
    expect(rule.variations).toEqual(["a", "b", "c"]);
  });

  it("random assignment keeps the experiment as configured", () => {
    const rule = applyQaOverrideToRule(
      buildRule(),
      experiment,
      phase,
      randomOverride,
      savedGroupStrategy,
    );
    expect(rule.key).toBe("checkout::qa");
    expect(rule.seed).toBe("phase-seed");
    expect(rule.weights).toEqual([0.34, 0.33, 0.33]);
    expect(rule.coverage).toBe(0.5);
    expect(rule.condition).toEqual({ country: "US" });
    expect(rule.parentConditions).toHaveLength(1);
    expect(rule.namespace).toEqual(["ns", 0, 0.5]);
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
        coverage: 0.5,
        variationWeights: [0.5, 0.5],
        seed: "phase-seed",
        namespace: { enabled: true, name: "ns", range: [0, 0.5] },
      },
    ],
    linkedFeatures: ["feature"],
  } as unknown as ExperimentInterface;

  const feature = {
    id: "feature",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    defaultValue: "false",
    organization: "org",
    owner: "",
    valueType: "boolean",
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
              { variationId: "v0", value: "false" },
              { variationId: "v1", value: "true" },
            ],
          },
        ],
      },
    },
  } as unknown as FeatureInterface;

  const build = (
    qaOverrides?: Map<string, ExperimentQaOverrideInterface[]>,
    extra: Partial<Parameters<typeof getFeatureDefinition>[0]> = {},
  ) =>
    getFeatureDefinition({
      feature,
      environment: "dev",
      groupMap: new Map(),
      experimentMap: new Map([["exp_1", draftExperiment]]),
      safeRolloutMap: new Map(),
      capabilities: ["looseUnmarshalling", "prerequisites"],
      includeRuleIds: true,
      qaOverrides,
      ...extra,
    });

  it("serves nothing for a draft without overrides", () => {
    expect(build()?.rules ?? []).toEqual([]);
  });

  it("emits one rule per override, in order, on the QA key with the live seed", () => {
    const def = build(
      new Map([
        [
          "exp_1",
          [
            { ...forcedOverride, filters: { condition: '{"id":"tester"}' } },
            randomOverride,
          ],
        ],
      ]),
    );
    expect(def?.rules).toHaveLength(2);
    const [forced, random] = def?.rules ?? [];

    expect(forced).toMatchObject({
      id: "fr_abc",
      key: "checkout::qa",
      seed: "phase-seed",
      weights: [0, 1],
      coverage: 1,
      condition: { id: "tester" },
      variations: [false, true],
    });
    expect(forced.namespace).toBeUndefined();

    expect(random).toMatchObject({
      id: "fr_abc",
      key: "checkout::qa",
      seed: "phase-seed",
      weights: [0.5, 0.5],
      coverage: 0.5,
      condition: { country: "US" },
      namespace: ["ns", 0, 0.5],
    });
  });

  it("without the prerequisites capability, forced overrides are served and random ones are not", () => {
    const gated = {
      ...draftExperiment,
      phases: [
        {
          ...draftExperiment.phases[0],
          prerequisites: [{ id: "parent", condition: '{"value":true}' }],
        },
      ],
    } as unknown as ExperimentInterface;
    const buildGated = (overrides: ExperimentQaOverrideInterface[]) =>
      getFeatureDefinition({
        feature,
        environment: "dev",
        groupMap: new Map(),
        experimentMap: new Map([["exp_1", gated]]),
        safeRolloutMap: new Map(),
        capabilities: ["looseUnmarshalling"],
        qaOverrides: new Map([["exp_1", overrides]]),
      });

    const forcedOnly = buildGated([forcedOverride]);
    expect(forcedOnly?.rules).toHaveLength(1);
    expect(forcedOnly?.rules?.[0]).toMatchObject({
      key: "checkout::qa",
      weights: [0, 1],
    });
    expect(forcedOnly?.rules?.[0]?.parentConditions).toBeUndefined();

    // A random override needs the prerequisites, so the live behaviour (the
    // whole feature is excluded) stands.
    expect(buildGated([forcedOverride, randomOverride])).toBeNull();
  });

  it("keeps the holdout for requests no override covers", () => {
    const holdoutFeature = {
      ...feature,
      holdout: { id: "hld_1", value: "false" },
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

    const def = build(
      new Map([
        [
          "exp_1",
          [{ ...forcedOverride, filters: { condition: '{"id":"tester"}' } }],
        ],
      ]),
      { feature: holdoutFeature, holdoutsMap },
    );
    expect(def?.rules).toHaveLength(2);
    expect(def?.rules?.[0]).toMatchObject({
      parentConditions: [{ id: "$holdout:hld_1" }],
      condition: { $not: { id: "tester" } },
    });
    expect(def?.rules?.[1]?.key).toBe("checkout::qa");
  });

  it("drops the holdout rule when an override matches everyone", () => {
    const holdoutFeature = {
      ...feature,
      holdout: { id: "hld_1", value: "false" },
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

    const without = build(undefined, { feature: holdoutFeature, holdoutsMap });
    expect(without?.rules?.[0]?.parentConditions?.[0]?.id).toBe(
      "$holdout:hld_1",
    );

    const withOverride = build(new Map([["exp_1", [forcedOverride]]]), {
      feature: holdoutFeature,
      holdoutsMap,
    });
    expect(withOverride?.rules).toHaveLength(1);
    expect(withOverride?.rules?.[0]?.key).toBe("checkout::qa");
  });
});

describe("qaOverridesExclusionCondition", () => {
  it("is undefined with nothing to exclude and null once a rule matches everyone", () => {
    expect(qaOverridesExclusionCondition([])).toBeUndefined();
    expect(qaOverridesExclusionCondition([{ id: "a" }, undefined])).toBeNull();
  });

  it("negates one condition, or the OR of several", () => {
    expect(qaOverridesExclusionCondition([{ id: "a" }])).toEqual({
      $not: { id: "a" },
    });
    expect(
      qaOverridesExclusionCondition([{ id: "a" }, { email: "b" }]),
    ).toEqual({ $not: { $or: [{ id: "a" }, { email: "b" }] } });
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
    // Unscoped connection: only the connection filter excludes.
    expect(
      qaOverridesForConnection({
        overrides: scoped,
        connection: dev,
        environments,
      })
        ?.get("exp_1")
        ?.map((o) => o.id),
    ).toEqual(["eqo_2"]);
    // Scoped to p1 in this environment: the project filter excludes too.
    expect(
      qaOverridesForConnection({
        overrides: scoped,
        connection: { ...dev, projects: ["p1"] },
        environments,
      }),
    ).toBeUndefined();
    // Scrubbed to no projects: serves nothing.
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

  const build = (qaOverrides?: Map<string, ExperimentQaOverrideInterface[]>) =>
    generateAutoExperimentsPayload({
      visualExperiments: [
        {
          type: "visual",
          experiment: visualDraft,
          visualChangeset: changeset,
        } as unknown as Parameters<
          typeof generateAutoExperimentsPayload
        >[0]["visualExperiments"][number],
      ],
      urlRedirectExperiments: [],
      cbVisualExperiments: [],
      groupMap: new Map(),
      features: [],
      environment: "dev",
      capabilities: ["looseUnmarshalling"],
      qaOverrides,
    });

  it("runs the QA copy on the QA key while the stored experiment stays a draft", () => {
    const [exp] = build(new Map([["exp_1", [forcedOverride]]]));
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

  it("emits one copy per override, each excluding the requests earlier ones cover", () => {
    const first = {
      ...forcedOverride,
      filters: { condition: '{"id":"tester"}' },
    };
    const payload = build(new Map([["exp_1", [first, randomOverride]]]));
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
    const payload = build(
      new Map([["exp_1", [forcedOverride, randomOverride]]]),
    );
    expect(payload).toHaveLength(1);
    expect(payload[0].weights).toEqual([0, 1]);
  });
});
