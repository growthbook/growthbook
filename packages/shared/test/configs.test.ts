import {
  getConfigParentKey,
  getConfigBaseKeys,
  stripExtends,
  withConfigExtends,
  getConfigBackingKey,
  getConfigBackingPatch,
  setConfigBacking,
  valueHasConfigExtends,
  getConfigSubtree,
  orderConfigsByLineage,
  getConfigSpineSubtree,
  ensureConfigBacking,
  getAncestorSchemaKeys,
  getConfigAncestorKeys,
  findBasePrecedenceInversions,
  configChainDeclaresReferenceLayer,
  stripAncestorOwnedFields,
  configIsExtensible,
  stripConfigExtends,
  linearizeConfigDag,
  getConfigSpineRootKey,
  collectConfigInvariantViolations,
  collectResolvedConfigValueViolations,
  collectDescendantInvariantViolations,
  findSiblingSchemaConflicts,
  findIncompatibleConfigValueKeys,
  resolveConfigChain,
  selectScopedOverride,
  findScopedOverrideStructuralErrors,
  computeConfigReconciliationPreview,
  isConfigLocked,
  ConfigChainNode,
  getAncestorSchemaFieldOwners,
  classifyAncestorOwnedFields,
  formatAncestorFieldConflictMessage,
  ancestorCollisionWarnings,
  findOrphanedConfigValueKeys,
  computeConfigSchemaChangeImpact,
  ConfigFamilyMember,
  findUndeclaredInvariantRuleFields,
  undeclaredRuleFieldWarnings,
  getFeatureBaseConfigKey,
} from "../src/util/configs";
import { fieldsContractEqual } from "../src/util/config-schema";
import { SimpleSchema, SchemaField } from "../types/feature";

const field = (key: string): SchemaField => ({
  key,
  type: "string",
  required: true,
  default: "",
  description: "",
  enum: [],
});
const objSchema = (...keys: string[]): SimpleSchema => ({
  type: "object",
  fields: keys.map(field),
});

describe("isConfigLocked", () => {
  it("is false when lock is absent", () => {
    expect(isConfigLocked({})).toBe(false);
  });
  it("is false when lock is null (explicit unlocked sentinel)", () => {
    expect(isConfigLocked({ lock: null })).toBe(false);
  });
  it("is true when a lock object is present", () => {
    expect(isConfigLocked({ lock: { version: 3 } })).toBe(true);
  });
});

describe("ensureConfigBacking", () => {
  it("prepends the default config when the value has no config ref", () => {
    expect(ensureConfigBacking('{"a":1}', "base")).toBe(
      '{"$extends":["@config:base"],"a":1}',
    );
  });

  it("leaves a value that already references a config unchanged", () => {
    const v = '{"$extends":["@config:child"],"a":1}';
    expect(ensureConfigBacking(v, "base")).toBe(v);
  });

  it("is a no-op without a default config key", () => {
    expect(ensureConfigBacking('{"a":1}', null)).toBe('{"a":1}');
  });

  it("backs an empty/undefined value with just the default config", () => {
    expect(ensureConfigBacking(undefined, "base")).toBe(
      '{"$extends":["@config:base"]}',
    );
  });
});

describe("getConfigSubtree", () => {
  const configs = [
    { key: "base" },
    { key: "child", parent: "base" },
    { key: "grandchild", parent: "child" },
    { key: "sibling", parent: "base" },
    { key: "unrelated" },
    { key: "other-child", parent: "unrelated" },
  ];

  it("returns the root and all descendants in BFS order", () => {
    expect(getConfigSubtree("base", configs)).toEqual([
      "base",
      "child",
      "sibling",
      "grandchild",
    ]);
  });

  it("returns only the root when it has no children", () => {
    expect(getConfigSubtree("grandchild", configs)).toEqual(["grandchild"]);
  });

  it("does not include unrelated lineages", () => {
    const keys = getConfigSubtree("base", configs);
    expect(keys).not.toContain("unrelated");
    expect(keys).not.toContain("other-child");
  });

  it("descends through mixin (extends) edges, not just parent", () => {
    expect(
      getConfigSubtree("base", [
        { key: "base" },
        { key: "mixed", extends: ["base"] },
      ]),
    ).toEqual(["base", "mixed"]);
  });

  it("includes a config reached via parent OR extends, once", () => {
    const keys = getConfigSubtree("base", [
      { key: "base" },
      { key: "child", parent: "base" },
      { key: "leaf", parent: "child", extends: ["base"] },
    ]);
    expect(keys).toEqual(["base", "child", "leaf"]);
  });

  it("tolerates parent cycles", () => {
    const cyclic = [
      { key: "a", parent: "b" },
      { key: "b", parent: "a" },
    ];
    expect(getConfigSubtree("a", cyclic)).toEqual(["a", "b"]);
  });
});

describe("orderConfigsByLineage", () => {
  const flat = (configs: { key: string; name?: string; parent?: string }[]) =>
    orderConfigsByLineage(configs).map(({ config, depth }) => [
      config.key,
      depth,
    ]);

  it("orders roots alphabetically by name, children nested under parents", () => {
    expect(
      flat([
        { key: "b-child", name: "B child", parent: "b-root" },
        { key: "b-root", name: "B root" },
        { key: "a-root", name: "A root" },
        { key: "a-child", name: "A child", parent: "a-root" },
      ]),
    ).toEqual([
      ["a-root", 0],
      ["a-child", 1],
      ["b-root", 0],
      ["b-child", 1],
    ]);
  });

  it("sorts siblings alphabetically and increments depth per level", () => {
    expect(
      flat([
        { key: "root", name: "Root" },
        { key: "z", name: "Z", parent: "root" },
        { key: "a", name: "A", parent: "root" },
        { key: "a-kid", name: "A kid", parent: "a" },
      ]),
    ).toEqual([
      ["root", 0],
      ["a", 1],
      ["a-kid", 2],
      ["z", 1],
    ]);
  });

  it("treats a config whose parent is outside the set as a root", () => {
    expect(
      flat([{ key: "child", name: "Child", parent: "absent-parent" }]),
    ).toEqual([["child", 0]]);
  });

  it("falls back to the key when a name is missing", () => {
    expect(flat([{ key: "b" }, { key: "a" }])).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
  });

  it("tolerates parent cycles without infinite recursion", () => {
    const result = flat([
      { key: "a", name: "A", parent: "b" },
      { key: "b", name: "B", parent: "a" },
    ]);
    expect(result.map(([key]) => key).sort()).toEqual(["a", "b"]);
    expect(result).toHaveLength(2);
  });

  it("preserveRootOrder keeps roots in input order but still name-sorts children", () => {
    expect(
      orderConfigsByLineage(
        [
          // Roots arrive in a caller-chosen order (e.g. an active table sort),
          // NOT alphabetical.
          { key: "b-root", name: "B root" },
          { key: "b-z", name: "Z", parent: "b-root" },
          { key: "b-a", name: "A", parent: "b-root" },
          { key: "a-root", name: "A root" },
        ],
        { preserveRootOrder: true },
      ).map(({ config, depth }) => [config.key, depth]),
    ).toEqual([
      // b-root before a-root (input order preserved), children A before Z.
      ["b-root", 0],
      ["b-a", 1],
      ["b-z", 1],
      ["a-root", 0],
    ]);
  });
});

describe("getFeatureBaseConfigKey", () => {
  it("returns the first-class baseConfig for a JSON flag", () => {
    expect(
      getFeatureBaseConfigKey({ valueType: "json", baseConfig: "pricing" }),
    ).toBe("pricing");
  });

  it("returns null for a JSON flag with no baseConfig (no $extends fallback)", () => {
    // baseConfig is the SOLE source — a stray inline @config: does not count.
    expect(getFeatureBaseConfigKey({ valueType: "json" })).toBeNull();
    expect(
      getFeatureBaseConfigKey({ valueType: "json", baseConfig: null }),
    ).toBeNull();
  });

  it("returns null for a non-JSON flag even when baseConfig is set", () => {
    expect(
      getFeatureBaseConfigKey({ valueType: "string", baseConfig: "pricing" }),
    ).toBeNull();
    expect(
      getFeatureBaseConfigKey({ valueType: "boolean", baseConfig: "pricing" }),
    ).toBeNull();
  });
});

describe("getConfigSpineSubtree", () => {
  it("descends the parent spine only, in BFS order", () => {
    const configs = [
      { key: "base" },
      { key: "child", parent: "base" },
      { key: "grandchild", parent: "child" },
      { key: "sibling", parent: "base" },
    ];
    expect(getConfigSpineSubtree("base", configs)).toEqual([
      "base",
      "child",
      "sibling",
      "grandchild",
    ]);
  });

  it("does NOT pull in cross-family configs that only mixin a family member", () => {
    const configs = [
      { key: "base" },
      { key: "child", parent: "base" },
      // `mixer` lives in another family and merely composes `child`; it must not
      // appear in `base`'s spine tree (unlike getConfigSubtree).
      { key: "mixer", parent: "other-root", extends: ["child"] },
      { key: "other-root" },
    ];
    expect(getConfigSpineSubtree("base", configs)).toEqual(["base", "child"]);
  });

  it("tolerates parent cycles", () => {
    const cyclic = [
      { key: "a", parent: "b" },
      { key: "b", parent: "a" },
    ];
    expect(getConfigSpineSubtree("a", cyclic)).toEqual(["a", "b"]);
  });
});

