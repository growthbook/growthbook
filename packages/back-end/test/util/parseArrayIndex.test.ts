import { parseArrayIndex } from "back-end/src/util/validation";

describe("parseArrayIndex", () => {
  it("accepts in-range integers and their decimal string form", () => {
    expect(parseArrayIndex(0, 2)).toBe(0);
    expect(parseArrayIndex(1, 2)).toBe(1);
    expect(parseArrayIndex("0", 2)).toBe(0);
    expect(parseArrayIndex("1", 2)).toBe(1);
    expect(parseArrayIndex("10", 11)).toBe(10);
  });

  it.each([
    "__proto__",
    "constructor",
    "length",
    "abc",
    "",
    "-1",
    "1.5",
    "1e0",
    " 1",
    "0x1",
    "01",
    "00",
    "999",
    "2",
    2,
    -1,
    1.5,
    NaN,
    Infinity,
    null,
    undefined,
    {},
    ["1"],
  ])("rejects %p", (value) => {
    expect(parseArrayIndex(value, 2)).toBeUndefined();
  });

  it("does not resolve inherited array properties", () => {
    const variations = [{ screenshots: [] }];
    for (const key of ["__proto__", "constructor", "length"]) {
      expect(key in variations).toBe(true);
      expect(parseArrayIndex(key, variations.length)).toBeUndefined();
    }
  });
});
