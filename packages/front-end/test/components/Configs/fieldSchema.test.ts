import { SchemaField } from "shared/types/feature";
import {
  configRelation,
  fieldValueType,
  parseFieldValueInput,
  pinnedCellBackground,
  typeDefault,
} from "@/components/Configs/fieldSchema";

const field = (overrides: Partial<SchemaField>): SchemaField => ({
  key: "k",
  type: "string",
  required: false,
  default: "",
  description: "",
  enum: [],
  ...overrides,
});

describe("pinnedCellBackground", () => {
  it("lays a row's tint over the opaque panel color", () => {
    expect(pinnedCellBackground("var(--red-a3)")).toBe(
      "linear-gradient(var(--red-a3), var(--red-a3)) var(--color-panel-solid)",
    );
  });

  it("leaves an untinted row to the table's own background", () => {
    expect(pinnedCellBackground(null)).toBeUndefined();
  });
});

describe("fieldValueType", () => {
  it.each([
    ['{"enum":["eu","us"]}', "string", ""],
    ['{"enum":[1,2,null]}', "number", 0],
    ['{"enum":[true,false]}', "boolean", false],
    ['{"type":"string","pattern":"^a"}', "string", ""],
    ['{"enum":["a",1]}', "json", {}],
    ['{"type":"object"}', "json", {}],
  ])("reads %s as %s, starting at %j", (jsonSchema, expected, start) => {
    expect(fieldValueType(field({ jsonSchema }))).toBe(expected);
    expect(typeDefault(field({ jsonSchema }))).toEqual(start);
  });
});

describe("parseFieldValueInput", () => {
  const object = { jsonSchema: '{"type":"object"}' };

  it.each([
    [{ type: "integer" }, " 12 ", 12],
    [{ type: "float" }, "1.5", 1.5],
    [{ type: "boolean" }, "true", true],
    // A string keeps its text as typed, whitespace included.
    [{}, " a b ", " a b "],
    [{}, " ", " "],
    [object, '{"a":1}', { a: 1 }],
  ] as const)("reads %j %j", (overrides, text, value) => {
    expect(parseFieldValueInput(text, field(overrides))).toEqual({
      kind: "value",
      value,
    });
  });

  it.each([
    [{ type: "integer" }, "1.5", "Value must be an integer"],
    [{ type: "integer" }, "12abc", "Value must be a number"],
    [{ type: "boolean" }, "hello", "Value must be true or false"],
    [{ type: "boolean" }, "", "Choose a value"],
    [object, "{", expect.any(String)],
  ] as const)("rejects %j %j", (overrides, text, error) => {
    expect(parseFieldValueInput(text, field(overrides))).toEqual({
      kind: "error",
      error,
    });
  });

  it("asks for an allowed value when the allow-list has no empty string", () => {
    for (const f of [
      field({ enum: ["eu", "us"] }),
      field({ type: "integer", enum: ["1", "2"] }),
    ]) {
      expect(parseFieldValueInput("", f)).toEqual({
        kind: "error",
        error: "Choose a value",
      });
    }
  });

  it("keeps an empty string, needs a value for other types, and reads null", () => {
    expect(parseFieldValueInput("", field({}))).toEqual({
      kind: "value",
      value: "",
    });
    expect(parseFieldValueInput("  ", field({ type: "float" }))).toEqual({
      kind: "error",
      error: "Enter a value",
    });
    expect(parseFieldValueInput("", field({ type: "float" }), true)).toEqual({
      kind: "value",
      value: null,
    });
  });
});

describe("configRelation", () => {
  // base → mid → leaf, base → sib; other stands alone.
  const lineage = [
    { key: "base", parentKey: null },
    { key: "mid", parentKey: "base" },
    { key: "leaf", parentKey: "mid" },
    { key: "sib", parentKey: "base" },
    { key: "other", parentKey: null },
  ];

  it.each([
    ["leaf", "mid", "child"],
    ["leaf", "base", "descendant"],
    ["base", "mid", "parent"],
    ["base", "leaf", "ancestor"],
    ["sib", "mid", "sibling"],
    ["other", "mid", "related"],
  ] as const)("%s from %s is a %s", (key, current, relation) => {
    expect(configRelation(key, current, lineage)).toBe(relation);
  });

  it("stops at a parent cycle", () => {
    const cycle = [
      { key: "a", parentKey: "b" },
      { key: "b", parentKey: "a" },
    ];
    expect(configRelation("a", "b", cycle)).toBe("child");
  });
});
