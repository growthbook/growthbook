import { checkSrm, correctPvalues } from "../src/util/stats";

describe("backend", () => {
  it("calculates SRM correctly", () => {
    // Simple 2-way test
    expect(+checkSrm([1000, 1200], [0.5, 0.5]).toFixed(9)).toEqual(0.000020079);

    // Another 2-way test
    expect(+checkSrm([135, 115], [0.5, 0.5]).toFixed(9)).toEqual(0.205903211);

    // Uneven weights
    expect(+checkSrm([310, 98], [0.75, 0.25]).toFixed(9)).toEqual(0.647434186);

    // Not enough valid variations
    expect(+checkSrm([1000, 0], [0.5, 0.5])).toEqual(1);

    // Not enough valid weights
    expect(+checkSrm([1000, 900, 800], [1, 0, 0])).toEqual(1);

    // Skip empty weights
    expect(+checkSrm([1000, 1200, 900], [0.5, 0.5, 0]).toFixed(9)).toEqual(
      0.000020079
    );

    // Skip empty users
    expect(+checkSrm([0, 505, 500], [0.34, 0.33, 0.33]).toFixed(9)).toEqual(
      0.874677381
    );

    // More than 2 variations
    expect(+checkSrm([500, 500, 600], [0.34, 0.33, 0.33]).toFixed(9)).toEqual(
      0.000592638
    );

    // Completely equal
    expect(+checkSrm([500, 500], [0.5, 0.5]).toFixed(9)).toEqual(1);
  });
});


describe("pvalue correction method", () => {
  it("does HB procedure correctly", () => {
    expect(
      correctPvalues(
        [
          [0.01, 0],
          [0.04, 1],
          [0.03, 2],
          [0.005, 3],
          [0.55, 4],
          [0.6, 5],
        ],
        "holm-bonferroni"
      )
    ).toEqual([
      [0.03, 3],
      [0.05, 0],
      [0.12, 2],
      [0.12, 1],
      [1, 4],
      [1, 5],
    ]);
  });
  it("does BH procedure correctly", () => {
    expect(
      correctPvalues(
        [
          [0.01, 0],
          [0.04, 1],
          [0.03, 2],
          [0.005, 3],
        ],
        "benjamini-hochberg"
      )
    ).toEqual([
      [0.02, 3],
      [0.02, 0],
      [0.04, 2],
      [0.04, 1],
    ]);
  });
});
