import { checkSrm } from "back-end/src/util/stats";

describe("backend", () => {
  it("calculates SRM correctly", () => {
    // Simple 2-way test
    expect(+checkSrm([1000, 1200], [0.5, 0.5]).toFixed(9)).toEqual(0.000020079);

    // Another 2-way test
    expect(+checkSrm([135, 115], [0.5, 0.5]).toFixed(9)).toEqual(0.205903211);

    // Uneven weights
    expect(+checkSrm([310, 98], [0.75, 0.25]).toFixed(9)).toEqual(0.647434186);

    // Not enough valid variations
    expect(+checkSrm([1000], [0.5, 0.5])).toEqual(1);

    // Not enough valid weights
    expect(+checkSrm([1000, 900, 800], [1, 0, 0])).toEqual(1);

    // Skip empty weights
    expect(+checkSrm([1000, 1200, 900], [0.5, 0.5, 0]).toFixed(9)).toEqual(
      0.000020079,
    );

    // Skip if all users are 0
    expect(+checkSrm([0, 0, 0], [0.34, 0.33, 0.33])).toEqual(1);

    // Use empty users in the test
    expect(+checkSrm([0, 10, 10], [0.34, 0.33, 0.33]).toFixed(9)).toEqual(
      0.005790624,
    );

    // More than 2 variations
    expect(+checkSrm([500, 500, 600], [0.34, 0.33, 0.33]).toFixed(9)).toEqual(
      0.000592638,
    );

    // Completely equal
    expect(+checkSrm([500, 500], [0.5, 0.5]).toFixed(9)).toEqual(1);
  });
});
