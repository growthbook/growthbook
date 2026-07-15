import {
  validateResolvableValue,
  getConstantReferenceKeys,
  getReferencingConstantKeys,
  getCyclicConstantRefs,
  assertValidExtendsEntries,
} from "../src/validators/constant";
import {
  constantRequiresReview,
  configRequiresReview,
} from "../src/util/features";
import { getConstantRevisionChange } from "../src/revisions/helpers";

const rule = (overrides = {}) => ({
  requireReviewOn: true,
  resetReviewOnChange: false,
  environments: [] as string[],
  projects: [] as string[],
  ...overrides,
});
const settingsWith = (rules) => ({ requireReviews: rules });
const noChange = {
  valueChanged: false,
  changedEnvironments: [] as string[],
  metadataOnly: false,
};

describe("validateResolvableValue", () => {
  it("allows any string value for string constants", () => {
    expect(() =>
      validateResolvableValue({ type: "string", value: "" }),
    ).not.toThrow();
    expect(() =>
      validateResolvableValue({ type: "string", value: "hello" }),
    ).not.toThrow();
    expect(() =>
      validateResolvableValue({ type: "string", value: "{not json" }),
    ).not.toThrow();
  });

  it("allows empty values for JSON values", () => {
    expect(() =>
      validateResolvableValue({ type: "json", value: "" }),
    ).not.toThrow();
  });

  it("accepts a JSON object for JSON values", () => {
    expect(() =>
      validateResolvableValue({ type: "json", value: '{"a":1}' }),
    ).not.toThrow();
    expect(() =>
      validateResolvableValue({
        type: "json",
        value: '{"a":{"b":1},"c":[1,2]}',
      }),
    ).not.toThrow();
  });

  it("rejects arrays and primitives for JSON values (objects only)", () => {
    expect(() =>
      validateResolvableValue({ type: "json", value: "[1,2,3]" }),
    ).toThrow(/object/);
    expect(() =>
      validateResolvableValue({ type: "json", value: '"str"' }),
    ).toThrow(/object/);
    expect(() =>
      validateResolvableValue({ type: "json", value: "true" }),
    ).toThrow(/object/);
    expect(() =>
      validateResolvableValue({ type: "json", value: "null" }),
    ).toThrow(/object/);
  });

  it("rejects invalid JSON for JSON values", () => {
    expect(() =>
      validateResolvableValue({ type: "json", value: "{not json" }),
    ).toThrow();
    expect(() =>
      validateResolvableValue({ type: "json", value: "{'a':1}" }),
    ).toThrow();
  });

  it("accepts @const refs and inline objects in $extends", () => {
    expect(() =>
      validateResolvableValue({
        type: "json",
        value: '{"$extends":["@const:base",{"a":1}],"b":2}',
      }),
    ).not.toThrow();
  });

  it("rejects malformed $extends entries (junk and bare strings)", () => {
    expect(() =>
      validateResolvableValue({
        type: "json",
        value: '{"$extends":["@const:ok",2]}',
      }),
    ).toThrow(/\$extends/);
    expect(() =>
      validateResolvableValue({ type: "json", value: '{"$extends":[true]}' }),
    ).toThrow(/\$extends/);
    expect(() =>
      validateResolvableValue({
        type: "json",
        value: '{"$extends":["nonsense"]}',
      }),
    ).toThrow(/\$extends/);
  });

  it("rejects malformed $extends nested inside an inline object", () => {
    expect(() =>
      validateResolvableValue({
        type: "json",
        value: '{"$extends":[{"$extends":[5]}]}',
      }),
    ).toThrow(/\$extends/);
  });

  it("allows a @config ref for feature values (no refSource)", () => {
    expect(() =>
      validateResolvableValue({
        type: "json",
        value: '{"$extends":["@config:base"]}',
      }),
    ).not.toThrow();
  });

  it("rejects a @config ref for constants with a constant-specific message", () => {
    expect(() =>
      validateResolvableValue({
        type: "json",
        value: '{"$extends":["@config:base"]}',
        refSource: "constant",
      }),
    ).toThrow(/Constants cannot reference configs/);
  });

  it("rejects a @config ref for configs with a config-specific message", () => {
    expect(() =>
      validateResolvableValue({
        type: "json",
        value: '{"$extends":["@config:base"]}',
        refSource: "config",
      }),
    ).toThrow(/parent.*extends|extends.*parent/);
  });

  it("prefixes the error with the label when provided", () => {
    expect(() =>
      validateResolvableValue({ type: "json", value: "{bad", label: "dev" }),
    ).toThrow(/^dev:/);
  });
});

