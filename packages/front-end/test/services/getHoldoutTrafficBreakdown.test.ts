import { getHoldoutTrafficBreakdown } from "@/services/utils";

describe("getHoldoutTrafficBreakdown", () => {
  it("computes the breakdown at 10% coverage", () => {
    expect(
      getHoldoutTrafficBreakdown({
        coverage: 0.1,
        variationWeights: [0.5, 0.5],
      }),
    ).toEqual({
      inHoldoutPercent: 5,
      forMeasurementPercent: 5,
      notForMeasurementPercent: 90,
    });
  });

  it("computes the breakdown at 20% coverage", () => {
    expect(
      getHoldoutTrafficBreakdown({
        coverage: 0.2,
        variationWeights: [0.5, 0.5],
      }),
    ).toEqual({
      inHoldoutPercent: 10,
      forMeasurementPercent: 10,
      notForMeasurementPercent: 80,
    });
  });

  it("computes the breakdown at 50% coverage", () => {
    expect(
      getHoldoutTrafficBreakdown({
        coverage: 0.5,
        variationWeights: [0.5, 0.5],
      }),
    ).toEqual({
      inHoldoutPercent: 25,
      forMeasurementPercent: 25,
      notForMeasurementPercent: 50,
    });
  });

  it("keeps a fractional holdout size, and the three add up to 100%", () => {
    expect(
      getHoldoutTrafficBreakdown({
        coverage: 0.02469,
        variationWeights: [0.5, 0.5],
      }),
    ).toEqual({
      inHoldoutPercent: 1.2345,
      forMeasurementPercent: 1.2345,
      notForMeasurementPercent: 97.531,
    });
  });

  it("doesn't lose a percent to float error", () => {
    // 0.58 * 0.5 * 100 is 28.999…
    expect(
      getHoldoutTrafficBreakdown({
        coverage: 0.58,
        variationWeights: [0.5, 0.5],
      }),
    ).toEqual({
      inHoldoutPercent: 29,
      forMeasurementPercent: 29,
      notForMeasurementPercent: 42,
    });
  });
});
