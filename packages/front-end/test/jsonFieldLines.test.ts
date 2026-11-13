import {
  formatJsonValue,
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

describe("formatJsonValue", () => {
  it("keeps what fits on one line, and inlines short arrays", () => {
    expect(formatJsonValue({ singlelineField: true })).toBe(
      '{ "singlelineField": true }',
    );
    expect(
      formatJsonValue({ foo: true, bar: ["a", "b"], baz: "x".repeat(60) }),
    ).toBe(
      [
        "{",
        '  "foo": true,',
        '  "bar": ["a", "b"],',
        `  "baz": "${"x".repeat(60)}"`,
        "}",
      ].join("\n"),
    );
  });

  it("gives each top-level key its own lines when keys are highlighted", () => {
    const text = formatJsonValue(
      { foo: true, bar: ["a", "b"] },
      { keysOnOwnLines: true },
    );
    expect(text).toBe(
      ["{", '  "foo": true,', '  "bar": ["a", "b"]', "}"].join("\n"),
    );
    expect(getFieldLineNumbers(text, new Set(["bar"]))).toEqual([3]);
  });

  it("breaks a nested value that doesn't fit beside its key", () => {
    const long = Array.from({ length: 12 }, (_, i) => `item-${i}`);
    const text = formatJsonValue({ list: long }, { keysOnOwnLines: true });
    expect(text.split("\n").every((line) => line.length <= 80)).toBe(true);
    expect(getFieldLineNumbers(text, new Set(["list"]))[0]).toBe(2);
  });

  it("pads one-line objects but not arrays, and leaves strings alone", () => {
    expect(formatJsonValue({ a: { b: 1 }, c: ["{x}"], d: {} })).toBe(
      '{ "a": { "b": 1 }, "c": ["{x}"], "d": {} }',
    );
  });
});
