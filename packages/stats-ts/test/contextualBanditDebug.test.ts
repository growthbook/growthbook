import {
  roundArrayForDebug,
  roundForDebug,
} from "../src/contextualBanditDebug";

describe("roundForDebug", () => {
  it("keeps the requested number of significant digits", () => {
    expect(roundForDebug(1.23456789)).toBeCloseTo(1.23457, 12);
    expect(roundForDebug(123456.789)).toBeCloseTo(123457, 12);
    expect(roundForDebug(0.00012345678)).toBeCloseTo(0.000123457, 12);
  });

  it("honors a custom significant-digit count", () => {
    expect(roundForDebug(1.23456789, 3)).toBeCloseTo(1.23, 12);
    expect(roundForDebug(987654, 2)).toBeCloseTo(990000, 12);
  });

  it("handles negative values symmetrically", () => {
    expect(roundForDebug(-1.23456789)).toBeCloseTo(-1.23457, 12);
    expect(roundForDebug(-987654, 2)).toBeCloseTo(-990000, 12);
  });

  it("returns 0, non-finite, and NaN inputs unchanged", () => {
    expect(roundForDebug(0)).toBe(0);
    expect(roundForDebug(Infinity)).toBe(Infinity);
    expect(roundForDebug(-Infinity)).toBe(-Infinity);
    expect(Number.isNaN(roundForDebug(NaN))).toBe(true);
  });
});

describe("roundArrayForDebug", () => {
  it("rounds every element with the shared significant-digit count", () => {
    const rounded = roundArrayForDebug([1.23456789, 0.00012345678, -987654], 3);
    expect(rounded).toHaveLength(3);
    expect(rounded[0]).toBeCloseTo(1.23, 12);
    expect(rounded[1]).toBeCloseTo(0.000123, 12);
    expect(rounded[2]).toBeCloseTo(-988000, 12);
  });

  it("returns an empty array unchanged", () => {
    expect(roundArrayForDebug([])).toEqual([]);
  });
});
