import { parseNumericValue } from "back-end/src/util/integration";

describe("parseNumericValue", () => {
  it("parses plain numeric strings", () => {
    expect(parseNumericValue("35188840")).toBe(35188840);
    expect(parseNumericValue("0")).toBe(0);
    expect(parseNumericValue("42.5")).toBe(42.5);
    expect(parseNumericValue(" 42 ")).toBe(42);
  });

  it("parses scientific-notation strings (warehouse DOUBLE output)", () => {
    // Athena returned 35188840 as "3.518884E7"; parseInt() would yield 3.
    expect(parseNumericValue("3.518884E7")).toBe(35188840);
    expect(parseNumericValue("3.1234567e7")).toBe(31234567);
    expect(parseNumericValue("1.5e3")).toBe(1500);
    expect(parseNumericValue("3.518884e7")).toBe(35188840);
  });

  it("passes numbers through unchanged", () => {
    expect(parseNumericValue(35188840)).toBe(35188840);
    expect(parseNumericValue(3.518884e7)).toBe(35188840);
    expect(parseNumericValue(0)).toBe(0);
  });

  it("returns 0 for missing, blank, or non-numeric values", () => {
    expect(parseNumericValue(null)).toBe(0);
    expect(parseNumericValue(undefined)).toBe(0);
    expect(parseNumericValue("")).toBe(0);
    expect(parseNumericValue("   ")).toBe(0);
    expect(parseNumericValue("abc")).toBe(0);
    // Non-finite results are treated as missing, not propagated
    expect(parseNumericValue("Infinity")).toBe(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseNumericValue({} as any)).toBe(0);
  });
});