describe("getConfigBaseKeys", () => {
  it("returns the parent first, then extends in order", () => {
    expect(
      getConfigBaseKeys({ parent: "base", extends: ["theme", "ab"] }),
    ).toEqual(["base", "theme", "ab"]);
  });

  it("dedups while preserving order (parent wins its slot)", () => {
    expect(
      getConfigBaseKeys({
        parent: "base",
        extends: ["base", "theme", "theme"],
      }),
    ).toEqual(["base", "theme"]);
  });

  it("handles no parent / no extends", () => {
    expect(getConfigBaseKeys({})).toEqual([]);
    expect(getConfigBaseKeys({ extends: ["a"] })).toEqual(["a"]);
  });
});

describe("getConfigSpineRootKey", () => {
  const byKey = new Map<string, { key: string; parent?: string }>([
    ["base", { key: "base" }],
    ["child", { key: "child", parent: "base" }],
    ["leaf", { key: "leaf", parent: "child" }],
  ]);

  it("walks the parent spine to the root", () => {
    expect(getConfigSpineRootKey("leaf", byKey)).toBe("base");
  });

  it("returns the key itself for a root", () => {
    expect(getConfigSpineRootKey("base", byKey)).toBe("base");
  });

  it("ignores extends mixins (spine = parent only)", () => {
    const m = new Map<string, { key: string; parent?: string }>([
      ["root", { key: "root" }],
      ["mixroot", { key: "mixroot" }],
      ["leaf", { key: "leaf", parent: "root" }],
    ]);
    expect(getConfigSpineRootKey("leaf", m)).toBe("root");
  });

  it("is cycle-safe", () => {
    const m = new Map<string, { key: string; parent?: string }>([
      ["a", { key: "a", parent: "b" }],
      ["b", { key: "b", parent: "a" }],
    ]);
    expect(["a", "b"]).toContain(getConfigSpineRootKey("a", m));
  });
});

describe("getConfigParentKey", () => {
  it("returns the explicit parent field", () => {
    expect(getConfigParentKey({ parent: "base" })).toBe("base");
  });

  it("returns null with no parent (no in-value fallback)", () => {
    expect(getConfigParentKey({})).toBeNull();
    expect(getConfigParentKey({ parent: "" })).toBeNull();
  });
});

describe("stripExtends", () => {
  it("removes the $extends directive but keeps other keys", () => {
    expect(stripExtends('{"$extends":["@config:base"],"a":1}')).toBe('{"a":1}');
  });

  it("leaves a value without $extends unchanged", () => {
    expect(stripExtends('{"a":1}')).toBe('{"a":1}');
  });

  it("passes through undefined", () => {
    expect(stripExtends(undefined)).toBeUndefined();
  });
});

describe("withConfigExtends", () => {
  it("injects a single @config: base ref as the first $extends entry", () => {
    expect(withConfigExtends('{"a":1}', ["base"])).toBe(
      '{"$extends":["@config:base"],"a":1}',
    );
  });

  it("injects multiple base refs in order (parent, then mixins)", () => {
    expect(withConfigExtends('{"a":1}', ["base", "theme", "ab"])).toBe(
      '{"$extends":["@config:base","@config:theme","@config:ab"],"a":1}',
    );
  });

  it("replaces any pre-existing @config refs with the supplied bases", () => {
    expect(
      withConfigExtends('{"$extends":["@config:old"],"a":1}', ["base"]),
    ).toBe('{"$extends":["@config:base"],"a":1}');
  });

  it("strips $extends when there are no bases", () => {
    expect(withConfigExtends('{"$extends":["@config:old"],"a":1}', [])).toBe(
      '{"a":1}',
    );
  });

  it("preserves @const refs, prepending the bases first", () => {
    expect(
      withConfigExtends('{"$extends":["@const:flags"],"a":1}', ["base", "ab"]),
    ).toBe('{"$extends":["@config:base","@config:ab","@const:flags"],"a":1}');
  });

  it("keeps @const refs even with no bases", () => {
    expect(withConfigExtends('{"$extends":["@const:flags"],"a":1}', [])).toBe(
      '{"$extends":["@const:flags"],"a":1}',
    );
  });
});

describe("stripConfigExtends", () => {
  it("drops @config refs but keeps @const refs", () => {
    expect(
      stripConfigExtends('{"$extends":["@config:base","@const:flags"],"a":1}'),
    ).toBe('{"$extends":["@const:flags"],"a":1}');
  });

  it("removes $extends entirely when only @config refs remain", () => {
    expect(stripConfigExtends('{"$extends":["@config:base"],"a":1}')).toBe(
      '{"a":1}',
    );
  });

  it("leaves a value without $extends unchanged", () => {
    expect(stripConfigExtends('{"a":1}')).toBe('{"a":1}');
  });

  it("passes through undefined", () => {
    expect(stripConfigExtends(undefined)).toBeUndefined();
  });

  it("leaves a non-array $extends data key intact (doesn't drop it)", () => {
    expect(stripConfigExtends('{"$extends":"literal","a":1}')).toBe(
      '{"$extends":"literal","a":1}',
    );
  });
});

describe("config-backed feature values", () => {
  it("composes a config key + patch into an $extends-first value", () => {
    expect(setConfigBacking("base", '{"a":1}')).toBe(
      '{"$extends":["@config:base"],"a":1}',
    );
  });

  it("returns just the patch when there is no config key", () => {
    expect(setConfigBacking(null, '{"a":1}')).toBe('{"a":1}');
  });

  it("drops any stray @config: from the incoming patch", () => {
    expect(setConfigBacking("base", '{"$extends":["@config:x"],"a":1}')).toBe(
      '{"$extends":["@config:base"],"a":1}',
    );
  });

  it("keeps @const: refs from the patch after the config ref", () => {
    expect(setConfigBacking("base", '{"$extends":["@const:c"],"a":1}')).toBe(
      '{"$extends":["@config:base","@const:c"],"a":1}',
    );
  });

  it("preserves @const: refs when detaching the config", () => {
    expect(setConfigBacking(null, '{"$extends":["@const:c"],"a":1}')).toBe(
      '{"$extends":["@const:c"],"a":1}',
    );
  });

  it("returns a non-object patch verbatim when detaching", () => {
    expect(setConfigBacking(null, "true")).toBe("true");
  });

  it("returns a non-object patch verbatim when attaching (replace semantics)", () => {
    expect(setConfigBacking("my-cfg", "true")).toBe("true");
    expect(setConfigBacking("my-cfg", "[1,2]")).toBe("[1,2]");
  });

  it("still backs an empty patch with just the config ref", () => {
    expect(setConfigBacking("my-cfg", "")).toBe(
      '{"$extends":["@config:my-cfg"]}',
    );
    expect(setConfigBacking("my-cfg", undefined)).toBe(
      '{"$extends":["@config:my-cfg"]}',
    );
  });

  it("getConfigBackingPatch keeps @const: refs while dropping the config", () => {
    expect(
      getConfigBackingPatch('{"$extends":["@config:base","@const:c"],"a":1}'),
    ).toBe('{"$extends":["@const:c"],"a":1}');
  });

  it("round-trips key + patch via the getters", () => {
    const stored = setConfigBacking("base", '{"a":1,"b":2}');
    expect(getConfigBackingKey(stored)).toBe("base");
    expect(JSON.parse(getConfigBackingPatch(stored))).toEqual({ a: 1, b: 2 });
  });

  it("returns null backing key for a plain value", () => {
    expect(getConfigBackingKey('{"a":1}')).toBeNull();
    expect(getConfigBackingKey(undefined)).toBeNull();
  });

  it("only treats a @config: ref as backing when it is the first entry", () => {
    expect(
      getConfigBackingKey('{"$extends":["@const:c","@config:base"]}'),
    ).toBeNull();
  });
});

describe("valueHasConfigExtends", () => {
  it("detects a @config: ref anywhere in $extends (unlike getConfigBackingKey)", () => {
    expect(valueHasConfigExtends('{"$extends":["@config:base"]}')).toBe(true);
    // Not first — the REST guard still rejects it, whereas getConfigBackingKey
    // returns null for this same value.
    expect(
      valueHasConfigExtends('{"$extends":["@const:c","@config:base"]}'),
    ).toBe(true);
  });

  it("returns false without a @config: ref", () => {
    expect(valueHasConfigExtends('{"$extends":["@const:c"]}')).toBe(false);
    expect(valueHasConfigExtends('{"a":1}')).toBe(false);
    expect(valueHasConfigExtends("[1,2,3]")).toBe(false);
    expect(valueHasConfigExtends(undefined)).toBe(false);
  });
});