describe("getConstantRevisionChange", () => {
  it("detects a value change", () => {
    const change = getConstantRevisionChange({ value: "old" }, [
      { op: "replace", path: "/value", value: "new" },
    ]);
    expect(change.valueChanged).toBe(true);
    expect(change.changedEnvironments).toEqual([]);
  });

  it("detects which environment overrides changed", () => {
    const change = getConstantRevisionChange(
      { environmentValues: { dev: "a", staging: "keep" } },
      [
        {
          op: "replace",
          path: "/environmentValues",
          value: { dev: "b", staging: "keep", prod: "c" },
        },
      ],
    );
    expect(change.valueChanged).toBe(false);
    expect(change.changedEnvironments.sort()).toEqual(["dev", "prod"]);
  });

  it("flags metadata-only changes", () => {
    const change = getConstantRevisionChange({ value: "v" }, [
      { op: "replace", path: "/name", value: "x" },
    ]);
    expect(change).toEqual({
      valueChanged: false,
      changedEnvironments: [],
      metadataOnly: true,
    });
  });

  it("classifies a project-only change as metadata-only (single `project` field)", () => {
    const change = getConstantRevisionChange({ value: "v" }, [
      { op: "replace", path: "/project", value: "prj_123" },
    ]);
    expect(change).toEqual({
      valueChanged: false,
      changedEnvironments: [],
      metadataOnly: true,
    });
  });

  it("treats a config schema change as a (reviewable) value change", () => {
    const change = getConstantRevisionChange({ value: "v" }, [
      {
        op: "replace",
        path: "/schema",
        value: { type: "object", fields: [{ key: "a", type: "string" }] },
      },
    ]);
    expect(change.valueChanged).toBe(true);
    expect(change.metadataOnly).toBe(false);
    expect(change.changedEnvironments).toEqual([]);
  });

  // Lineage/extensibility changes shift a config's effective resolved value, so
  // they must be reviewable content, not slip through as a no-review change.
  it.each(["parent", "extends", "extensible"])(
    "treats a config %s change as a (reviewable) value change",
    (field) => {
      const change = getConstantRevisionChange({ value: "v" }, [
        { op: "replace", path: `/${field}`, value: "x" },
      ]);
      expect(change.valueChanged).toBe(true);
      expect(change.metadataOnly).toBe(false);
    },
  );

  // Configs reuse this helper with an OBJECT value; compare deep, not by
  // reference — a restated-but-equal object must NOT read as changed (a `!==`
  // regression would flag it and spuriously force review).
  it("deep-compares an object value (restated but equal → no change)", () => {
    const change = getConstantRevisionChange({ value: { a: 1, b: 2 } }, [
      { op: "replace", path: "/value", value: { b: 2, a: 1 } },
    ]);
    expect(change.valueChanged).toBe(false);
  });

  it("detects a genuine object value change", () => {
    const change = getConstantRevisionChange({ value: { a: 1 } }, [
      { op: "replace", path: "/value", value: { a: 2 } },
    ]);
    expect(change.valueChanged).toBe(true);
  });
});

