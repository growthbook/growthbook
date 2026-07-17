import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { ConfigInterface } from "shared/types/config";
import {
  featureReferenceTokens,
  resolvableDependencyClosure,
  featuresAffectedByResolvable,
  computeConfigKeyImplementations,
  experimentRefsReferencingConstant,
  isEmptyConfigPatch,
  FeatureValueSource,
} from "back-end/src/services/constants";
import {
  configToResolvable,
  ResolvableValue,
} from "back-end/src/services/resolvableValues";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

// A `@const:` interpolation as it lives in a string-typed value (not JSON).
const constInterp = (key: string) => `{{ @const:${key} }}`;
// A json value that pulls in another resolvable via `$extends`.
const extendsValue = (refs: string[], own: Record<string, unknown> = {}) =>
  JSON.stringify({ $extends: refs, ...own });

function constant(
  key: string,
  overrides: Partial<ResolvableValue> = {},
): ResolvableValue {
  return {
    id: `const_${key}`,
    organization: "org",
    key,
    name: key,
    type: "json",
    source: "constant",
    value: undefined,
    environmentValues: undefined,
    project: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...overrides,
  } as ResolvableValue;
}

// Build a config the real way: raw config (parent/extends) → configToResolvable,
// so the `@config:` `$extends` synthesis under test matches production exactly.
function config(
  key: string,
  opts: {
    parent?: string;
    extends?: string[];
    value?: string;
    environmentValues?: Record<string, string>;
    project?: string;
    scopedOverrides?: {
      config: string;
      environments?: string[];
      projects?: string[];
    }[];
  } = {},
): ResolvableValue {
  return configToResolvable({
    id: `cfg_${key}`,
    organization: "org",
    key,
    name: key,
    parent: opts.parent,
    extends: opts.extends,
    value: opts.value,
    environmentValues: opts.environmentValues,
    project: opts.project ?? "",
    scopedOverrides: opts.scopedOverrides,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  } as unknown as ConfigInterface);
}

function feat(overrides: Partial<FeatureInterface> = {}): FeatureInterface {
  return {
    id: "feat_x",
    organization: "org",
    owner: "tester",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    valueType: "string",
    defaultValue: "a",
    version: 1,
    archived: false,
    description: "",
    tags: [],
    project: "",
    rules: [],
    environmentSettings: {
      dev: { enabled: true, rules: [] },
      production: { enabled: true, rules: [] },
    },
    ...overrides,
  } as FeatureInterface;
}

const rule = (value: string): FeatureRule =>
  ({ id: "r", type: "force", value }) as unknown as FeatureRule;
// Legacy experiment rules store variation values under `values[].value`.
const expRule = (...values: string[]): FeatureRule =>
  ({
    id: "e",
    type: "experiment",
    values: values.map((value) => ({ value, weight: 1 / values.length })),
  }) as unknown as FeatureRule;
const expRefRule = (...values: string[]): FeatureRule =>
  ({
    id: "er",
    type: "experiment-ref",
    experimentId: "exp_1",
    variations: values.map((value, i) => ({ variationId: `v${i}`, value })),
  }) as unknown as FeatureRule;
const safeRolloutRule = (
  controlValue: string,
  variationValue: string,
): FeatureRule =>
  ({
    id: "sr",
    type: "safe-rollout",
    controlValue,
    variationValue,
  }) as unknown as FeatureRule;

const ids = (features: FeatureInterface[]) => features.map((f) => f.id).sort();

// ---------------------------------------------------------------------------
// featureReferenceTokens — every value location a feature can reference from
// ---------------------------------------------------------------------------

