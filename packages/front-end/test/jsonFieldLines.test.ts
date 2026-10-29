import {
  getFieldLineNumbers,
  getTopLevelFieldLines,
} from "@/components/Features/jsonFieldLines";

describe("getTopLevelFieldLines", () => {
  it("maps each top-level field to its lines, nested values included", () => {
    const json = [
      "{",
      '  "a": 1,',
      '  "b": {',
      '    "c": [1, 2],',
      '    "d": "x"',
      "  },",
      '  "e": true',
      "}",
    ].join("\n");
    expect(Object.fromEntries(getTopLevelFieldLines(json))).toEqual({
      a: { start: 2, end: 2 },
      b: { start: 3, end: 6 },
      e: { start: 7, end: 7 },
    });
  });

  it("handles any formatting, including several fields on one line", () => {
    expect(
      Object.fromEntries(getTopLevelFieldLines('{"a": 1, "b": [\n2\n]}')),
    ).toEqual({ a: { start: 1, end: 1 }, b: { start: 1, end: 3 } });
  });

  it("ignores braces, commas, and quotes inside strings", () => {
    const json = '{\n  "a": "x, {y}: \\"z\\"",\n  "b": 2\n}';
    expect(Object.fromEntries(getTopLevelFieldLines(json))).toEqual({
      a: { start: 2, end: 2 },
      b: { start: 3, end: 3 },
    });
  });

  it("returns nothing for text that isn't an object", () => {
    expect(getTopLevelFieldLines('["a", "b"]').size).toBe(0);
    expect(getTopLevelFieldLines('"value"').size).toBe(0);
  });
});

describe("getFieldLineNumbers", () => {
  it("lists every line of the named fields only", () => {
    const json = '{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}';
    expect(getFieldLineNumbers(json, new Set(["b"]))).toEqual([3, 4, 5]);
    expect(getFieldLineNumbers(json, new Set(["missing"]))).toEqual([]);
  });
});