describe("getAncestorSchemaKeys", () => {
  const byKey = new Map([
    ["base", { schema: objSchema("color", "size") }],
    ["child", { parent: "base", schema: objSchema("weight") }],
    ["grandchild", { parent: "child", schema: objSchema("price") }],
  ]);

  it("unions every ancestor's own schema field keys", () => {
    expect(
      [...getAncestorSchemaKeys(byKey.get("grandchild")!, byKey)].sort(),
    ).toEqual(["color", "size", "weight"]);
  });

  it("returns an empty set for a root config", () => {
    expect(getAncestorSchemaKeys(byKey.get("base")!, byKey).size).toBe(0);
  });

  it("is cycle-safe when parents form a loop", () => {
    const looped = new Map([
      ["a", { parent: "b", schema: objSchema("x") }],
      ["b", { parent: "a", schema: objSchema("y") }],
    ]);
    expect([...getAncestorSchemaKeys(looped.get("a")!, looped)].sort()).toEqual(
      ["x", "y"],
    );
  });

  it("unions keys across parent AND extends bases (DAG)", () => {
    const m = new Map([
      ["base", { schema: objSchema("color") }],
      ["theme", { schema: objSchema("font") }],
      [
        "leaf",
        { parent: "base", extends: ["theme"], schema: objSchema("own") },
      ],
    ]);
    expect([...getAncestorSchemaKeys(m.get("leaf")!, m)].sort()).toEqual([
      "color",
      "font",
    ]);
  });
});

describe("getConfigAncestorKeys", () => {
  const byKey = new Map([
    ["root", {}],
    ["mid", { parent: "root" }],
    ["leaf", { parent: "mid" }],
    ["theme", { parent: "root" }],
  ]);

  it("collects the transitive parent chain", () => {
    expect(
      [...getConfigAncestorKeys(byKey.get("leaf")!, byKey)].sort(),
    ).toEqual(["mid", "root"]);
  });

  it("returns an empty set for a root config", () => {
    expect(getConfigAncestorKeys(byKey.get("root")!, byKey).size).toBe(0);
  });

  it("walks extends mixins and their own ancestors (DAG, deduped)", () => {
    const leaf = { parent: "mid", extends: ["theme"] };
    expect([...getConfigAncestorKeys(leaf, byKey)].sort()).toEqual([
      "mid",
      "root",
      "theme",
    ]);
  });

  it("uses the staged bases, not the stored ones", () => {
    // A publish that re-parents `leaf` under `theme` is judged by its new family.
    const staged = { parent: "theme" };
    expect([...getConfigAncestorKeys(staged, byKey)].sort()).toEqual([
      "root",
      "theme",
    ]);
  });

  it("includes dangling base keys and is cycle-safe", () => {
    const looped = new Map([
      ["a", { parent: "b" }],
      ["b", { parent: "a" }],
    ]);
    expect([...getConfigAncestorKeys(looped.get("a")!, looped)].sort()).toEqual(
      ["a", "b"],
    );
    expect([...getConfigAncestorKeys({ parent: "ghost" }, byKey)]).toEqual([
      "ghost",
    ]);
  });
});

describe("findBasePrecedenceInversions", () => {
  const bases = (
    nodes: { key: string; parent?: string; extends?: string[] }[],
  ) => new Map(nodes.map((n) => [n.key, n]));

  it("flags a later base that is an ancestor of an earlier one", () => {
    const byKey = bases([
      { key: "root" },
      { key: "mid", parent: "root" },
      { key: "leaf" },
    ]);
    expect(
      findBasePrecedenceInversions({ extends: ["mid", "root"] }, byKey),
    ).toEqual([{ earlier: "mid", ancestor: "root" }]);
  });

  it("allows the diamond pattern (earlier base is an ancestor of a later one)", () => {
    const byKey = bases([{ key: "root" }, { key: "mixin", parent: "root" }]);
    expect(
      findBasePrecedenceInversions(
        { parent: "root", extends: ["mixin"] },
        byKey,
      ),
    ).toEqual([]);
    expect(
      findBasePrecedenceInversions({ extends: ["root", "mixin"] }, byKey),
    ).toEqual([]);
  });

  it("walks transitive ancestry through extends edges", () => {
    const byKey = bases([
      { key: "root" },
      { key: "a", extends: ["root"] },
      { key: "b", parent: "a" },
    ]);
    expect(
      findBasePrecedenceInversions({ extends: ["b", "root"] }, byKey),
    ).toEqual([{ earlier: "b", ancestor: "root" }]);
  });

  it("returns [] for unknown bases or no bases", () => {
    expect(
      findBasePrecedenceInversions({ extends: ["x", "y"] }, bases([])),
    ).toEqual([]);
    expect(findBasePrecedenceInversions({}, bases([]))).toEqual([]);
  });
});

describe("stripAncestorOwnedFields", () => {
  it("drops fields whose key an ancestor owns (base wins)", () => {
    const kept = stripAncestorOwnedFields(
      objSchema("color", "weight"),
      new Set(["color"]),
    );
    expect(kept?.map((f) => f.key)).toEqual(["weight"]);
  });

  it("returns null when there are no collisions", () => {
    expect(
      stripAncestorOwnedFields(objSchema("weight"), new Set(["color"])),
    ).toBeNull();
  });

  it("returns null for an empty schema or no ancestor keys", () => {
    expect(
      stripAncestorOwnedFields(objSchema(), new Set(["color"])),
    ).toBeNull();
    expect(stripAncestorOwnedFields(objSchema("color"), new Set())).toBeNull();
  });

  it("returns null for a cleared schema (null), like an absent one", () => {
    expect(stripAncestorOwnedFields(null, new Set(["color"]))).toBeNull();
  });
});

describe("configIsExtensible", () => {
  it("prefers the root config's explicit flag", () => {
    expect(configIsExtensible({ extensible: false }, true)).toBe(false);
    expect(configIsExtensible({ extensible: true }, false)).toBe(true);
  });

  it("falls back to the org default when unset", () => {
    expect(configIsExtensible({}, false)).toBe(false);
    expect(configIsExtensible(undefined, true)).toBe(true);
  });

  it("defaults to permissive when nothing is set", () => {
    expect(configIsExtensible(undefined, undefined)).toBe(true);
  });
});

describe("linearizeConfigDag", () => {
  type Node = {
    key: string;
    name?: string;
    value?: string;
    schema?: SimpleSchema;
    parent?: string;
    extends?: string[];
  };
  const map = (nodes: Node[]) => new Map(nodes.map((n) => [n.key, n]));
  const order = (nodes: Node[], leaf: string) =>
    linearizeConfigDag(leaf, map(nodes)).map((n) => n.key);

  it("emits bases before the leaf (parent spine)", () => {
    expect(
      order(
        [
          { key: "base" },
          { key: "child", parent: "base" },
          { key: "leaf", parent: "child" },
        ],
        "leaf",
      ),
    ).toEqual(["base", "child", "leaf"]);
  });

  it("orders mixins after parent, in array order (later wins)", () => {
    expect(
      order(
        [
          { key: "base" },
          { key: "theme" },
          { key: "ab" },
          { key: "leaf", parent: "base", extends: ["theme", "ab"] },
        ],
        "leaf",
      ),
    ).toEqual(["base", "theme", "ab", "leaf"]);
  });

  it("dedups a diamond base, emitting it once before dependents", () => {
    const out = order(
      [
        { key: "base" },
        { key: "b", parent: "base" },
        { key: "c", parent: "base" },
        { key: "leaf", parent: "b", extends: ["c"] },
      ],
      "leaf",
    );
    expect(out).toEqual(["base", "b", "c", "leaf"]);
  });

  it("is cycle-safe", () => {
    const out = order(
      [
        { key: "a", parent: "b" },
        { key: "b", parent: "a" },
      ],
      "a",
    );
    expect(out).toContain("a");
    expect(new Set(out).size).toBe(out.length);
  });
});

describe("findSiblingSchemaConflicts", () => {
  const byKey = new Map([
    ["base", { key: "base", schema: objSchema("color") }],
    ["theme", { key: "theme", schema: objSchema("token") }],
    ["ab", { key: "ab", schema: objSchema("token") }],
    ["safe", { key: "safe", schema: objSchema("size") }],
  ]);

  it("flags a field declared by two sibling bases", () => {
    const conflicts = findSiblingSchemaConflicts(
      { extends: ["theme", "ab"] },
      byKey,
    );
    expect(conflicts).toEqual([{ key: "token", owners: ["ab", "theme"] }]);
  });

  it("returns none when bases own disjoint fields", () => {
    expect(
      findSiblingSchemaConflicts({ parent: "base", extends: ["safe"] }, byKey),
    ).toEqual([]);
  });

  it("does not flag a diamond (single shared owner)", () => {
    const m = new Map([
      ["base", { key: "base", schema: objSchema("color") }],
      ["b", { key: "b", parent: "base", schema: objSchema("bb") }],
      ["c", { key: "c", parent: "base", schema: objSchema("cc") }],
    ]);
    expect(
      findSiblingSchemaConflicts({ parent: "b", extends: ["c"] }, m),
    ).toEqual([]);
  });
});

