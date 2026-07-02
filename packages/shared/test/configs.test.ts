import {
  getConfigParentKey,
  getConfigBaseKeys,
  stripExtends,
  withConfigExtends,
  getConfigBackingKey,
  getConfigBackingPatch,
  setConfigBacking,
  getConfigSubtree,
  getConfigSpineSubtree,
  ensureConfigBacking,
  getAncestorSchemaKeys,
  stripAncestorOwnedFields,
  configIsExtensible,
  stripConfigExtends,
  linearizeConfigDag,
  getConfigSpineRootKey,
  collectConfigInvariantViolations,
  collectDescendantInvariantViolations,
  findSiblingSchemaConflicts,
  findIncompatibleConfigValueKeys,
  resolveConfigChain,
  computeConfigReconciliationPreview,
  isConfigLocked,
  ConfigChainNode,
} from "../src/util/configs";
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
  // root → child → grandchild spine; `mixin` extends root but is off-spine.
  const lineage = [
    { key: "root", parentKey: null, name: "Root", fieldKeys: ["a"] },
    { key: "child", parentKey: "root", name: "Child", fieldKeys: ["a", "b"] },
    {
      key: "grandchild",
      parentKey: "child",
      name: "Grandchild",
      fieldKeys: ["a", "c"],
    },
    { key: "mixin", parentKey: null, name: "Mixin", fieldKeys: ["a"] },
  ];

  it("returns [] when the config declares no own fields", () => {
    expect(computeConfigReconciliationPreview(lineage, "root", [])).toEqual([]);
  });

  it("reports spine descendants that redeclare an own key, in BFS order", () => {
    const hits = computeConfigReconciliationPreview(lineage, "root", ["a"]);
    // `mixin` is off the parent spine, so it's excluded; root itself excluded.
    expect(hits).toEqual([
      { name: "Child", keys: ["a"] },
      { name: "Grandchild", keys: ["a"] },
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
};
const dagMap = (nodes: DagNode[]) => new Map(nodes.map((n) => [n.key, n]));

const noRealtime = inv(
  "no-realtime",
  { stream_priority: { $ne: "realtime" } },
  "This device tier cannot sustain realtime.",
);

describe("collectConfigInvariantViolations", () => {
  it("evaluates rules accumulated base → leaf against the resolved value", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: { ...objSchema("stream_priority"), invariants: [noRealtime] },
        value: '{"stream_priority":"high"}',
      },
      { key: "child", parent: "base", value: '{"stream_priority":"realtime"}' },
    ]);
    expect(collectConfigInvariantViolations("base", byKey)).toEqual([]);
    expect(collectConfigInvariantViolations("child", byKey)).toEqual([
      {
        name: "no-realtime",
        message: "This device tier cannot sustain realtime.",
      },
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
});

describe("collectDescendantInvariantViolations", () => {
  it("reports a descendant whose own rule fails against a violating base value", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: objSchema("stream_priority"),
        value: '{"stream_priority":"realtime"}',
      },
      {
        key: "child",
        name: "Embedded Player",
        parent: "base",
        schema: { type: "object", fields: [], invariants: [noRealtime] },
      },
    ]);
    expect(collectDescendantInvariantViolations("base", byKey)).toEqual([
      {
        configKey: "child",
        configName: "Embedded Player",
        violations: [
          {
            name: "no-realtime",
            message: "This device tier cannot sustain realtime.",
          },
        ],
      },
    ]);
  });

  it("excludes the root's own violations and clean descendants", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: { ...objSchema("stream_priority"), invariants: [noRealtime] },
        value: '{"stream_priority":"realtime"}',
      },
      // Override masks the violating base value.
      {
        key: "child",
        parent: "base",
        value: '{"stream_priority":"high"}',
      },
    ]);
    expect(collectDescendantInvariantViolations("base", byKey)).toEqual([]);
  });

  it("reaches a rule declared two levels down (grandchild)", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: objSchema("stream_priority"),
        value: '{"stream_priority":"realtime"}',
      },
      { key: "child", parent: "base" },
      {
        key: "grandchild",
        parent: "child",
        schema: { type: "object", fields: [], invariants: [noRealtime] },
      },
    ]);
    const hits = collectDescendantInvariantViolations("base", byKey);
    expect(hits.map((h) => h.configKey)).toEqual(["grandchild"]);
  });

  it("reaches descendants composed via `extends` (mixin edge)", () => {
    const byKey = dagMap([
      {
        key: "base",
        schema: objSchema("stream_priority"),
        value: '{"stream_priority":"realtime"}',
      },
      {
        key: "composer",
        extends: ["base"],
        schema: { type: "object", fields: [], invariants: [noRealtime] },
      },
      { key: "unrelated", value: '{"stream_priority":"realtime"}' },
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