describe("featureReferenceTokens", () => {
  it("extracts a @const: reference from the default value", () => {
    const tokens = featureReferenceTokens(
      feat({ defaultValue: constInterp("greeting") }),
    );
    expect([...tokens]).toEqual(["constant:greeting"]);
  });

  it("extracts a @config: backing reference from the default value", () => {
    const tokens = featureReferenceTokens(
      feat({ defaultValue: extendsValue(["@config:theme"]) }),
    );
    expect([...tokens]).toEqual(["config:theme"]);
  });

  it("emits the base-config token even when no value carries a @config: ref", () => {
    // Config mode with a bare-patch default (the common create path): backing
    // lives on `feature.baseConfig`, not in any value string. It must still be
    // matched so editing/deleting/archiving that config refreshes the payload.
    const tokens = featureReferenceTokens(
      feat({ valueType: "json", baseConfig: "theme", defaultValue: "{}" }),
    );
    expect([...tokens]).toEqual(["config:theme"]);
  });

  it("extracts references from top-level rule values and variations", () => {
    const tokens = featureReferenceTokens(
      feat({
        defaultValue: "plain",
        rules: [rule(constInterp("a")), expRefRule(constInterp("b"), "lit")],
      }),
    );
    expect(new Set(tokens)).toEqual(new Set(["constant:a", "constant:b"]));
  });

  it("extracts references from legacy experiment rule values[].value", () => {
    const tokens = featureReferenceTokens(
      feat({
        defaultValue: "plain",
        rules: [expRule(constInterp("expref"), "lit")],
      }),
    );
    expect([...tokens]).toEqual(["constant:expref"]);
  });

  it("extracts references from safe-rollout control and variation values", () => {
    const tokens = featureReferenceTokens(
      feat({
        defaultValue: "plain",
        environmentSettings: {
          dev: {
            enabled: true,
            rules: [
              safeRolloutRule(constInterp("sr-control"), constInterp("sr-var")),
            ],
          },
          production: { enabled: true, rules: [] },
        },
      }),
    );
    expect(new Set(tokens)).toEqual(
      new Set(["constant:sr-control", "constant:sr-var"]),
    );
  });

  it("extracts references from per-environment rules", () => {
    const tokens = featureReferenceTokens(
      feat({
        defaultValue: "plain",
        environmentSettings: {
          dev: { enabled: true, rules: [rule(constInterp("envref"))] },
          production: { enabled: true, rules: [] },
        },
      }),
    );
    expect([...tokens]).toEqual(["constant:envref"]);
  });

  it("keeps the constant/config namespaces distinct for a shared key", () => {
    const tokens = featureReferenceTokens(
      feat({
        defaultValue: extendsValue(["@config:shared"], {
          note: constInterp("shared"),
        }),
      }),
    );
    expect(new Set(tokens)).toEqual(
      new Set(["config:shared", "constant:shared"]),
    );
  });

  it("extracts a reference from the holdout value (injected as a force rule)", () => {
    const tokens = featureReferenceTokens(
      feat({
        defaultValue: "plain",
        holdout: { id: "ho_1", value: constInterp("holdoutref") },
      } as Partial<FeatureInterface>),
    );
    expect([...tokens]).toEqual(["constant:holdoutref"]);
  });

  it("returns nothing for values with no references", () => {
    expect([
      ...featureReferenceTokens(feat({ defaultValue: "hello" })),
    ]).toEqual([]);
  });

  it("ignores non-string default values", () => {
    const tokens = featureReferenceTokens(
      feat({ defaultValue: 5 as unknown as string }),
    );
    expect([...tokens]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolvableDependencyClosure — the reverse-reachability graph walk
// ---------------------------------------------------------------------------

describe("resolvableDependencyClosure", () => {
  it("always includes the seed token itself", () => {
    const closure = resolvableDependencyClosure([], "constant", "x");
    expect([...closure]).toEqual(["constant:x"]);
  });

  it("includes a direct dependent resolvable", () => {
    const resolvables = [
      constant("base"),
      constant("mid", { value: extendsValue(["@const:base"]) }),
    ];
    expect(
      resolvableDependencyClosure(resolvables, "constant", "base"),
    ).toEqual(new Set(["constant:base", "constant:mid"]));
  });

  it("follows transitive constant chains to any depth", () => {
    const resolvables = [
      constant("base"),
      constant("mid", { value: extendsValue(["@const:base"]) }),
      constant("top", { value: extendsValue(["@const:mid"]) }),
    ];
    expect(
      resolvableDependencyClosure(resolvables, "constant", "base"),
    ).toEqual(new Set(["constant:base", "constant:mid", "constant:top"]));
  });

  it("follows the scopedOverrides parent→flavor edge (a flavor change reaches its parent + descendants)", () => {
    const resolvables = [
      config("base", {
        scopedOverrides: [
          { config: "base-prod", environments: ["production"] },
        ],
      }),
      config("base-prod", {
        parent: "base",
        value: JSON.stringify({ timeout: 5 }),
      }),
      config("child", { parent: "base" }),
    ];
    // Publishing the flavor must invalidate the parent (which serves it) and the
    // parent's descendants — even though scopedOverrides isn't a @config: ref.
    expect(
      resolvableDependencyClosure(resolvables, "config", "base-prod"),
    ).toEqual(new Set(["config:base-prod", "config:base", "config:child"]));
  });

  it("follows config lineage (parent + extends) as @config: edges", () => {
    const resolvables = [
      config("root"),
      config("child", { parent: "root" }),
      config("grandchild", { parent: "child" }),
      config("mixinUser", { extends: ["root"] }),
    ];
    expect(resolvableDependencyClosure(resolvables, "config", "root")).toEqual(
      new Set([
        "config:root",
        "config:child",
        "config:grandchild",
        "config:mixinUser",
      ]),
    );
  });

  it("dedupes diamond dependency paths", () => {
    const resolvables = [
      constant("base"),
      constant("left", { value: extendsValue(["@const:base"]) }),
      constant("right", { value: extendsValue(["@const:base"]) }),
      constant("top", {
        value: extendsValue(["@const:left", "@const:right"]),
      }),
    ];
    expect(
      resolvableDependencyClosure(resolvables, "constant", "base"),
    ).toEqual(
      new Set([
        "constant:base",
        "constant:left",
        "constant:right",
        "constant:top",
      ]),
    );
  });

  it("terminates on a reference cycle", () => {
    const resolvables = [
      constant("a", { value: extendsValue(["@const:b"]) }),
      constant("b", { value: extendsValue(["@const:a"]) }),
    ];
    expect(resolvableDependencyClosure(resolvables, "constant", "a")).toEqual(
      new Set(["constant:a", "constant:b"]),
    );
  });

  it("does not cross namespaces for a shared key", () => {
    const resolvables = [
      constant("shared"),
      config("shared"),
      constant("usesConst", { value: extendsValue(["@const:shared"]) }),
      config("usesConfig", { extends: ["shared"] }),
    ];
    expect(
      resolvableDependencyClosure(resolvables, "constant", "shared"),
    ).toEqual(new Set(["constant:shared", "constant:usesConst"]));
    expect(
      resolvableDependencyClosure(resolvables, "config", "shared"),
    ).toEqual(new Set(["config:shared", "config:usesConfig"]));
  });

  it("counts a reference that only appears in environmentValues", () => {
    const resolvables = [
      constant("base"),
      constant("envOnly", {
        value: extendsValue([]),
        environmentValues: { production: extendsValue(["@const:base"]) },
      }),
    ];
    expect(
      resolvableDependencyClosure(resolvables, "constant", "base"),
    ).toEqual(new Set(["constant:base", "constant:envOnly"]));
  });

  it("excludes unrelated resolvables", () => {
    const resolvables = [
      constant("base"),
      constant("unrelated", { value: extendsValue(["@const:other"]) }),
    ];
    expect(
      resolvableDependencyClosure(resolvables, "constant", "base"),
    ).toEqual(new Set(["constant:base"]));
  });
});

// ---------------------------------------------------------------------------
// featuresAffectedByResolvable — end-to-end (graph + feature matching)
// ---------------------------------------------------------------------------

describe("featuresAffectedByResolvable", () => {
  it("matches a feature that references a constant directly", () => {
    const features = [
      feat({ id: "uses", defaultValue: constInterp("base") }),
      feat({ id: "nope", defaultValue: "literal" }),
    ];
    expect(
      ids(
        featuresAffectedByResolvable(
          [constant("base")],
          features,
          "constant",
          "base",
        ),
      ),
    ).toEqual(["uses"]);
  });

  it("matches a feature backed by a config directly", () => {
    const features = [
      feat({ id: "backed", defaultValue: extendsValue(["@config:theme"]) }),
      feat({ id: "other", defaultValue: extendsValue(["@config:elsewhere"]) }),
    ];
    expect(
      ids(
        featuresAffectedByResolvable(
          [config("theme"), config("elsewhere")],
          features,
          "config",
          "theme",
        ),
      ),
    ).toEqual(["backed"]);
  });

  it("matches a feature through a transitive constant chain", () => {
    const resolvables = [
      constant("base"),
      constant("mid", { value: extendsValue(["@const:base"]) }),
    ];
    const features = [feat({ id: "viaMid", defaultValue: constInterp("mid") })];
    expect(
      ids(
        featuresAffectedByResolvable(resolvables, features, "constant", "base"),
      ),
    ).toEqual(["viaMid"]);
  });

  it("matches a feature through transitive config lineage (ancestor change)", () => {
    const resolvables = [
      config("root"),
      config("child", { parent: "root" }),
      config("grandchild", { parent: "child" }),
    ];
    const features = [
      feat({
        id: "onGrandchild",
        defaultValue: extendsValue(["@config:grandchild"]),
      }),
      feat({ id: "onRoot", defaultValue: extendsValue(["@config:root"]) }),
      feat({ id: "unrelated", defaultValue: "x" }),
    ];
    // Changing the root must refresh features bound anywhere down the lineage.
    expect(
      ids(
        featuresAffectedByResolvable(resolvables, features, "config", "root"),
      ),
    ).toEqual(["onGrandchild", "onRoot"]);
  });

  it("does not match across namespaces for a shared key", () => {
    const resolvables = [constant("shared"), config("shared")];
    const features = [
      feat({ id: "constUser", defaultValue: constInterp("shared") }),
      feat({
        id: "configUser",
        defaultValue: extendsValue(["@config:shared"]),
      }),
    ];
    expect(
      ids(
        featuresAffectedByResolvable(
          resolvables,
          features,
          "constant",
          "shared",
        ),
      ),
    ).toEqual(["constUser"]);
    expect(
      ids(
        featuresAffectedByResolvable(resolvables, features, "config", "shared"),
      ),
    ).toEqual(["configUser"]);
  });

  it("matches references held only in rule and variation values", () => {
    const features = [
      feat({
        id: "ruleRef",
        defaultValue: "x",
        rules: [rule(constInterp("c"))],
      }),
      feat({
        id: "varRef",
        defaultValue: "x",
        rules: [expRefRule("lit", constInterp("c"))],
      }),
      feat({
        id: "expValRef",
        defaultValue: "x",
        rules: [expRule("lit", constInterp("c"))],
      }),
      feat({
        id: "srControlRef",
        defaultValue: "x",
        rules: [safeRolloutRule(constInterp("c"), "lit")],
      }),
      feat({
        id: "srVarRef",
        defaultValue: "x",
        rules: [safeRolloutRule("lit", constInterp("c"))],
      }),
      feat({
        id: "envRef",
        defaultValue: "x",
        environmentSettings: {
          dev: { enabled: true, rules: [rule(constInterp("c"))] },
          production: { enabled: true, rules: [] },
        },
      }),
      feat({ id: "none", defaultValue: "x" }),
    ];
    expect(
      ids(
        featuresAffectedByResolvable(
          [constant("c")],
          features,
          "constant",
          "c",
        ),
      ),
    ).toEqual([
      "envRef",
      "expValRef",
      "ruleRef",
      "srControlRef",
      "srVarRef",
      "varRef",
    ]);
  });

  it("matches a feature that references the value only in its holdout", () => {
    const features = [
      feat({
        id: "holdoutOnly",
        defaultValue: "plain",
        holdout: { id: "ho_1", value: constInterp("h") },
      } as Partial<FeatureInterface>),
      feat({ id: "none", defaultValue: "plain" }),
    ];
    expect(
      ids(
        featuresAffectedByResolvable(
          [constant("h")],
          features,
          "constant",
          "h",
        ),
      ),
    ).toEqual(["holdoutOnly"]);
  });

  it("returns nothing when no feature depends on the value (refresh skipped)", () => {
    const resolvables = [
      constant("orphan"),
      constant("mid", { value: extendsValue(["@const:orphan"]) }),
    ];
    // `mid` embeds `orphan` but no feature references either → nothing to refresh.
    const features = [feat({ id: "f", defaultValue: "literal" })];
    expect(
      featuresAffectedByResolvable(resolvables, features, "constant", "orphan"),
    ).toEqual([]);
  });

  it("still matches direct feature references when the entity is gone (delete)", () => {
    // On delete the changed resolvable is absent from the resolvable set, but a
    // feature that referenced it directly must still be refreshed.
    const features = [
      feat({ id: "dangling", defaultValue: constInterp("deleted") }),
      feat({ id: "fine", defaultValue: "literal" }),
    ];
    expect(
      ids(featuresAffectedByResolvable([], features, "constant", "deleted")),
    ).toEqual(["dangling"]);
  });
});

// ---------------------------------------------------------------------------
// computeConfigKeyImplementations — which rules/defaults override each key
// ---------------------------------------------------------------------------

describe("computeConfigKeyImplementations", () => {
  const family = new Set(["base", "child"]);
  const backed = (own: Record<string, unknown>, key = "base") =>
    extendsValue([`@config:${key}`], own);

  // Mirror the live-feature normalization the service does (top-level rules plus
  // every environment's rules, flattened).
  const liveSource = (f: FeatureInterface): FeatureValueSource => {
    const envRules = Object.values(f.environmentSettings ?? {}).flatMap(
      (e) => e?.rules ?? [],
    );
    return {
      featureId: f.id,
      project: f.project || undefined,
      state: "live",
      defaultValue: f.defaultValue,
      rules: [...(f.rules ?? []), ...envRules] as FeatureValueSource["rules"],
    };
  };

  it("captures a config-backed default value with its overridden keys", () => {
    const impls = computeConfigKeyImplementations(
      [
        liveSource(
          feat({
            valueType: "json",
            defaultValue: backed({ context_window: 8000 }),
          }),
        ),
      ],
      family,
    );
    expect(impls).toHaveLength(1);
    expect(impls[0]).toMatchObject({
      featureId: "feat_x",
      location: "defaultValue",
      configKey: "base",
      keys: ["context_window"],
      state: "live",
    });
  });

  it("captures force rules with rule metadata, excluding $extends from keys", () => {
    const impls = computeConfigKeyImplementations(
      [
        liveSource(
          feat({
            valueType: "json",
            defaultValue: "{}",
            rules: [rule(backed({ log_level: "warn" }))],
          }),
        ),
      ],
      family,
    );
    expect(impls).toHaveLength(1);
    expect(impls[0]).toMatchObject({
      location: "rule",
      ruleType: "force",
      ruleId: "r",
      keys: ["log_level"],
    });
  });

  it("captures each experiment-ref arm with its variation and experiment id", () => {
    const impls = computeConfigKeyImplementations(
      [
        liveSource(
          feat({
            valueType: "json",
            defaultValue: "{}",
            rules: [expRefRule(backed({ a: 1 }), backed({ a: 2 }))],
          }),
        ),
      ],
      family,
    );
    expect(impls).toHaveLength(2);
    expect(impls.map((i) => i.variationId).sort()).toEqual(["v0", "v1"]);
    expect(impls.every((i) => i.experimentId === "exp_1")).toBe(true);
  });

  it("ignores values backed by a config outside the family, or not config-backed", () => {
    const impls = computeConfigKeyImplementations(
      [
        liveSource(
          feat({
            id: "out",
            valueType: "json",
            defaultValue: backed({ a: 1 }, "unrelated"),
          }),
        ),
        liveSource(
          feat({ id: "plain", valueType: "json", defaultValue: '{"a":1}' }),
        ),
      ],
      family,
    );
    expect(impls).toHaveLength(0);
  });

  it("collapses the same rule across environments, unioning overridden keys", () => {
    const f = feat({
      id: "multi",
      valueType: "json",
      defaultValue: "{}",
      rules: [],
      environmentSettings: {
        dev: { enabled: true, rules: [rule(backed({ a: 1 }))] },
        production: { enabled: true, rules: [rule(backed({ b: 2 }))] },
      },
    } as Partial<FeatureInterface>);
    const impls = computeConfigKeyImplementations([liveSource(f)], family);
    expect(impls).toHaveLength(1);
    expect(impls[0].keys.sort()).toEqual(["a", "b"]);
  });

  it("records a config-backed value that overrides nothing with empty keys", () => {
    const impls = computeConfigKeyImplementations(
      [liveSource(feat({ valueType: "json", defaultValue: backed({}) }))],
      family,
    );
    expect(impls).toHaveLength(1);
    expect(impls[0].keys).toEqual([]);
  });

  it("tags a draft-only linkage as draft with its revision version", () => {
    const draft: FeatureValueSource = {
      featureId: "feat_x",
      state: "draft",
      revisionVersion: 4,
      defaultValue: "{}",
      rules: [rule(backed({ a: 1 }))] as FeatureValueSource["rules"],
    };
    const impls = computeConfigKeyImplementations([draft], family);
    expect(impls).toHaveLength(1);
    expect(impls[0]).toMatchObject({ state: "draft", revisionVersion: 4 });
  });

  it("lets a published slot win over the same slot re-declared in a draft", () => {
    const live = liveSource(
      feat({
        valueType: "json",
        defaultValue: "{}",
        rules: [rule(backed({ a: 1 }))],
      }),
    );
    const draft: FeatureValueSource = {
      featureId: "feat_x",
      state: "draft",
      revisionVersion: 4,
      defaultValue: "{}",
      rules: [rule(backed({ a: 1 }))] as FeatureValueSource["rules"],
    };
    const impls = computeConfigKeyImplementations([live, draft], family);
    expect(impls).toHaveLength(1);
    expect(impls[0].state).toBe("live");
  });
});

// ---------------------------------------------------------------------------
// experimentRefsReferencingConstant — direct @const refs in experiment/bandit arms
// ---------------------------------------------------------------------------

const expRefRuleWith = (
  experimentId: string,
  ...values: string[]
): FeatureRule =>
  ({
    id: "er",
    type: "experiment-ref",
    experimentId,
    variations: values.map((value, i) => ({ variationId: `v${i}`, value })),
  }) as unknown as FeatureRule;

const banditRefRuleWith = (
  contextualBanditId: string,
  ...values: string[]
): FeatureRule =>
  ({
    id: "br",
    type: "contextual-bandit-ref",
    contextualBanditId,
    variations: values.map((value, i) => ({ variationId: `v${i}`, value })),
  }) as unknown as FeatureRule;

describe("experimentRefsReferencingConstant", () => {
  it("collects the experimentId when an experiment-ref arm references the constant", () => {
    const features = [
      feat({ rules: [expRefRuleWith("exp_1", "lit", constInterp("target"))] }),
    ];
    expect(experimentRefsReferencingConstant(features, "target")).toEqual({
      experimentIds: ["exp_1"],
      banditIds: [],
    });
  });

  it("collects the contextualBanditId for a bandit-ref arm reference", () => {
    const features = [
      feat({ rules: [banditRefRuleWith("cb_1", constInterp("target"))] }),
    ];
    expect(experimentRefsReferencingConstant(features, "target")).toEqual({
      experimentIds: [],
      banditIds: ["cb_1"],
    });
  });

  it("ignores an experiment-ref rule that does not reference the constant", () => {
    const features = [
      feat({ rules: [expRefRuleWith("exp_1", "lit", constInterp("other"))] }),
    ];
    expect(experimentRefsReferencingConstant(features, "target")).toEqual({
      experimentIds: [],
      banditIds: [],
    });
  });

  it("ignores a non-experiment rule that references the constant (config path covers those)", () => {
    const features = [feat({ rules: [rule(constInterp("target"))] })];
    expect(experimentRefsReferencingConstant(features, "target")).toEqual({
      experimentIds: [],
      banditIds: [],
    });
  });

  it("scans per-environment rules, not just the flat rules array", () => {
    const features = [
      feat({
        rules: [],
        environmentSettings: {
          dev: {
            enabled: true,
            rules: [expRefRuleWith("exp_env", constInterp("target"))],
          },
          production: { enabled: true, rules: [] },
        },
      }),
    ];
    expect(experimentRefsReferencingConstant(features, "target")).toEqual({
      experimentIds: ["exp_env"],
      banditIds: [],
    });
  });

  it("dedupes the same experimentId referenced by multiple features", () => {
    const features = [
      feat({
        id: "f1",
        rules: [expRefRuleWith("exp_1", constInterp("target"))],
      }),
      feat({
        id: "f2",
        rules: [expRefRuleWith("exp_1", constInterp("target"))],
      }),
    ];
    expect(experimentRefsReferencingConstant(features, "target")).toEqual({
      experimentIds: ["exp_1"],
      banditIds: [],
    });
  });
});

describe("isEmptyConfigPatch", () => {
  it("treats an empty object, undefined, and empty string as empty", () => {
    expect(isEmptyConfigPatch("{}")).toBe(true);
    expect(isEmptyConfigPatch(undefined)).toBe(true);
    expect(isEmptyConfigPatch("")).toBe(true);
    // Whitespace-only object still parses to no keys.
    expect(isEmptyConfigPatch("{ }")).toBe(true);
  });

  it("treats any own key as a non-empty patch", () => {
    expect(isEmptyConfigPatch('{"a":1}')).toBe(false);
    expect(isEmptyConfigPatch('{"a":null}')).toBe(false);
  });

  it("treats non-object JSON (array, scalar) as non-empty (not a bare patch)", () => {
    expect(isEmptyConfigPatch("[]")).toBe(false);
    expect(isEmptyConfigPatch("0")).toBe(false);
    expect(isEmptyConfigPatch("null")).toBe(false);
  });

  it("treats unparseable JSON as non-empty (can't prove it's a no-op)", () => {
    expect(isEmptyConfigPatch("{not json")).toBe(false);
  });
});