describe("findIncompatibleConfigValueKeys", () => {
  const intField = (key: string): SchemaField => ({
    key,
    type: "integer",
    required: false,
    default: "",
    description: "",
    enum: [],
  });
  const fields = [intField("count")];

  it("flags an own value whose type mismatches the effective field", () => {
    expect(
      findIncompatibleConfigValueKeys({
        value: { count: "not-a-number" },
        fields,
      }),
    ).toEqual(["count"]);
  });

  it("returns none when values conform", () => {
    expect(
      findIncompatibleConfigValueKeys({
        value: { count: 3 },
        fields,
      }),
    ).toEqual([]);
  });

  it("exempts reference-backed values", () => {
    expect(
      findIncompatibleConfigValueKeys({
        value: { count: "{{ @const:n }}" },
        fields,
      }),
    ).toEqual([]);
  });

  it("does NOT flag unknown/extra keys (extensibility is enforced elsewhere)", () => {
    // An extra key isn't a type incompatibility — even against a field set that
    // would be non-extensible, this scan only reports mismatched declared types.
    expect(
      findIncompatibleConfigValueKeys({
        value: { count: 3, extra: "anything" },
        fields,
      }),
    ).toEqual([]);
  });

  it("flags only the type-mismatched key, ignoring a co-present extra key", () => {
    expect(
      findIncompatibleConfigValueKeys({
        value: { count: "nope", extra: "anything" },
        fields,
      }),
    ).toEqual(["count"]);
  });
});

describe("resolveConfigChain — value merge precedence", () => {
  // Chain is ordered base → leaf; values merge deepest-wins, with `source` set
  // to the deepest node that wrote each key.
  const valueByKey = (chain: ConfigChainNode[]) => {
    const { fields } = resolveConfigChain(chain);
    return new Map(fields.map((f) => [f.key, f]));
  };

  it("lets a child value override its parent for the same key", () => {
    const byKey = valueByKey([
      { key: "base", value: JSON.stringify({ color: "red", size: 1 }) },
      { key: "leaf", value: JSON.stringify({ color: "blue" }) },
    ]);
    expect(byKey.get("color")!.value).toBe("blue");
    expect(byKey.get("color")!.source).toBe("leaf");
    // A key only the parent set is inherited (base wins by default).
    expect(byKey.get("size")!.value).toBe(1);
    expect(byKey.get("size")!.source).toBe("base");
  });

  it("inherits keys only the parent defines and keeps their provenance", () => {
    const byKey = valueByKey([
      { key: "base", value: JSON.stringify({ a: 1, b: 2 }) },
      { key: "child", value: JSON.stringify({ b: 3, c: 4 }) },
      { key: "leaf", value: JSON.stringify({ c: 5 }) },
    ]);
    expect(byKey.get("a")!.value).toBe(1);
    expect(byKey.get("a")!.source).toBe("base");
    // b: child overrode base; leaf left it alone.
    expect(byKey.get("b")!.value).toBe(3);
    expect(byKey.get("b")!.source).toBe("child");
    // c: leaf overrode child (deepest wins).
    expect(byKey.get("c")!.value).toBe(5);
    expect(byKey.get("c")!.source).toBe("leaf");
  });

  it("ignores the $extends merge directive when collecting values", () => {
    const byKey = valueByKey([
      {
        key: "leaf",
        value: JSON.stringify({ $extends: ["@config:base"], a: 1 }),
      },
    ]);
    expect(byKey.has("$extends")).toBe(false);
    expect(byKey.get("a")!.value).toBe(1);
  });

  it("deep-merges a nested object: a child patches one leaf and inherits siblings", () => {
    const byKey = valueByKey([
      {
        key: "base",
        value: JSON.stringify({
          retry: { timeouts: { connect: 1000, read: 5000, write: 3000 } },
        }),
      },
      {
        key: "child",
        value: JSON.stringify({ retry: { timeouts: { read: 8000 } } }),
      },
    ]);
    // connect/write survive from base; only read is patched by the child.
    expect(byKey.get("retry")!.value).toEqual({
      timeouts: { connect: 1000, read: 8000, write: 3000 },
    });
    expect(byKey.get("retry")!.source).toBe("child");
  });

  it("deep-merges a node's variantPatch as its own top layer", () => {
    const byKey = valueByKey([
      {
        key: "base",
        value: JSON.stringify({ timeout: 3, color: "red" }),
        variantPatch: JSON.stringify({ timeout: 5 }),
      },
    ]);
    // Variant patches the base's own value for this node.
    expect(byKey.get("timeout")!.value).toBe(5);
    expect(byKey.get("color")!.value).toBe("red");
  });

  it("lets a descendant node's value win over an ancestor's variantPatch", () => {
    // base prod-variant sets timeout:5; child sets timeout:9 → child wins (leaf).
    const byKey = valueByKey([
      {
        key: "base",
        value: JSON.stringify({ timeout: 3, color: "red" }),
        variantPatch: JSON.stringify({ timeout: 5 }),
      },
      { key: "child", value: JSON.stringify({ timeout: 9 }) },
    ]);
    expect(byKey.get("timeout")!.value).toBe(9);
    expect(byKey.get("timeout")!.source).toBe("child");
    expect(byKey.get("color")!.value).toBe("red");
  });

  it("accumulates the effective schema base → leaf (first definition wins)", () => {
    const { effectiveSchema } = resolveConfigChain([
      { key: "base", schema: objSchema("color") },
      { key: "leaf", schema: objSchema("size") },
    ]);
    expect(effectiveSchema.map((f) => f.key)).toEqual(["color", "size"]);
  });

  it("merges a full linearized DAG (parent then mixins) deepest-wins", () => {
    type DagNode = ConfigChainNode & { parent?: string; extends?: string[] };
    const nodes = new Map<string, DagNode>([
      ["base", { key: "base", value: JSON.stringify({ a: 1, b: 1 }) }],
      ["theme", { key: "theme", value: JSON.stringify({ b: 2, c: 2 }) }],
      [
        "leaf",
        {
          key: "leaf",
          parent: "base",
          extends: ["theme"],
          value: JSON.stringify({ c: 3 }),
        },
      ],
    ]);
    const chain = linearizeConfigDag("leaf", nodes);
    const byKey = new Map(
      resolveConfigChain(chain).fields.map((f) => [f.key, f]),
    );
    // base sets a/b; theme (after base) overrides b and sets c; leaf overrides c.
    expect(byKey.get("a")!.value).toBe(1);
    expect(byKey.get("b")!.value).toBe(2);
    expect(byKey.get("b")!.source).toBe("theme");
    expect(byKey.get("c")!.value).toBe(3);
    expect(byKey.get("c")!.source).toBe("leaf");
  });
});

describe("computeConfigReconciliationPreview", () => {
  // root → child → grandchild spine; `unrelated` shares no base edge with root.
  const lineage = [
    { key: "root", parentKey: null, name: "Root", fieldKeys: ["a"] },
    { key: "child", parentKey: "root", name: "Child", fieldKeys: ["a", "b"] },
    {
      key: "grandchild",
      parentKey: "child",
      name: "Grandchild",
      fieldKeys: ["a", "c"],
    },
    { key: "unrelated", parentKey: null, name: "Unrelated", fieldKeys: ["a"] },
  ];

  it("returns [] when the config declares no own fields", () => {
    expect(computeConfigReconciliationPreview(lineage, "root", [])).toEqual([]);
  });

  it("reports spine descendants that redeclare an own key, in BFS order", () => {
    const hits = computeConfigReconciliationPreview(lineage, "root", ["a"]);
    // `unrelated` shares no base edge with root, so it's excluded; root itself excluded.
    expect(hits).toEqual([
      { name: "Child", keys: ["a"] },
      { name: "Grandchild", keys: ["a"] },
    ]);
  });

  it("reports mixin descendants (extends edge), matching the server cascade", () => {
    const withMixin = [
      { key: "root", parentKey: null, name: "Root", fieldKeys: ["a"] },
      { key: "child", parentKey: "root", name: "Child", fieldKeys: ["a"] },
      // Off-spine config in another family that composes root as a mixin.
      {
        key: "composer",
        parentKey: null,
        name: "Composer",
        fieldKeys: ["a"],
        extendsKeys: ["root"],
      },
    ];
    const hits = computeConfigReconciliationPreview(withMixin, "root", ["a"]);
    expect(hits).toEqual([
      { name: "Child", keys: ["a"] },
      { name: "Composer", keys: ["a"] },
    ]);
  });

  it("only reports the keys that actually collide", () => {
    const hits = computeConfigReconciliationPreview(lineage, "child", [
      "b",
      "c",
    ]);
    // Only grandchild descends from child; it declares `c` (collides) not `b`.
    expect(hits).toEqual([{ name: "Grandchild", keys: ["c"] }]);
  });

  it("returns [] when no descendant collides", () => {
    expect(
      computeConfigReconciliationPreview(lineage, "grandchild", ["a"]),
    ).toEqual([]);
  });
});