describe("constantRequiresReview", () => {
  it("honors the legacy boolean requireReviews", () => {
    expect(constantRequiresReview({}, noChange, { requireReviews: true })).toBe(
      true,
    );
    expect(
      constantRequiresReview({}, noChange, { requireReviews: false }),
    ).toBe(false);
    expect(constantRequiresReview({}, noChange, {})).toBe(false);
  });

  it("always requires review when the value changes (all environments)", () => {
    const settings = settingsWith([rule({ environments: ["production"] })]);
    expect(
      constantRequiresReview(
        {},
        { valueChanged: true, changedEnvironments: [], metadataOnly: false },
        settings,
      ),
    ).toBe(true);
  });

  it("only requires review for in-scope environment overrides", () => {
    const settings = settingsWith([rule({ environments: ["production"] })]);
    expect(
      constantRequiresReview(
        {},
        {
          valueChanged: false,
          changedEnvironments: ["production"],
          metadataOnly: false,
        },
        settings,
      ),
    ).toBe(true);
    expect(
      constantRequiresReview(
        {},
        {
          valueChanged: false,
          changedEnvironments: ["dev"],
          metadataOnly: false,
        },
        settings,
      ),
    ).toBe(false);
  });

  it("follows featureRequireMetadataReview for metadata-only changes", () => {
    const metaChange = {
      valueChanged: false,
      changedEnvironments: [],
      metadataOnly: true,
    };
    expect(constantRequiresReview({}, metaChange, settingsWith([rule()]))).toBe(
      true,
    );
    expect(
      constantRequiresReview(
        {},
        metaChange,
        settingsWith([rule({ featureRequireMetadataReview: false })]),
      ),
    ).toBe(false);
  });

  it("matches the rule by the constant's project", () => {
    const settings = settingsWith([
      rule({ projects: ["prj_a"], environments: [] }),
    ]);
    const valueChange = {
      valueChanged: true,
      changedEnvironments: [],
      metadataOnly: false,
    };
    expect(
      constantRequiresReview({ project: "prj_a" }, valueChange, settings),
    ).toBe(true);
    // A constant in a different project isn't covered by the rule.
    expect(
      constantRequiresReview({ project: "prj_b" }, valueChange, settings),
    ).toBe(false);
  });
});

describe("configRequiresReview", () => {
  const valueChange = {
    valueChanged: true,
    changedEnvironments: [],
    metadataOnly: false,
  };

  it("treats a base config value change as all-environments (flavorEnvironments=null)", () => {
    const settings = settingsWith([rule({ environments: ["production"] })]);
    // Base value applies everywhere → always requires review, like a constant.
    expect(configRequiresReview({}, valueChange, null, settings)).toBe(true);
  });

  it("requires review for a flavor only when its env is in the rule's scope", () => {
    const prodRule = settingsWith([rule({ environments: ["production"] })]);
    // A production flavor value change, prod-scoped rule → review.
    expect(
      configRequiresReview({}, valueChange, ["production"], prodRule),
    ).toBe(true);
    // A dev flavor value change, prod-scoped rule → NO review (the gap fixed:
    // env-scoped granularity applies to flavors, not just an all-envs block).
    expect(configRequiresReview({}, valueChange, ["dev"], prodRule)).toBe(
      false,
    );
  });

  it("treats a catch-all flavor (no environments) as all-environments", () => {
    const prodRule = settingsWith([rule({ environments: ["production"] })]);
    // Empty flavor env scope = applies to any env → always requires review.
    expect(configRequiresReview({}, valueChange, [], prodRule)).toBe(true);
  });

  it("requires review for a flavor whose env matches an all-environments rule", () => {
    const allEnvRule = settingsWith([rule({ environments: [] })]);
    expect(
      configRequiresReview({}, valueChange, ["production"], allEnvRule),
    ).toBe(true);
  });
});

