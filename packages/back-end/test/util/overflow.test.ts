import { chunkString } from "back-end/src/util/overflow";

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

  it("does not split surrogate pairs across chunks", () => {
    // "🎉" is a surrogate pair (2 UTF-16 code units). chunkSize 3 forces
    // boundaries that would land mid-pair under naive slicing.
    const original = "🎉".repeat(50);
    const chunks = chunkString(original, 3);
    // Each chunk must survive a UTF-8 round-trip unchanged (no lone
    // surrogates → no U+FFFD replacement).
    for (const chunk of chunks) {
      expect(Buffer.from(chunk, "utf8").toString("utf8")).toBe(chunk);
    }
    expect(chunks.join("")).toBe(original);
  });

  it("throws on non-positive chunk size", () => {
    expect(() => chunkString("abc", 0)).toThrow();
    expect(() => chunkString("abc", -1)).toThrow();
  });
});
