import { getHoldoutTrafficBreakdown } from "@/services/utils";

describe("getHoldoutTrafficBreakdown", () => {
  it("computes the breakdown for the default 50/50 holdout", () => {
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

  it("scales with coverage", () => {
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

  it("uses variationWeights[0] for both holdout lines", () => {
    expect(
      getHoldoutTrafficBreakdown({
        coverage: 0.5,
        variationWeights: [0.4, 0.6],
      }),
    ).toEqual({
      inHoldoutPercent: 20,
      forMeasurementPercent: 20,
      notForMeasurementPercent: 60,
    });
  });
});
