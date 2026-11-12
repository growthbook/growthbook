import { sdkValueResolver } from "../../src/util/sdk-value";

const json = { valueType: "json" as const, defaultValue: '{"a": 1, "b": 2}' };

// Stands in for the payload's constant resolver: `@const:x` and its template.
const resolveRefs = (v: unknown): unknown =>
  typeof v === "string"
    ? v.replace("{{ @const:x }}", "hello")
    : v && typeof v === "object" && "$extends" in v
      ? { x: 1, ...Object.fromEntries(Object.entries(v).slice(1)) }
      : v;

describe("sdkValueResolver", () => {
  it.each([
    [
      "merges a sparse patch onto the default",
      '{"b": 3}',
      true,
      { a: 1, b: 3 },
    ],
    ["serves a whole value as itself", '{ "b" : 3 }', false, { b: 3 }],
    ["serves invalid JSON as null", "{bad", false, null],
    [
      "drops a stray config reference",
      '{"$extends": ["@config:c"], "b": 3}',
      false,
      { b: 3 },
    ],
  ])("%s", (_, value, sparse, served) => {
    expect(sdkValueResolver(json).serve(value, sparse)).toEqual(served);
  });

  it.each([
    [
      "interpolates a string's constants",
      { valueType: "string" as const, defaultValue: "" },
      "{{ @const:x }} there",
      false,
      "hello there",
    ],
    [
      "resolves a JSON value's constants",
      json,
      '{"$extends": ["@const:x"], "y": 2}',
      false,
      { x: 1, y: 2 },
    ],
    [
      "spreads a sparse patch over the resolved default",
      {
        valueType: "json" as const,
        defaultValue: '{"$extends": ["@const:x"]}',
      },
      '{"y": 2}',
      true,
      { x: 1, y: 2 },
    ],
  ])("%s", (_, feature, value, sparse, served) => {
    expect(
      sdkValueResolver({ ...feature, resolveRefs }).serve(value, sparse),
    ).toEqual(served);
  });

  it.each([
    ["string", " y ", " y "],
    ["number", "1.0", 1],
    ["number", "abc", 0],
    ["boolean", "yes", true],
    ["boolean", "false", false],
  ] as const)("serves a %s %j as %j", (valueType, value, served) => {
    expect(sdkValueResolver({ valueType, defaultValue: "" }).serve(value)).toBe(
      served,
    );
  });

  it("says when a flag is config-backed", () => {
    expect(sdkValueResolver(json).configBacked).toBe(false);
    expect(
      sdkValueResolver({ ...json, baseConfig: "checkout" }).configBacked,
    ).toBe(true);
  });
});
