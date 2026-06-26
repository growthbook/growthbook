import {
  getConfigParentKey,
  stripExtends,
  withParentExtends,
  getConfigBackingKey,
  getConfigBackingPatch,
  setConfigBacking,
  getConfigSubtree,
  ensureConfigBacking,
  getAncestorSchemaKeys,
  stripAncestorOwnedFields,
  configIsExtensible,
  stripConfigExtends,
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

  it("links up legacy $extends-only data", () => {
    expect(
      getConfigSubtree("base", [
        { key: "base" },
        { key: "legacy", value: '{"$extends":["@config:base"],"a":1}' },
      ]),
    ).toEqual(["base", "legacy"]);
  });

  it("tolerates parent cycles", () => {
    const cyclic = [
      { key: "a", parent: "b" },
      { key: "b", parent: "a" },
    ];
    expect(getConfigSubtree("a", cyclic)).toEqual(["a", "b"]);
  });
});

describe("getConfigParentKey", () => {
  it("prefers the explicit parent field", () => {
    expect(getConfigParentKey({ parent: "base" })).toBe("base");
  });

  it("falls back to a legacy @config: ref in the value", () => {
    expect(
      getConfigParentKey({ value: '{"$extends":["@config:base"],"a":1}' }),
    ).toBe("base");
  });

  it("falls back to a legacy @const: ref in the value", () => {
    expect(getConfigParentKey({ value: '{"$extends":["@const:base"]}' })).toBe(
      "base",
    );
  });

  it("returns null with no parent and no $extends", () => {
    expect(getConfigParentKey({ value: '{"a":1}' })).toBeNull();
    expect(getConfigParentKey({})).toBeNull();
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

describe("withParentExtends", () => {
  it("injects a @config: parent ref as the first $extends entry", () => {
    expect(withParentExtends('{"a":1}', "base")).toBe(
      '{"$extends":["@config:base"],"a":1}',
    );
  });

  it("replaces any pre-existing @config ref with the parent ref", () => {
    expect(
      withParentExtends('{"$extends":["@config:old"],"a":1}', "base"),
    ).toBe('{"$extends":["@config:base"],"a":1}');
  });

  it("strips $extends when there is no parent", () => {
    expect(withParentExtends('{"$extends":["@config:old"],"a":1}', null)).toBe(
      '{"a":1}',
    );
  });

  it("preserves @const refs, prepending the parent as the first entry", () => {
    expect(
      withParentExtends('{"$extends":["@const:flags"],"a":1}', "base"),
    ).toBe('{"$extends":["@config:base","@const:flags"],"a":1}');
  });

  it("keeps @const refs even with no parent", () => {
    expect(withParentExtends('{"$extends":["@const:flags"],"a":1}', null)).toBe(
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

  it("drops any stray $extends from the incoming patch", () => {
    expect(setConfigBacking("base", '{"$extends":["@config:x"],"a":1}')).toBe(
      '{"$extends":["@config:base"],"a":1}',
    );
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
