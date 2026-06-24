import {
  validateConstantValue,
  getConstantReferenceKeys,
  getReferencingConstantKeys,
  getCyclicConstantRefs,
  assertValidExtendsEntries,
} from "../src/validators/constant";
import { constantRequiresReview } from "../src/util/features";
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

describe("validateConstantValue", () => {
  it("allows any string value for string constants", () => {
    expect(() => validateConstantValue("string", "")).not.toThrow();
    expect(() => validateConstantValue("string", "hello")).not.toThrow();
    expect(() => validateConstantValue("string", "{not json")).not.toThrow();
  });

  it("allows empty values for JSON constants", () => {
    expect(() => validateConstantValue("json", "")).not.toThrow();
  });

  it("accepts a JSON object for JSON constants", () => {
    expect(() => validateConstantValue("json", '{"a":1}')).not.toThrow();
    expect(() =>
      validateConstantValue("json", '{"a":{"b":1},"c":[1,2]}'),
    ).not.toThrow();
  });

  it("rejects arrays and primitives for JSON constants (objects only)", () => {
    expect(() => validateConstantValue("json", "[1,2,3]")).toThrow(/object/);
    expect(() => validateConstantValue("json", '"str"')).toThrow(/object/);
    expect(() => validateConstantValue("json", "true")).toThrow(/object/);
    expect(() => validateConstantValue("json", "null")).toThrow(/object/);
  });

  it("rejects invalid JSON for JSON constants", () => {
    expect(() => validateConstantValue("json", "{not json")).toThrow();
    expect(() => validateConstantValue("json", "{'a':1}")).toThrow();
  });

  it("accepts @const refs and inline objects in $extends", () => {
    expect(() =>
      validateConstantValue(
        "json",
        '{"$extends":["@const:base",{"a":1}],"b":2}',
      ),
    ).not.toThrow();
  });

  it("rejects malformed $extends entries (junk and bare strings)", () => {
    expect(() =>
      validateConstantValue("json", '{"$extends":["@const:ok",2]}'),
    ).toThrow(/\$extends/);
    expect(() => validateConstantValue("json", '{"$extends":[true]}')).toThrow(
      /\$extends/,
    );
    expect(() =>
      validateConstantValue("json", '{"$extends":["nonsense"]}'),
    ).toThrow(/\$extends/);
  });

  it("rejects malformed $extends nested inside an inline object", () => {
    expect(() =>
      validateConstantValue("json", '{"$extends":[{"$extends":[5]}]}'),
    ).toThrow(/\$extends/);
  });

  it("prefixes the error with the label when provided", () => {
    expect(() => validateConstantValue("json", "{bad", "dev")).toThrow(/^dev:/);
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
