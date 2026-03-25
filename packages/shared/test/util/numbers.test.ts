import { parseIntWithDefault } from "../../src/util/numbers";

describe("parseIntWithDefault", () => {
  it("returns fallback for undefined and null", () => {
    expect(parseIntWithDefault(undefined, 3600)).toBe(3600);
    expect(parseIntWithDefault(null, 99)).toBe(99);
  });

  it("returns fallback for empty or whitespace string", () => {
    expect(parseIntWithDefault("", 3600)).toBe(3600);
    expect(parseIntWithDefault("   ", 3600)).toBe(3600);
  });

  it("parses integer strings", () => {
    expect(parseIntWithDefault("0", 3600)).toBe(0);
    expect(parseIntWithDefault("3600", 0)).toBe(3600);
    expect(parseIntWithDefault("  42  ", 0)).toBe(42);
  });

  it("parses finite numbers", () => {
    expect(parseIntWithDefault(3600, 0)).toBe(3600);
    expect(parseIntWithDefault(0, 3600)).toBe(0);
  });

  it("returns fallback for NaN and non-numeric strings", () => {
    expect(parseIntWithDefault(NaN, 7)).toBe(7);
    expect(parseIntWithDefault("abc", 7)).toBe(7);
    expect(parseIntWithDefault({}, 7)).toBe(7);
  });

  it("truncates toward zero like parseInt", () => {
    expect(parseIntWithDefault(3.9, 0)).toBe(3);
    expect(parseIntWithDefault("3.9", 0)).toBe(3);
  });

  it("supports NaN as fallback for invalid-only signaling", () => {
    expect(Number.isNaN(parseIntWithDefault("x", NaN))).toBe(true);
    expect(Number.isNaN(parseIntWithDefault(undefined, NaN))).toBe(true);
  });
});
