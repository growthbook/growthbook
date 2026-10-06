import { describe, expect, it } from "vitest";
import {
  evenSplit,
  normalizeSplit,
} from "@/components/Experiment/TabbedPage/SetupPage/splitMath";

const sum = (xs: number[]) =>
  Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10;

describe("normalizeSplit", () => {
  it("shares the remainder in proportion to the others", () => {
    // A/B/C at 60/30/10, A set to 80: the remaining 20 splits 3:1.
    expect(normalizeSplit([60, 30, 10], 0, 80)).toEqual([80, 15, 5]);
  });

  it("splits evenly when the others are all 0", () => {
    expect(normalizeSplit([100, 0, 0], 0, 40)).toEqual([40, 30, 30]);
  });

  it("clamps to 0–100 and keeps one decimal place", () => {
    expect(normalizeSplit([50, 50], 0, 150)).toEqual([100, 0]);
    expect(normalizeSplit([50, 50], 0, -5)).toEqual([0, 100]);
    expect(normalizeSplit([50, 50], 0, 33.33)).toEqual([33.3, 66.7]);
  });

  it("treats an empty or invalid entry as 0", () => {
    expect(normalizeSplit([50, 50], 1, NaN)).toEqual([100, 0]);
  });

  it("allows parking a variation at 0", () => {
    expect(normalizeSplit([50, 25, 25], 1, 0)).toEqual([66.7, 0, 33.3]);
  });

  it("always totals exactly 100, giving leftovers to the largest adjusted", () => {
    const out = normalizeSplit([20, 20, 20, 20, 20], 0, 10);
    expect(sum(out)).toBe(100);
    expect(out[0]).toBe(10);
    // 90 / 4 = 22.5 each, no leftover.
    expect(out).toEqual([10, 22.5, 22.5, 22.5, 22.5]);
    const thirds = normalizeSplit([0, 50, 50], 0, 0);
    expect(sum(thirds)).toBe(100);
  });
});

describe("evenSplit", () => {
  it("splits evenly, the leftover to the first largest", () => {
    expect(evenSplit(3)).toEqual([33.4, 33.3, 33.3]);
    expect(evenSplit(2)).toEqual([50, 50]);
    expect(sum(evenSplit(7))).toBe(100);
  });
});
