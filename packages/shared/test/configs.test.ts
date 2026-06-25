import {
  getConfigParentKey,
  stripExtends,
  withParentExtends,
  getConfigBackingKey,
  getConfigBackingPatch,
  setConfigBacking,
  getConfigSubtree,
  ensureConfigBacking,
} from "../src/util/configs";

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

  it("replaces any pre-existing $extends with the parent ref", () => {
    expect(
      withParentExtends('{"$extends":["@config:old"],"a":1}', "base"),
    ).toBe('{"$extends":["@config:base"],"a":1}');
  });

  it("strips $extends when there is no parent", () => {
    expect(withParentExtends('{"$extends":["@config:old"],"a":1}', null)).toBe(
      '{"a":1}',
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