describe("assertValidExtendsEntries", () => {
  describe("strict (constants — default)", () => {
    it("rejects a $extends array of pure junk", () => {
      expect(() => assertValidExtendsEntries({ $extends: [1, 2] })).toThrow(
        /\$extends/,
      );
      expect(() =>
        assertValidExtendsEntries({ $extends: ["nonsense"] }),
      ).toThrow(/\$extends/);
    });

    it("rejects junk mixed with a valid ref", () => {
      expect(() =>
        assertValidExtendsEntries({ $extends: ["@const:base", 5] }),
      ).toThrow(/\$extends/);
    });

    it("accepts refs and inline objects", () => {
      expect(() =>
        assertValidExtendsEntries({ $extends: ["@const:a", { x: 1 }] }),
      ).not.toThrow();
    });

    it("accepts a @config ref as the first entry", () => {
      expect(() =>
        assertValidExtendsEntries({ $extends: ["@config:base", "@const:a"] }),
      ).not.toThrow();
    });

    it("rejects a @config ref that is not the first entry", () => {
      expect(() =>
        assertValidExtendsEntries({ $extends: ["@const:a", "@config:base"] }),
      ).toThrow(/@config/);
    });

    it("rejects any @config ref when refSource=constant", () => {
      expect(() =>
        assertValidExtendsEntries(
          { $extends: ["@config:base"] },
          "",
          false,
          "constant",
        ),
      ).toThrow(/Constants cannot reference configs/);
    });

    it("rejects any @config ref when refSource=config (config-specific message)", () => {
      expect(() =>
        assertValidExtendsEntries(
          { $extends: ["@config:base"] },
          "",
          false,
          "config",
        ),
      ).toThrow(/parent.*extends|extends.*parent/);
    });

    it("still allows @const refs when refSource is set", () => {
      expect(() =>
        assertValidExtendsEntries(
          { $extends: ["@const:a"] },
          "",
          false,
          "constant",
        ),
      ).not.toThrow();
    });
  });

  describe("lenient (features — onlyMergeDirectives)", () => {
    it("grandfathers a $extends array used as plain data", () => {
      // No ref/inline-object entry → not treated as a merge directive → allowed,
      // so a pre-existing feature value that used `$extends` as data still saves.
      expect(() =>
        assertValidExtendsEntries({ $extends: ["a", "b"] }, "", true),
      ).not.toThrow();
      expect(() =>
        assertValidExtendsEntries({ $extends: [1, 2] }, "", true),
      ).not.toThrow();
    });

    it("still rejects junk once the array is clearly a merge directive", () => {
      // Contains a real ref → it IS a merge directive → the stray entry is a bug.
      expect(() =>
        assertValidExtendsEntries({ $extends: ["@const:base", 5] }, "", true),
      ).toThrow(/\$extends/);
    });
  });

  describe("non-array $extends (mis-wrapped directive)", () => {
    it("rejects a string $extends in a config/constant value", () => {
      expect(() =>
        assertValidExtendsEntries(
          { $extends: "@const:default-limits" },
          "",
          false,
          "constant",
        ),
      ).toThrow(/must be an array/);
      expect(() =>
        assertValidExtendsEntries({ $extends: { x: 1 } }, "", false, "config"),
      ).toThrow(/must be an array/);
    });

    it("rejects a ref-string $extends even on the lenient feature path", () => {
      expect(() =>
        assertValidExtendsEntries({ $extends: "@const:base" }, "", true),
      ).toThrow(/must be an array/);
      expect(() =>
        assertValidExtendsEntries({ $extends: "@config:base" }, "", true),
      ).toThrow(/must be an array/);
    });

    it("leaves a non-ref string $extends alone on the feature path (grandfathered data)", () => {
      expect(() =>
        assertValidExtendsEntries({ $extends: "just data" }, "", true),
      ).not.toThrow();
    });

    it("exempts a backtick-escaped `$extends` key (literal data key)", () => {
      expect(() =>
        assertValidExtendsEntries(
          { "`$extends`": "@const:base" },
          "",
          false,
          "constant",
        ),
      ).not.toThrow();
    });
  });
});

