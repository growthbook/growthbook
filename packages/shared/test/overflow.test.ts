import { chunkString, estimateJsonBytes } from "../src/util/overflow";

describe("estimateJsonBytes", () => {
  it("returns byte length of JSON-serialized value", () => {
    expect(estimateJsonBytes({})).toBe(2); // "{}"
    expect(estimateJsonBytes([])).toBe(2); // "[]"
    expect(estimateJsonBytes({ a: 1 })).toBe(7); // '{"a":1}'
    expect(estimateJsonBytes("hello")).toBe(7); // '"hello"'
  });

  it("counts multi-byte UTF-8 characters correctly", () => {
    // "é" is 2 bytes in UTF-8; serialized as '"é"' = 1 + 2 + 1 = 4 bytes
    expect(estimateJsonBytes("é")).toBe(4);
  });
});

describe("chunkString", () => {
  it("returns empty array for empty string", () => {
    expect(chunkString("", 4)).toEqual([]);
  });

  it("returns single chunk when string fits", () => {
    expect(chunkString("abc", 4)).toEqual(["abc"]);
    expect(chunkString("abcd", 4)).toEqual(["abcd"]);
  });

  it("splits string into fixed-size chunks", () => {
    expect(chunkString("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("round-trips when chunks are rejoined", () => {
    const original = "x".repeat(1000) + "y".repeat(500);
    const chunks = chunkString(original, 300);
    expect(chunks.join("")).toBe(original);
    expect(chunks.length).toBe(5);
  });

  it("throws on non-positive chunk size", () => {
    expect(() => chunkString("abc", 0)).toThrow();
    expect(() => chunkString("abc", -1)).toThrow();
  });
});
