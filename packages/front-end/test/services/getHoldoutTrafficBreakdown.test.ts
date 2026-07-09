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
});