describe("getConstantReferenceKeys", () => {
  it("collects @const refs from the value and all env overrides (union)", () => {
    expect(
      getConstantReferenceKeys("hi {{ @const:a }} {{ @const:b }}", {
        dev: '{ "$extends": ["@const:c"] }',
        prod: "{{ @const:a }}",
      }).sort(),
    ).toEqual(["a", "b", "c"]);
  });

  it("returns [] when there are no references", () => {
    expect(getConstantReferenceKeys("plain", { dev: "x" })).toEqual([]);
    expect(getConstantReferenceKeys(undefined, undefined)).toEqual([]);
  });

  it("ignores backtick-escaped interpolations (rendered verbatim, not resolved)", () => {
    expect(
      getConstantReferenceKeys("`{{ @const:escaped }}` {{ @const:real }}", {}),
    ).toEqual(["real"]);
  });

  it("collects refs from $extends arrays (incl. nested objects)", () => {
    expect(
      getConstantReferenceKeys(
        '{ "$extends": ["@const:a", "@const:b"], "nested": { "$extends": ["@const:c"] } }',
        undefined,
      ).sort(),
    ).toEqual(["a", "b", "c"]);
  });

  it("collects {{ }} interpolations inside JSON string values", () => {
    expect(
      getConstantReferenceKeys(
        '{ "greeting": "hi {{ @const:name }}" }',
        undefined,
      ),
    ).toEqual(["name"]);
  });

  it("does NOT count the legacy `@const:key`: true object-key notation", () => {
    expect(
      getConstantReferenceKeys(
        '{ "@const:dead": true, "@const:gone": true }',
        undefined,
      ),
    ).toEqual([]);
  });

  it("does NOT count a bare @const:key outside an interpolation or $extends", () => {
    expect(getConstantReferenceKeys("see @const:foo for details", {})).toEqual(
      [],
    );
    // bare ref as a plain JSON string value (not in $extends, not {{ }})
    expect(
      getConstantReferenceKeys('{ "note": "@const:foo" }', undefined),
    ).toEqual([]);
  });

  it("ignores non-string entries in an $extends array", () => {
    expect(
      getConstantReferenceKeys(
        '{ "$extends": ["@const:ok", 5, true, "garbage"] }',
        undefined,
      ),
    ).toEqual(["ok"]);
  });

  it("collects refs nested inside inline-object $extends entries", () => {
    expect(
      getConstantReferenceKeys(
        '{ "$extends": ["@const:a", { "$extends": ["@const:b"], "x": "{{ @const:c }}" }] }',
        undefined,
      ).sort(),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("getCyclicConstantRefs", () => {
  // existing graph: b references a (b -> a)
  const existing = [
    { key: "a", value: "" },
    { key: "b", value: "{{ @const:a }}" },
  ];

  it("flags a self-reference", () => {
    expect(
      getCyclicConstantRefs("a", "{{ @const:a }}", undefined, existing),
    ).toEqual(["a"]);
  });

  it("flags a reference to a constant that already references the target", () => {
    // a referencing b would close a->b->a
    expect(
      getCyclicConstantRefs("a", "{{ @const:b }}", undefined, existing),
    ).toEqual(["b"]);
  });

  it("allows a non-cyclic reference", () => {
    expect(
      getCyclicConstantRefs("a", "{{ @const:c }}", undefined, [
        ...existing,
        { key: "c", value: "" },
      ]),
    ).toEqual([]);
  });

  it("returns [] when the proposed value has no references", () => {
    expect(getCyclicConstantRefs("a", "plain", undefined, existing)).toEqual(
      [],
    );
  });
});

describe("getReferencingConstantKeys", () => {
  // a -> b -> c (a references b, b references c)
  const graph = new Map([
    ["a", ["b"]],
    ["b", ["c"]],
    ["c", []],
    ["d", ["a"]],
  ]);

  it("returns all keys that transitively reference the target", () => {
    // who reaches c? b (direct), a (via b), d (via a->b->c)
    expect([...getReferencingConstantKeys("c", graph)].sort()).toEqual([
      "a",
      "b",
      "d",
    ]);
    // who reaches a? d
    expect([...getReferencingConstantKeys("a", graph)]).toEqual(["d"]);
    // nothing references d
    expect([...getReferencingConstantKeys("d", graph)]).toEqual([]);
  });

  it("terminates on an existing cycle", () => {
    const cyclic = new Map([
      ["x", ["y"]],
      ["y", ["x"]],
    ]);
    expect([...getReferencingConstantKeys("x", cyclic)].sort()).toEqual([
      "x",
      "y",
    ]);
  });
});
