import {
  decimalToPercent,
  floatRound,
  getEqualWeights,
  percentToDecimal,
  rebalance,
} from "@/services/utils";
import {
  IndexedPValue,
  adjustPValuesBenjaminiHochberg,
  adjustPValuesHolmBonferroni,
  adjustedCI,
  setAdjustedPValuesOnResults,
} from "@/services/experiments";

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

function mockIndexedPvalue(
  pvalues: number[],
  index?: number[],
): IndexedPValue[] {
  return pvalues.map((p, i) => {
    return { pValue: p, index: [index ? index[i] : i] };
  });
}

describe("pvalue correction method", () => {
  it("does HB procedure correctly", () => {
    expect(
      adjustPValuesHolmBonferroni(
        mockIndexedPvalue([0.01, 0.04, 0.03, 0.005, 0.55, 0.6]),
      ),
    ).toEqual(
      mockIndexedPvalue([0.03, 0.05, 0.12, 0.12, 1, 1], [3, 0, 2, 1, 4, 5]),
    );
  });
  it("does BH procedure correctly", () => {
    expect(
      adjustPValuesBenjaminiHochberg(
        mockIndexedPvalue([0.898, 0.138, 0.007, 0.964, 0.538, 0.006, 0.138]),
      ).map((x) => {
        return { pValue: +x.pValue.toFixed(8), index: x.index };
      }),
    ).toEqual(
      mockIndexedPvalue(
        [0.964, 0.964, 0.7532, 0.2415, 0.2415, 0.0245, 0.0245],
        [3, 0, 4, 1, 6, 2, 5],
      ),
    );
  });
});

describe("results edited in place", () => {
  it("pvals and CIs adjusted in place", () => {
    const results = [
      {
        name: "res1",
        srm: 0.5,
        variations: [
          {
            users: 100,
            metrics: {
              met1: { value: 0, cr: 0, users: 0, pValue: 0.025 },
              met2: { value: 0, cr: 0, users: 0, pValue: 0.03 },
            },
          },
        ],
      },
    ];
    const expectedResultsHB = [
      {
        name: "res1",
        srm: 0.5,
        variations: [
          {
            users: 100,
            metrics: {
              met1: {
                value: 0,
                cr: 0,
                users: 0,
                pValue: 0.025,
                pValueAdjusted: 0.05,
              },
              met2: {
                value: 0,
                cr: 0,
                users: 0,
                pValue: 0.03,
                pValueAdjusted: 0.05,
              },
            },
          },
        ],
      },
    ];
    const expectedResultsBH = [
      {
        name: "res1",
        srm: 0.5,
        variations: [
          {
            users: 100,
            metrics: {
              met1: {
                value: 0,
                cr: 0,
                users: 0,
                pValue: 0.025,
                pValueAdjusted: 0.03,
              },
              met2: {
                value: 0,
                cr: 0,
                users: 0,
                pValue: 0.03,
                pValueAdjusted: 0.03,
              },
            },
          },
        ],
      },
    ];

    setAdjustedPValuesOnResults(results, ["met1", "met2"], "holm-bonferroni");
    expect(results).toEqual(expectedResultsHB);
    setAdjustedPValuesOnResults(
      results,
      ["met1", "met2"],
      "benjamini-hochberg",
    );
    expect(results).toEqual(expectedResultsBH);
  });

  it("does BH procedure correctly", () => {
    expect(
      adjustPValuesBenjaminiHochberg(
        mockIndexedPvalue([0.898, 0.138, 0.007, 0.964, 0.538, 0.006, 0.138]),
      ).map((x) => {
        return { pValue: +x.pValue.toFixed(8), index: x.index };
      }),
    ).toEqual(
      mockIndexedPvalue(
        [0.964, 0.964, 0.7532, 0.2415, 0.2415, 0.0245, 0.0245],
        [3, 0, 4, 1, 6, 2, 5],
      ),
    );
  });

  it("adjusts CIs as we expect", () => {
    const adjCIs95pct = adjustedCI(
      0.049999999,
      { dist: "normal", mean: 0.1 },
      1.959963984540054,
    );
    expect(adjCIs95pct[0]).toBeGreaterThan(0);
    expect(adjCIs95pct[1]).toBeLessThan(0.2);
    expect(adjCIs95pct.map((x) => +x.toFixed(8))).toEqual([0, 0.2]);

    expect(
      adjustedCI(
        0.0099999999,
        { dist: "normal", mean: 0.1 },
        2.5758293035489004,
      ).map((x) => +x.toFixed(8)),
    ).toEqual([0, 0.2]);
  });
});
