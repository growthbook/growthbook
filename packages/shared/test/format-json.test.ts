import { formatJsonMultilineObjects } from "../src/util/format-json";

describe("formatJsonMultilineObjects", () => {
  it("expands a short object to one key per line", () => {
    expect(formatJsonMultilineObjects({ foo: 1, bar: "abc" })).toBe(
      '{\n  "foo": 1,\n  "bar": "abc"\n}',
    );
  });

  it("keeps a short primitive array inline", () => {
    expect(formatJsonMultilineObjects({ nums: [1, 2, 3] })).toBe(
      '{\n  "nums": [1, 2, 3]\n}',
    );
  });

  it("keeps a short $extends array inline", () => {
    expect(
      formatJsonMultilineObjects({ $extends: ["@const:a", "@const:b"] }),
    ).toBe('{\n  "$extends": ["@const:a", "@const:b"]\n}');
  });

  it("expands an array that contains objects (one element per line)", () => {
    expect(formatJsonMultilineObjects([{ a: 1 }, { b: 2 }])).toBe(
      '[\n  {\n    "a": 1\n  },\n  {\n    "b": 2\n  }\n]',
    );
  });

  it("expands a long primitive array", () => {
    const long = Array.from({ length: 30 }, (_unused, i) => i);
    const out = formatJsonMultilineObjects({ long });
    expect(out).toContain("[\n");
    expect(out.split("\n").length).toBeGreaterThan(10);
  });

  it("renders empty object/array compactly", () => {
    expect(formatJsonMultilineObjects({})).toBe("{}");
    expect(formatJsonMultilineObjects({ a: {}, b: [] })).toBe(
      '{\n  "a": {},\n  "b": []\n}',
    );
  });

  it("handles nested objects and primitives", () => {
    expect(formatJsonMultilineObjects({ a: { b: { c: 1 } } })).toBe(
      '{\n  "a": {\n    "b": {\n      "c": 1\n    }\n  }\n}',
    );
  });

  it("never emits literal undefined (matches JSON.stringify semantics)", () => {
    // An object key with an undefined value is dropped (like JSON.stringify).
    const obj = formatJsonMultilineObjects({ a: 1, b: undefined });
    expect(obj).toBe('{\n  "a": 1\n}');
    expect(() => JSON.parse(obj)).not.toThrow();

    // An undefined array element becomes null (like JSON.stringify), never the
    // literal token `undefined` (which would be invalid JSON).
    const arr = formatJsonMultilineObjects({ xs: [1, undefined, 2] });
    expect(arr).toBe('{\n  "xs": [1, null, 2]\n}');
    expect(JSON.parse(arr)).toEqual({ xs: [1, null, 2] });
  });
});