// --- Cross-field invariants across a family --------------------------------

const inv = (name: string, rule: unknown, message: string) => ({
  name,
  rule: typeof rule === "string" ? rule : JSON.stringify(rule),
  message,
});

type DagNode = {
  key: string;
  name?: string;
  parent?: string;
  extends?: string[];
  value?: string;
  schema?: SimpleSchema;
  variantPatch?: string;
};
const dagMap = (nodes: DagNode[]) => new Map(nodes.map((n) => [n.key, n]));

const noDebug = inv(
  "no-debug",
  { log_level: { $ne: "debug" } },
  "Production configs cannot run at debug verbosity.",
);

describe("collectResolvedConfigValueViolations", () => {
  const numField = (key: string): SchemaField => ({
    key,
    type: "integer",
    required: false,
    default: "",
    description: "",
    enum: [],
  });

  it("returns [] for a concrete value that conforms to schema + invariants", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: {
          type: "object",
          fields: [numField("min"), numField("max")],
          invariants: [
            inv("order", { min: { $lte: { $ref: "max" } } }, "min > max"),
          ],
        },
        value: "{}",
      },
    ]);
    expect(
      collectResolvedConfigValueViolations({
        configKey: "base",
        value: { min: 1, max: 5 },
        byKey,
        additionalProperties: true,
      }),
    ).toEqual([]);
  });

  it("flags a resolved value whose field type violates the effective schema", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: { type: "object", fields: [numField("limit")] },
        value: "{}",
      },
    ]);
    const errors = collectResolvedConfigValueViolations({
      configKey: "base",
      // A constant resolved a string into a numeric field.
      value: { limit: "not-a-number" },
      byKey,
      additionalProperties: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("flags a resolved value that violates an effective invariant", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: {
          type: "object",
          fields: [numField("min"), numField("max")],
          invariants: [
            inv("order", { min: { $lte: { $ref: "max" } } }, "min > max"),
          ],
        },
        value: "{}",
      },
    ]);
    expect(
      collectResolvedConfigValueViolations({
        configKey: "base",
        value: { min: 9, max: 2 },
        byKey,
        additionalProperties: true,
      }),
    ).toEqual(['validation rule "order": min > max']);
  });

  it("keeps two rules with identical messages distinguishable (fingerprint identity)", () => {
    // The violation strings double as the schema-break guard's arm-time
    // acknowledgment fingerprint — if two rules collapsed to the same string, a
    // NEW break from one could masquerade as the acknowledged break of the other.
    const byKey = dagMap([
      {
        key: "base",
        schema: {
          type: "object",
          fields: [numField("min"), numField("max"), numField("cap")],
          invariants: [
            inv("order", { min: { $lte: { $ref: "max" } } }, "invalid range"),
            inv("cap", { max: { $lte: { $ref: "cap" } } }, "invalid range"),
          ],
        },
        value: "{}",
      },
    ]);
    expect(
      collectResolvedConfigValueViolations({
        configKey: "base",
        value: { min: 9, max: 2, cap: 1 },
        byKey,
        additionalProperties: true,
      }),
    ).toEqual([
      'validation rule "order": invalid range',
      'validation rule "cap": invalid range',
    ]);
  });

  it("applies a base config's invariant to a descendant's resolved value", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: {
          type: "object",
          fields: [numField("min"), numField("max")],
          invariants: [
            inv("order", { min: { $lte: { $ref: "max" } } }, "min > max"),
          ],
        },
        value: "{}",
      },
      { key: "child", parent: "base", value: "{}" },
    ]);
    expect(
      collectResolvedConfigValueViolations({
        configKey: "child",
        value: { min: 9, max: 2 },
        byKey,
        additionalProperties: true,
      }),
    ).toEqual(['validation rule "order": min > max']);
  });
});

describe("collectConfigInvariantViolations", () => {
  it("evaluates rules accumulated base → leaf against the resolved value", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: { ...objSchema("log_level"), invariants: [noDebug] },
        value: '{"log_level":"info"}',
      },
      { key: "child", parent: "base", value: '{"log_level":"debug"}' },
    ]);
    expect(collectConfigInvariantViolations("base", byKey)).toEqual([]);
    expect(collectConfigInvariantViolations("child", byKey)).toEqual([
      {
        name: "no-debug",
        message: "Production configs cannot run at debug verbosity.",
      },
    ]);
  });

  it("evaluates a node's variantPatch (env flavor) against the invariant", () => {
    const numF = (key: string): SchemaField => ({
      key,
      type: "integer",
      required: false,
      default: "",
      description: "",
      enum: [],
    });
    const byKey = dagMap([
      {
        key: "base",
        schema: {
          type: "object",
          fields: [numF("target"), numF("max")],
          invariants: [
            inv("order", { target: { $lte: { $ref: "max" } } }, "target > max"),
          ],
        },
        value: '{"target":5,"max":10}',
      },
    ]);
    // Base alone satisfies the invariant (5 <= 10).
    expect(collectConfigInvariantViolations("base", byKey)).toEqual([]);
    // A prod flavor lowers max to 3 → the per-environment resolved value
    // (target 5, max 3) violates. The variantPatch must flow through
    // linearizeConfigDag → resolveConfigChain into the invariant evaluation.
    byKey.set("base", {
      ...byKey.get("base"),
      variantPatch: '{"max":3}',
    } as DagNode);
    expect(collectConfigInvariantViolations("base", byKey)).toEqual([
      { name: "order", message: "target > max" },
    ]);
  });

  it("lets a leaf override a same-named inherited rule (leaf wins)", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: {
          ...objSchema("n"),
          invariants: [inv("cap", { n: { $lte: 5 } }, "base cap")],
        },
        value: '{"n":1}',
      },
      {
        key: "child",
        parent: "base",
        schema: {
          type: "object",
          fields: [],
          invariants: [inv("cap", { n: { $lte: 10 } }, "child cap")],
        },
        value: '{"n":7}',
      },
    ]);
    // n=7 fails the base's cap but satisfies the child's override.
    expect(collectConfigInvariantViolations("child", byKey)).toEqual([]);
    byKey.set("child", { ...byKey.get("child"), value: '{"n":12}' } as DagNode);
    expect(collectConfigInvariantViolations("child", byKey)).toEqual([
      { name: "cap", message: "child cap" },
    ]);
  });

  it("supports field-to-field $ref rules", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: {
          ...objSchema("a", "b"),
          invariants: [inv("order", { a: { $lte: { $ref: "b" } } }, "a > b")],
        },
        value: '{"a":1,"b":2}',
      },
      { key: "child", parent: "base", value: '{"b":0}' },
    ]);
    expect(collectConfigInvariantViolations("base", byKey)).toEqual([]);
    expect(collectConfigInvariantViolations("child", byKey)).toEqual([
      { name: "order", message: "a > b" },
    ]);
  });

  it("surfaces a malformed rule as a violation instead of throwing", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: {
          ...objSchema("x"),
          invariants: [inv("broken", "not json", "broken rule")],
        },
        value: '{"x":1}',
      },
    ]);
    expect(collectConfigInvariantViolations("base", byKey)).toEqual([
      { name: "broken", message: "broken rule" },
    ]);
  });

  it("returns [] when no config in the chain declares invariants", () => {
    const byKey = dagMap([
      { key: "base", schema: objSchema("x"), value: '{"x":1}' },
      { key: "child", parent: "base", value: '{"x":2}' },
    ]);
    expect(collectConfigInvariantViolations("child", byKey)).toEqual([]);
  });

  it("skips rules over reference-backed fields (raw tokens can't be compared)", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: {
          ...objSchema("log_level", "n"),
          invariants: [
            inv("must-info", { log_level: "info" }, "must run at info"),
            inv("cap", { n: { $lte: 5 } }, "cap exceeded"),
          ],
        },
        value: '{"log_level":"@const:level","n":7}',
      },
    ]);
    // The ref-backed rule is skipped; the concrete one still evaluates.
    expect(collectConfigInvariantViolations("base", byKey)).toEqual([
      { name: "cap", message: "cap exceeded" },
    ]);
  });

  it("skips rules over interpolated ({{ @const:... }}) fields too", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: {
          ...objSchema("log_level"),
          invariants: [inv("must-info", { log_level: "info" }, "must info")],
        },
        value: '{"log_level":"{{ @const:level }}"}',
      },
    ]);
    expect(collectConfigInvariantViolations("base", byKey)).toEqual([]);
  });

  it("exempts the chain when a node supplies fields via a @const/@config $extends layer", () => {
    // The invariant's field is supplied only by a reference layer (unresolvable
    // at gate time), so it must not produce a false violation (regression guard).
    const base = {
      key: "base",
      schema: {
        ...objSchema("region"),
        invariants: [inv("must-us", { region: "us" }, "must be us")],
      },
      value: "{}",
    };
    const constLayer = dagMap([
      base,
      {
        key: "leaf",
        parent: "base",
        value: '{"$extends":["@const:regional"]}',
      },
    ]);
    expect(collectConfigInvariantViolations("leaf", constLayer)).toEqual([]);

    const configLayer = dagMap([
      base,
      { key: "leaf", parent: "base", value: '{"$extends":["@config:other"]}' },
    ]);
    expect(collectConfigInvariantViolations("leaf", configLayer)).toEqual([]);

    // Control: the same leaf with a concrete (non-layer) value resolves the
    // field and DOES fail — proving the exemption above is load-bearing.
    const noLayer = dagMap([
      base,
      { key: "leaf", parent: "base", value: '{"region":"eu"}' },
    ]);
    expect(collectConfigInvariantViolations("leaf", noLayer)).toEqual([
      { name: "must-us", message: "must be us" },
    ]);

    // Mixed: a reference layer is present BUT the invariant's field is also
    // concretely set — it must still be evaluated (the layer elsewhere in the
    // chain doesn't exempt a field we can resolve). Regression guard against an
    // over-broad whole-chain exemption.
    const layerPlusConcrete = dagMap([
      base,
      {
        key: "leaf",
        parent: "base",
        value: '{"$extends":["@config:other"],"region":"eu"}',
      },
    ]);
    expect(collectConfigInvariantViolations("leaf", layerPlusConcrete)).toEqual(
      [{ name: "must-us", message: "must be us" }],
    );
  });
});

