import {
  decimalToPercent,
  floatRound,
  getEqualWeights,
  percentToDecimal,
  rebalance,
} from "../services/utils";
import { correctPvalues } from "../services/experiments";
import { TableDef } from "@/components/Experiment/BreakDownResults";

describe("variation weighting functions", () => {
  it("getEqualWeights with default precision", () => {
    expect(getEqualWeights(1)).toEqual([1]);
    expect(getEqualWeights(2)).toEqual([0.5, 0.5]);
    expect(getEqualWeights(3)).toEqual([0.3334, 0.3333, 0.3333]);
    expect(getEqualWeights(4)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(getEqualWeights(5)).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(getEqualWeights(6)).toEqual([
      0.1667,
      0.1667,
      0.1667,
      0.1667,
      0.1666,
      0.1666,
    ]);
    expect(getEqualWeights(7)).toEqual([
      0.1429,
      0.1429,
      0.1429,
      0.1429,
      0.1428,
      0.1428,
      0.1428,
    ]);
  });

  it("getEqualWeights with lower precision", () => {
    expect(getEqualWeights(1, 3)).toEqual([1]);
    expect(getEqualWeights(2, 3)).toEqual([0.5, 0.5]);
    expect(getEqualWeights(3, 3)).toEqual([0.334, 0.333, 0.333]);
    expect(getEqualWeights(4, 3)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(getEqualWeights(5, 3)).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(getEqualWeights(6, 3)).toEqual([
      0.167,
      0.167,
      0.167,
      0.167,
      0.166,
      0.166,
    ]);
    expect(getEqualWeights(7, 3)).toEqual([
      0.143,
      0.143,
      0.143,
      0.143,
      0.143,
      0.143,
      0.142,
    ]);
  });

  it("getEqualWeights with higher precision", () => {
    expect(getEqualWeights(1, 5)).toEqual([1]);
    expect(getEqualWeights(2, 5)).toEqual([0.5, 0.5]);
    expect(getEqualWeights(3, 5)).toEqual([0.33334, 0.33333, 0.33333]);
    expect(getEqualWeights(4, 5)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(getEqualWeights(5, 5)).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(getEqualWeights(6, 5)).toEqual([
      0.16667,
      0.16667,
      0.16667,
      0.16667,
      0.16666,
      0.16666,
    ]);
    expect(getEqualWeights(7, 5)).toEqual([
      0.14286,
      0.14286,
      0.14286,
      0.14286,
      0.14286,
      0.14285,
      0.14285,
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
      0.3334,
      0.3406,
      0.326,
    ]);

    expect(rebalance([0.3334, 0.3333, 0.3333], 1, 1.5, 4)).toEqual([0, 1, 0]);

    expect(rebalance([0.3334, 0.3333, 0.3333], 1, 0.8, 4)).toEqual([
      0.2,
      0.8,
      0,
    ]);

    expect(rebalance([0.3334, 0.3333, 0.3333], 1, 0.12, 4)).toEqual([
      0.3334,
      0.12,
      0.5466,
    ]);
  });

  it("rounds floats", () => {
    expect(floatRound(0.546859483, 3)).toEqual(0.547);
    expect(floatRound(0.546859483, 4)).toEqual(0.5469);
    expect(floatRound(0.546859483, 5)).toEqual(0.54686);
  });
});

function mockTable(pvalues: number[], adjustedPvalues?: number[]) {
  let table: TableDef = {
    isGuardrail: false,
    rows: [{label: '', metric: undefined, variations: []}]
  };
  pvalues.forEach((p, i) => {
    let variation = {pValue: p, value: 0, cr: 0, users: 0, pValueAdjusted: null};
    if (adjustedPvalues !== undefined) {
      variation.pValueAdjusted = adjustedPvalues[i];
    }
    table.rows[0].variations.push(variation);
 });
  return table;
}

describe("pvalue correction method", () => {
  it("does HB procedure correctly", () => {
    const startPvals = [0.01, 0.04, 0.03, 0.005, 0.55, 0.6];
    expect(
      correctPvalues(
        [mockTable(startPvals)],
        "holm-bonferroni"
      )
    ).toEqual([mockTable(startPvals, [0.05, 0.12, 0.12, 0.03, 1, 1])])
  });
  it("does BH procedure correctly", () => {
    const startPvals = [0.01, 0.04, 0.03, 0.005];
    expect(
      correctPvalues(
        [mockTable(startPvals)],
        "benjamini-hochberg"
      )
    ).toEqual([mockTable(startPvals, [0.02, 0.04, 0.04, 0.02])])
  });
});
