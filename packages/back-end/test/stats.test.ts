import {
  checkSrm,
  frequentistVariance,
  powerEst,
  findMde,
} from "../src/util/stats";

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
  it("delta method variance absolute correct", () => {
    expect(+frequentistVariance(2, 7, 4, 0.5, 5, 15, false).toFixed(5)).toEqual(
      0.53333
    );
  });

  it("delta method variance relative correct", () => {
    expect(+frequentistVariance(2, 7, 4, 0.5, 5, 15, true).toFixed(5)).toEqual(
      0.00589
    );
  });
  it("calculates power correctly", () => {
    expect(
      +powerEst(
        0.0706142187656053,
        10.0,
        3909.9997749994377,
        400000,
        3,
        0.05,
        true
      ).toFixed(5)
    ).toEqual(0.80366);
  });
  it("calculates two-tailed mde correctly", () => {
    expect(
      +findMde(0.8, 10.0, 3909.9997749994377, 400000, 3, 0.05, true).toFixed(5)
    ).toEqual(0.07061);
  });
  //it("calculates sequential power correctly", () => {
  //  expect(+
  //    powerEst(
  //      0.05, 10.0, 3909.9997749994377, 400000, 3, 0.05, true, 5000).toFixed(5)).toEqual(
  //    0.22615
  //  );
  //});
});