describe("configChainDeclaresReferenceLayer", () => {
  it("detects a @const $extends layer on any chain node", () => {
    const chain: ConfigChainNode[] = [
      { key: "base", value: '{"a":1}' },
      { key: "leaf", value: '{"$extends":["@const:defaults"],"b":2}' },
    ];
    expect(configChainDeclaresReferenceLayer(chain)).toBe(true);
  });

  it("returns false when no node declares a reference layer", () => {
    const chain: ConfigChainNode[] = [
      { key: "base", value: '{"a":1}' },
      { key: "leaf", value: '{"b":"@const:x"}' },
      { key: "other", value: undefined },
    ];
    expect(configChainDeclaresReferenceLayer(chain)).toBe(false);
  });

  it("ignores non-reference $extends entries", () => {
    const chain: ConfigChainNode[] = [
      { key: "leaf", value: '{"$extends":[{"a":1}]}' },
    ];
    expect(configChainDeclaresReferenceLayer(chain)).toBe(false);
  });

  it("detects a reference layer declared by a node's variantPatch (env flavor)", () => {
    const chain: ConfigChainNode[] = [
      {
        key: "base",
        value: '{"a":1}',
        // The flavor patch extends its own @config mixin — unresolvable at gate
        // time, so the chain must count as declaring a reference layer.
        variantPatch: '{"$extends":["@config:prod-mixin"],"a":2}',
      },
    ];
    expect(configChainDeclaresReferenceLayer(chain)).toBe(true);
  });
});

describe("collectDescendantInvariantViolations", () => {
  it("reports a descendant whose own rule fails against a violating base value", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: objSchema("log_level"),
        value: '{"log_level":"debug"}',
      },
      {
        key: "child",
        name: "Prod API",
        parent: "base",
        schema: { type: "object", fields: [], invariants: [noDebug] },
      },
    ]);
    expect(collectDescendantInvariantViolations("base", byKey)).toEqual([
      {
        configKey: "child",
        configName: "Prod API",
        violations: [
          {
            name: "no-debug",
            message: "Production configs cannot run at debug verbosity.",
          },
        ],
      },
    ]);
  });

  it("excludes the root's own violations and clean descendants", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: { ...objSchema("log_level"), invariants: [noDebug] },
        value: '{"log_level":"debug"}',
      },
      // Override masks the violating base value.
      {
        key: "child",
        parent: "base",
        value: '{"log_level":"info"}',
      },
    ]);
    expect(collectDescendantInvariantViolations("base", byKey)).toEqual([]);
  });

  it("reaches a rule declared two levels down (grandchild)", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: objSchema("log_level"),
        value: '{"log_level":"debug"}',
      },
      { key: "child", parent: "base" },
      {
        key: "grandchild",
        parent: "child",
        schema: { type: "object", fields: [], invariants: [noDebug] },
      },
    ]);
    const hits = collectDescendantInvariantViolations("base", byKey);
    expect(hits.map((h) => h.configKey)).toEqual(["grandchild"]);
  });

  it("reaches descendants composed via `extends` (mixin edge)", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: objSchema("log_level"),
        value: '{"log_level":"debug"}',
      },
      {
        key: "composer",
        extends: ["base"],
        schema: { type: "object", fields: [], invariants: [noDebug] },
      },
      { key: "unrelated", value: '{"log_level":"debug"}' },
    ]);
    expect(
      collectDescendantInvariantViolations("base", byKey).map(
        (h) => h.configKey,
      ),
    ).toEqual(["composer"]);
  });

  it("catches a base's own rule failing only at a descendant's override", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: {
          ...objSchema("a", "b"),
          invariants: [inv("order", { a: { $lte: { $ref: "b" } } }, "a > b")],
        },
        value: '{"a":1,"b":2}',
      },
      { key: "child", parent: "base", value: '{"b":0}' },
    ]);
    expect(collectDescendantInvariantViolations("base", byKey)).toEqual([
      {
        configKey: "child",
        configName: undefined,
        violations: [{ name: "order", message: "a > b" }],
      },
    ]);
  });

  it("returns [] when no family member declares invariants", () => {
    const byKey = dagMap([
      { key: "base", schema: objSchema("x"), value: '{"x":1}' },
      { key: "child", parent: "base", value: '{"x":2}' },
    ]);
    expect(collectDescendantInvariantViolations("base", byKey)).toEqual([]);
  });
});

describe("fieldsContractEqual", () => {
  const base: SchemaField = {
    key: "count",
    type: "integer",
    required: true,
    default: "1",
    description: "how many",
    enum: [],
  };

  it("ignores description differences", () => {
    expect(
      fieldsContractEqual(base, { ...base, description: "different docs" }),
    ).toBe(true);
  });

  it("treats a redundant nullable:false as equal to absent", () => {
    expect(fieldsContractEqual(base, { ...base, nullable: false })).toBe(true);
  });

  it("distinguishes every contract property", () => {
    expect(fieldsContractEqual(base, { ...base, type: "float" })).toBe(false);
    expect(fieldsContractEqual(base, { ...base, required: false })).toBe(false);
    expect(fieldsContractEqual(base, { ...base, default: "2" })).toBe(false);
    expect(fieldsContractEqual(base, { ...base, enum: ["1", "2"] })).toBe(
      false,
    );
    expect(fieldsContractEqual(base, { ...base, min: 0 })).toBe(false);
    expect(fieldsContractEqual(base, { ...base, max: 10 })).toBe(false);
    expect(fieldsContractEqual(base, { ...base, nullable: true })).toBe(false);
    expect(
      fieldsContractEqual(base, { ...base, jsonSchema: '{"type":"string"}' }),
    ).toBe(false);
  });
});

describe("getAncestorSchemaFieldOwners", () => {
  type Node = {
    parent?: string;
    extends?: string[];
    schema?: SimpleSchema | null;
  };
  const map = (entries: Record<string, Node>) =>
    new Map(Object.entries(entries));

  it("maps each inherited field to its declaring ancestor with the definition", () => {
    const byKey = map({
      root: { schema: objSchema("a") },
      mid: { parent: "root", schema: objSchema("b") },
    });
    const owners = getAncestorSchemaFieldOwners({ parent: "mid" }, byKey);
    expect(owners.get("a")).toEqual({ owner: "root", field: field("a") });
    expect(owners.get("b")).toEqual({ owner: "mid", field: field("b") });
    expect(owners.size).toBe(2);
  });

  it("prefers the closest ancestor on a transient duplicate (BFS order)", () => {
    const conflicting: SchemaField = { ...field("a"), type: "boolean" };
    const byKey = map({
      root: { schema: objSchema("a") },
      mid: {
        parent: "root",
        schema: { type: "object", fields: [conflicting] },
      },
    });
    const owners = getAncestorSchemaFieldOwners({ parent: "mid" }, byKey);
    expect(owners.get("a")).toEqual({ owner: "mid", field: conflicting });
  });

  it("walks extends mixins and dedupes a diamond base", () => {
    const byKey = map({
      shared: { schema: objSchema("s") },
      left: { parent: "shared", schema: objSchema("l") },
      right: { parent: "shared", schema: objSchema("r") },
    });
    const owners = getAncestorSchemaFieldOwners(
      { parent: "left", extends: ["right"] },
      byKey,
    );
    expect([...owners.keys()].sort()).toEqual(["l", "r", "s"]);
    expect(owners.get("s")?.owner).toBe("shared");
  });

  it("is cycle-safe and skips dangling bases", () => {
    const byKey = map({
      a: { parent: "b", schema: objSchema("x") },
      b: { parent: "a", schema: objSchema("y") },
    });
    const owners = getAncestorSchemaFieldOwners(
      { parent: "a", extends: ["missing"] },
      byKey,
    );
    expect([...owners.keys()].sort()).toEqual(["x", "y"]);
  });

  it("treats a cleared ancestor (schema: null) as owning no fields, like absent", () => {
    const byKey = map({
      root: { schema: null }, // cleared config: no schema
      mid: { parent: "root", schema: objSchema("b") },
    });
    const owners = getAncestorSchemaFieldOwners({ parent: "mid" }, byKey);
    // Only mid's field is owned; the cleared root contributes nothing.
    expect([...owners.keys()]).toEqual(["b"]);
  });
});

