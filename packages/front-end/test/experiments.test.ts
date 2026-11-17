import { getEqualWeights } from "shared/experiments";
import {
  capTypedPercent,
  decimalToPercent,
  floatRound,
  isEqualSplit,
  percentToDecimal,
  rebalance,
  variationWeightsTotalPercent,
} from "@/services/utils";

describe("variation weighting functions", () => {
  it("getEqualWeights with default precision", () => {
    expect(getEqualWeights(1)).toEqual([1]);
    expect(getEqualWeights(2)).toEqual([0.5, 0.5]);
    expect(getEqualWeights(3)).toEqual([0.3334, 0.3333, 0.3333]);
    expect(getEqualWeights(4)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(getEqualWeights(5)).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(getEqualWeights(6)).toEqual([
      0.1667, 0.1667, 0.1667, 0.1667, 0.1666, 0.1666,
    ]);
    expect(getEqualWeights(7)).toEqual([
      0.1429, 0.1429, 0.1429, 0.1429, 0.1428, 0.1428, 0.1428,
    ]);
  });

  it("getEqualWeights with lower precision", () => {
    expect(getEqualWeights(1, 3)).toEqual([1]);
    expect(getEqualWeights(2, 3)).toEqual([0.5, 0.5]);
    expect(getEqualWeights(3, 3)).toEqual([0.334, 0.333, 0.333]);
    expect(getEqualWeights(4, 3)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(getEqualWeights(5, 3)).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(getEqualWeights(6, 3)).toEqual([
      0.167, 0.167, 0.167, 0.167, 0.166, 0.166,
    ]);
    expect(getEqualWeights(7, 3)).toEqual([
      0.143, 0.143, 0.143, 0.143, 0.143, 0.143, 0.142,
    ]);
  });

  it("getEqualWeights with higher precision", () => {
    expect(getEqualWeights(1, 5)).toEqual([1]);
    expect(getEqualWeights(2, 5)).toEqual([0.5, 0.5]);
    expect(getEqualWeights(3, 5)).toEqual([0.33334, 0.33333, 0.33333]);
    expect(getEqualWeights(4, 5)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(getEqualWeights(5, 5)).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(getEqualWeights(6, 5)).toEqual([
      0.16667, 0.16667, 0.16667, 0.16667, 0.16666, 0.16666,
    ]);
    expect(getEqualWeights(7, 5)).toEqual([
      0.14286, 0.14286, 0.14286, 0.14286, 0.14286, 0.14285, 0.14285,
    ]);
  });

  it("converts between percents and decimals", () => {
    expect(percentToDecimal("40.7865434", 4)).toEqual(0.4079);
    expect(percentToDecimal("40.7865434", 3)).toEqual(0.408);
    expect(decimalToPercent(0.869584, 4)).toEqual(86.96);
    expect(decimalToPercent(0.869584, 3)).toEqual(87);
  });

  it("cuts a typed weight to the decimals it keeps", () => {
    expect(capTypedPercent("33.33333", 2)).toBe("33.33");
    expect(capTypedPercent("33.33333", 3)).toBe("33.333");
    expect(capTypedPercent("1000", 2)).toBe("100");
    expect(capTypedPercent("12.", 2)).toBe("12.");
    expect(capTypedPercent("", 2)).toBe("");
  });

  it("reads a pasted exponent whole before cutting its decimals", () => {
    expect(capTypedPercent("1e-2", 4)).toBe("0.01");
    expect(capTypedPercent("2.5E1", 2)).toBe("25");
    expect(capTypedPercent("1.23456e-1", 4)).toBe("0.1235");
  });

  it("rebalances weights", () => {
    expect(rebalance([0.3334, 0.3333, 0.3333], 1, 0.3406, 4)).toEqual([
      0.3334, 0.3406, 0.326,
    ]);

    expect(rebalance([0.3334, 0.3333, 0.3333], 1, 1.5, 4)).toEqual([0, 1, 0]);

    expect(rebalance([0.3334, 0.3333, 0.3333], 1, 0.8, 4)).toEqual([
      0.2, 0.8, 0,
    ]);

    expect(rebalance([0.3334, 0.3333, 0.3333], 1, 0.12, 4)).toEqual([
      0.3334, 0.12, 0.5466,
    ]);
  });

  it("rounds floats", () => {
    expect(floatRound(0.546859483, 3)).toEqual(0.547);
    expect(floatRound(0.546859483, 4)).toEqual(0.5469);
    expect(floatRound(0.546859483, 5)).toEqual(0.54686);
  });
});

describe("isEqualSplit", () => {
  it("treats getEqualWeights as equal, including uneven counts", () => {
    [2, 3, 6, 7].forEach((n) => {
      expect(isEqualSplit(getEqualWeights(n))).toBe(true);
    });
  });

  it("rejects splits that differ by more than one step", () => {
    expect(isEqualSplit([0.5001, 0.4999])).toBe(false);
  });
});

describe("variationWeightsTotalPercent", () => {
  it("totals the weights as a whole percent, without normalizing", () => {
    expect(variationWeightsTotalPercent([0.33, 0.4, 0.3])).toBe(103);
    expect(variationWeightsTotalPercent([0.3334, 0.3333, 0.3333])).toBe(100);
    expect(variationWeightsTotalPercent([0.005, 0.005])).toBe(1);
  });
});
