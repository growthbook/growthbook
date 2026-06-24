import {
  validateConstantValue,
  getConstantReferenceKeys,
  getReferencingConstantKeys,
  getCyclicConstantRefs,
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

  it("accepts valid JSON for JSON constants", () => {
    expect(() => validateConstantValue("json", '{"a":1}')).not.toThrow();
    expect(() => validateConstantValue("json", "[1,2,3]")).not.toThrow();
    expect(() => validateConstantValue("json", '"str"')).not.toThrow();
    expect(() => validateConstantValue("json", "true")).not.toThrow();
  });

  it("rejects invalid JSON for JSON constants", () => {
    expect(() => validateConstantValue("json", "{not json")).toThrow();
    expect(() => validateConstantValue("json", "{'a':1}")).toThrow();
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

describe("getConstantReferenceKeys", () => {
  it("collects @const refs from the value and all env overrides (union)", () => {
    expect(
      getConstantReferenceKeys("hi {{ @const:a }} {{ @const:b }}", {
        dev: '{ "@const:c": true }',
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