describe("classifyAncestorOwnedFields", () => {
  const owners = new Map([
    ["a", { owner: "base", field: field("a") }],
    ["b", { owner: "base", field: field("b") }],
  ]);

  it("returns kept:null and empty buckets when nothing collides", () => {
    expect(classifyAncestorOwnedFields(objSchema("own"), owners)).toEqual({
      kept: null,
      identical: [],
      conflicting: [],
    });
    expect(classifyAncestorOwnedFields(undefined, owners)).toEqual({
      kept: null,
      identical: [],
      conflicting: [],
    });
    // A cleared config (schema: null) declares nothing, so nothing collides.
    expect(classifyAncestorOwnedFields(null, owners)).toEqual({
      kept: null,
      identical: [],
      conflicting: [],
    });
  });

  it("splits identical vs conflicting re-declarations and strips both", () => {
    const schema: SimpleSchema = {
      type: "object",
      fields: [
        field("a"), // identical to the owner's
        { ...field("b"), type: "integer" }, // contract differs
        field("own"),
      ],
    };
    expect(classifyAncestorOwnedFields(schema, owners)).toEqual({
      kept: [field("own")],
      identical: [{ key: "a", owner: "base" }],
      conflicting: [{ key: "b", owner: "base" }],
    });
  });

  it("treats a description-only difference as identical", () => {
    const schema: SimpleSchema = {
      type: "object",
      fields: [{ ...field("a"), description: "my own words" }],
    };
    const out = classifyAncestorOwnedFields(schema, owners);
    expect(out.identical).toEqual([{ key: "a", owner: "base" }]);
    expect(out.conflicting).toEqual([]);
    expect(out.kept).toEqual([]);
  });
});

// The reconcile input the revert's schema-clear depends on: a base whose schema
// is cleared (revert to a schema-less revision) owns zero field keys, so the
// strip cascade (getAncestorSchemaKeys → stripAncestorOwnedFields, strip-only)
// stops treating a descendant's own keys as ancestor-owned. (It does not re-add a
// previously-stripped field — clearing just removes the base's ownership.)
describe("clearing a base schema (null) makes it own no field keys", () => {
  type Node = {
    parent?: string;
    extends?: string[];
    schema?: SimpleSchema | null;
  };

  it("owns a field's key while the base has the schema, none once cleared", () => {
    const child = { parent: "base", schema: objSchema("color", "weight") };
    // Base declares "color": it's ancestor-owned, so the child's "color" strips.
    const withBase = new Map<string, Node>([
      ["base", { schema: objSchema("color") }],
      ["child", child],
    ]);
    expect([...getAncestorSchemaKeys(child, withBase)]).toEqual(["color"]);
    expect(
      stripAncestorOwnedFields(
        child.schema,
        getAncestorSchemaKeys(child, withBase),
      )?.map((f) => f.key),
    ).toEqual(["weight"]);

    // Clear the base's schema: it owns nothing, so no key of the child's is
    // ancestor-owned and the strip cascade removes nothing from it.
    const cleared = new Map<string, Node>([
      ["base", { schema: null }],
      ["child", child],
    ]);
    expect(getAncestorSchemaKeys(child, cleared).size).toBe(0);
    expect(
      stripAncestorOwnedFields(
        child.schema,
        getAncestorSchemaKeys(child, cleared),
      ),
    ).toBeNull();
  });
});

describe("ancestor collision messages", () => {
  it("names each conflicting field and its owning ancestor", () => {
    const msg = formatAncestorFieldConflictMessage([
      { key: "timeout", owner: "base" },
      { key: "retries", owner: "net-defaults" },
    ]);
    expect(msg).toContain('"timeout" (owned by "base")');
    expect(msg).toContain('"retries" (owned by "net-defaults")');
    expect(msg).toContain("override a field's value but not its schema");
  });

  it("emits a redundant-declaration warning per identical strip", () => {
    expect(ancestorCollisionWarnings([{ key: "a", owner: "base" }])).toEqual([
      {
        code: "redundant-declaration",
        path: "a",
        message: expect.stringContaining('re-declares ancestor config "base"'),
      },
    ]);
  });
});

describe("findOrphanedConfigValueKeys", () => {
  it("returns own keys the effective schema does not declare", () => {
    expect(
      findOrphanedConfigValueKeys({
        value: { a: 1, gone: 2 },
        fields: [field("a")],
      }),
    ).toEqual(["gone"]);
  });

  it("skips the $extends directive", () => {
    expect(
      findOrphanedConfigValueKeys({
        value: { $extends: ["@const:x"], gone: 2 },
        fields: [field("a")],
      }),
    ).toEqual(["gone"]);
  });

  it("returns [] for a schema-less (value-first) family", () => {
    expect(
      findOrphanedConfigValueKeys({ value: { a: 1 }, fields: [] }),
    ).toEqual([]);
  });

  it("counts reference-backed values (declaration, not type, is what matters)", () => {
    expect(
      findOrphanedConfigValueKeys({
        value: { gone: "{{ @const:n }}" },
        fields: [field("a")],
      }),
    ).toEqual(["gone"]);
  });
});

describe("computeConfigSchemaChangeImpact", () => {
  const optInt = (key: string): SchemaField => ({
    key,
    type: "integer",
    required: false,
    default: "",
    description: "",
    enum: [],
  });
  const optStr = (key: string): SchemaField => ({
    key,
    type: "string",
    required: false,
    default: "",
    description: "",
    enum: [],
  });
  const schemaOf = (...fields: SchemaField[]): SimpleSchema => ({
    type: "object",
    fields,
  });
  const impact = (
    rootKey: string,
    before: ConfigFamilyMember[],
    proposedRoot: ConfigFamilyMember,
  ) =>
    computeConfigSchemaChangeImpact({
      rootKey,
      before,
      after: before.map((c) => (c.key === rootKey ? proposedRoot : c)),
    });

  it("reports a removed field only on descendants that override it", () => {
    const before: ConfigFamilyMember[] = [
      { key: "base", schema: schemaOf(optInt("a"), optInt("b")) },
      { key: "child", parent: "base", value: '{"b":2}' },
      { key: "bystander", parent: "base", value: '{"a":1}' },
    ];
    expect(
      impact("base", before, { key: "base", schema: schemaOf(optInt("a")) }),
    ).toEqual([
      {
        configKey: "child",
        configName: undefined,
        orphanedKeys: ["b"],
        newlyIncompatibleKeys: [],
        conflictingStripKeys: [],
        invariantRefs: [],
      },
    ]);
  });

  it("reports a retype as newly-incompatible, excluding pre-existing mismatches", () => {
    const before: ConfigFamilyMember[] = [
      { key: "base", schema: schemaOf(optInt("a"), optStr("b")) },
      // `a` is ALREADY incompatible before the change; `b` becomes so after.
      { key: "child", parent: "base", value: '{"a":"nope","b":"text"}' },
    ];
    expect(
      impact("base", before, {
        key: "base",
        schema: schemaOf(optInt("a"), optInt("b")),
      }),
    ).toEqual([
      {
        configKey: "child",
        configName: undefined,
        orphanedKeys: [],
        newlyIncompatibleKeys: ["b"],
        conflictingStripKeys: [],
        invariantRefs: [],
      },
    ]);
  });

  it("reports a destructive add (cascade would drop a differing declaration)", () => {
    const before: ConfigFamilyMember[] = [
      { key: "base", schema: schemaOf(optInt("a")) },
      { key: "child", parent: "base", schema: schemaOf(optStr("c")) },
    ];
    expect(
      impact("base", before, {
        key: "base",
        schema: schemaOf(optInt("a"), optInt("c")),
      }),
    ).toEqual([
      {
        configKey: "child",
        configName: undefined,
        orphanedKeys: [],
        newlyIncompatibleKeys: [],
        conflictingStripKeys: ["c"],
        invariantRefs: [],
      },
    ]);
  });

  it("does NOT report a contract-identical add (lossless strip)", () => {
    const before: ConfigFamilyMember[] = [
      { key: "base", schema: schemaOf(optInt("a")) },
      { key: "child", parent: "base", schema: schemaOf(optInt("c")) },
    ];
    expect(
      impact("base", before, {
        key: "base",
        schema: schemaOf(optInt("a"), optInt("c")),
      }),
    ).toEqual([]);
  });

  it("reports descendant rules referencing a removed field", () => {
    const rule = JSON.stringify({ b: { $lte: { $ref: "a" } } });
    const before: ConfigFamilyMember[] = [
      { key: "base", schema: schemaOf(optInt("a"), optInt("b")) },
      {
        key: "child",
        parent: "base",
        name: "Child",
        schema: {
          type: "object",
          fields: [],
          invariants: [{ name: "order", rule, message: "b <= a" }],
        },
      },
    ];
    expect(
      impact("base", before, { key: "base", schema: schemaOf(optInt("b")) }),
    ).toEqual([
      {
        configKey: "child",
        configName: "Child",
        orphanedKeys: [],
        newlyIncompatibleKeys: [],
        conflictingStripKeys: [],
        invariantRefs: [{ name: "order", keys: ["a"] }],
      },
    ]);
  });

  it("reports orphans introduced by a lineage change (re-parent)", () => {
    const before: ConfigFamilyMember[] = [
      { key: "baseA", schema: schemaOf(optInt("x")) },
      { key: "baseB", schema: schemaOf(optInt("y")) },
      { key: "mid", parent: "baseA" },
      { key: "leaf", parent: "mid", value: '{"x":1}' },
    ];
    expect(impact("mid", before, { key: "mid", parent: "baseB" })).toEqual([
      {
        configKey: "leaf",
        configName: undefined,
        orphanedKeys: ["x"],
        newlyIncompatibleKeys: [],
        conflictingStripKeys: [],
        invariantRefs: [],
      },
    ]);
  });

  it("includes archived descendants (their values still resolve)", () => {
    const before: ConfigFamilyMember[] = [
      { key: "base", schema: schemaOf(optInt("a"), optInt("keep")) },
      { key: "child", parent: "base", value: '{"a":1}', archived: true },
    ];
    expect(
      impact("base", before, { key: "base", schema: schemaOf(optInt("keep")) }),
    ).toEqual([
      {
        configKey: "child",
        configName: undefined,
        orphanedKeys: ["a"],
        newlyIncompatibleKeys: [],
        conflictingStripKeys: [],
        invariantRefs: [],
      },
    ]);
  });

  it("returns [] for a purely additive change", () => {
    const before: ConfigFamilyMember[] = [
      { key: "base", schema: schemaOf(optInt("a")) },
      { key: "child", parent: "base", value: '{"a":1}' },
    ];
    expect(
      impact("base", before, {
        key: "base",
        schema: schemaOf(optInt("a"), optInt("z")),
      }),
    ).toEqual([]);
  });

  it("does not report orphans when the change removes the entire schema", () => {
    // A schema-less family is un-orphanable at rest
    // (findOrphanedConfigValueKeys), so the preview must agree.
    const before: ConfigFamilyMember[] = [
      { key: "base", schema: schemaOf(optInt("a"), optInt("b")) },
      { key: "child", parent: "base", value: '{"a":1,"b":2}' },
    ];
    expect(impact("base", before, { key: "base", schema: undefined })).toEqual(
      [],
    );
  });

  it("walks extends edges, reporting mixin composers too", () => {
    const before: ConfigFamilyMember[] = [
      { key: "mixin", schema: schemaOf(optInt("m"), optInt("keep")) },
      { key: "composer", extends: ["mixin"], value: '{"m":3}' },
    ];
    expect(
      impact("mixin", before, {
        key: "mixin",
        schema: schemaOf(optInt("keep")),
      }),
    ).toEqual([
      {
        configKey: "composer",
        configName: undefined,
        orphanedKeys: ["m"],
        newlyIncompatibleKeys: [],
        conflictingStripKeys: [],
        invariantRefs: [],
      },
    ]);
  });
});

describe("findUndeclaredInvariantRuleFields", () => {
  const rules = [
    {
      name: "order",
      rule: JSON.stringify({ min: { $lte: { $ref: "max" } } }),
    },
    { name: "flag", rule: JSON.stringify({ enabled: true }) },
  ];

  it("reports rule fields (LHS and $ref) the schema does not declare", () => {
    expect(
      findUndeclaredInvariantRuleFields(rules, ["min", "enabled"]),
    ).toEqual([{ name: "order", keys: ["max"] }]);
  });

  it("returns [] when every referenced field is declared", () => {
    expect(
      findUndeclaredInvariantRuleFields(rules, ["min", "max", "enabled"]),
    ).toEqual([]);
    expect(findUndeclaredInvariantRuleFields(undefined, [])).toEqual([]);
  });

  it("formats a warning naming the rule and its undeclared fields", () => {
    expect(
      undeclaredRuleFieldWarnings([{ name: "order", keys: ["max", "mn"] }]),
    ).toEqual([
      {
        code: "undeclared-rule-field",
        path: "max",
        message: expect.stringContaining(
          'Validation rule "order" references undeclared field(s) "max", "mn"',
        ),
      },
    ]);
  });
});

describe("selectScopedOverride", () => {
  it("returns null when there are no scoped overrides", () => {
    expect(selectScopedOverride(undefined, { environment: "prod" })).toBeNull();
    expect(selectScopedOverride([], { environment: "prod" })).toBeNull();
  });

  it("matches on environment", () => {
    const list = [{ config: "f-prod", environments: ["production"] }];
    expect(selectScopedOverride(list, { environment: "production" })).toBe(
      "f-prod",
    );
    expect(selectScopedOverride(list, { environment: "dev" })).toBeNull();
  });

  it("is first-match-wins in array order", () => {
    const list = [
      { config: "f-a", environments: ["production"] },
      { config: "f-b", environments: ["production"] },
    ];
    expect(selectScopedOverride(list, { environment: "production" })).toBe(
      "f-a",
    );
  });

  it("treats an empty/absent environments list as a wildcard", () => {
    const list = [{ config: "f-any" }];
    expect(selectScopedOverride(list, { environment: "anything" })).toBe(
      "f-any",
    );
  });

  it("requires BOTH environment and project to match when both are scoped", () => {
    const list = [
      { config: "f", environments: ["production"], projects: ["proj_1"] },
    ];
    expect(
      selectScopedOverride(list, {
        environment: "production",
        project: "proj_1",
      }),
    ).toBe("f");
    // env matches but project doesn't → no match.
    expect(
      selectScopedOverride(list, {
        environment: "production",
        project: "proj_2",
      }),
    ).toBeNull();
  });

  it("matches a project-only scope regardless of environment", () => {
    const list = [{ config: "f-proj", projects: ["proj_1"] }];
    expect(
      selectScopedOverride(list, { environment: "dev", project: "proj_1" }),
    ).toBe("f-proj");
    expect(
      selectScopedOverride(list, { environment: "dev", project: "proj_2" }),
    ).toBeNull();
  });

  it("skips an ineligible (e.g. archived) match so a later entry can win", () => {
    const list = [
      { config: "f-archived", environments: ["production"] },
      { config: "f-live", environments: ["production"] },
    ];
    const eligible = (k: string) => k !== "f-archived";
    // Without the gate, first-match wins (even though it's archived).
    expect(selectScopedOverride(list, { environment: "production" })).toBe(
      "f-archived",
    );
    // With the gate, the archived first match is skipped for the live one.
    expect(
      selectScopedOverride(list, { environment: "production" }, eligible),
    ).toBe("f-live");
  });

  it("falls back to null when the only match is ineligible", () => {
    const list = [{ config: "f-archived", environments: ["production"] }];
    expect(
      selectScopedOverride(
        list,
        { environment: "production" },
        (k) => k !== "f-archived",
      ),
    ).toBeNull();
  });
});

describe("findScopedOverrideStructuralErrors", () => {
  it("returns no errors for an empty or well-formed list", () => {
    expect(findScopedOverrideStructuralErrors(undefined, "base")).toEqual([]);
    expect(findScopedOverrideStructuralErrors([], "base")).toEqual([]);
    expect(
      findScopedOverrideStructuralErrors(
        [
          { config: "prod_flavor", environments: ["production"] },
          { config: "dev_flavor", environments: ["dev"] },
        ],
        "base",
      ),
    ).toEqual([]);
  });

  it("flags entries not in the single-environment shape", () => {
    // Fallback (no env), multi-env, and project-scoped entries aren't supported
    // yet — each is rejected on shape alone.
    for (const entry of [
      { config: "fallback" },
      { config: "multi", environments: ["production", "staging"] },
      { config: "proj", environments: ["production"], projects: ["proj_1"] },
    ]) {
      const errors = findScopedOverrideStructuralErrors([entry], "base");
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("exactly one");
    }
  });

  it("flags a self-reference", () => {
    const errors = findScopedOverrideStructuralErrors(
      [{ config: "base", environments: ["production"] }],
      "base",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("itself");
  });

  it("flags an exact-duplicate entry as unreachable", () => {
    const errors = findScopedOverrideStructuralErrors(
      [
        { config: "a", environments: ["production"] },
        { config: "b", environments: ["production"] },
      ],
      "base",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("unreachable");
  });

  it("does not flag disjoint single-environment entries", () => {
    expect(
      findScopedOverrideStructuralErrors(
        [
          { config: "prod", environments: ["production"] },
          { config: "staging", environments: ["staging"] },
        ],
        "base",
      ),
    ).toEqual([]);
  });
});
