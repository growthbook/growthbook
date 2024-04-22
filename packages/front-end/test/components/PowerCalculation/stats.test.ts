import {
  frequentistVariance,
  powerEst,
  findMde,
  powerMetricWeeks,
  MetricParams,
  PowerCalculationParams,
} from "@/components/PowerCalculation/stats";

describe("backend", () => {
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
        0.05,
        10.0,
        3909.9997749994377,
        400000,
        3,
        0.05,
        true,
        0
      ).toFixed(5)
    ).toEqual(0.52144);
  });
  it("calculates two-tailed mde correctly", () => {
    expect(
      +findMde(0.8, 10.0, 3909.9997749994377, 400000, 3, 0.05, true).toFixed(5)
    ).toEqual(0.07027);
  });
  it("calculates sequential power correctly", () => {
    expect(
      +powerEst(
        0.05,
        10.0,
        3909.9997749994377,
        400000,
        3,
        0.05,
        true,
        5000
      ).toFixed(5)
    ).toEqual(0.21526);
  });
  it("calculates sequential mde correctly", () => {
    expect(
      +findMde(
        0.8,
        10.0,
        3909.9997749994377,
        400000,
        3,
        0.05,
        true,
        5000
      ).toFixed(5)
    ).toEqual(0.12439);
  });
  const metrics: { [id: string]: MetricParams } = {
    click_through_rate: {
      effectSize: 0.3,
      name: "click_through_rate",
      conversionRate: 0.1,
      type: "binomial",
    },
    revenue: {
      effectSize: 0.05,
      name: "revenue",
      mean: 0.1,
      standardDeviation: Math.sqrt(0.5),
      type: "mean",
    },
  };
  const usersPerDay = 4500;
  const nVariations = 3;
  const alpha = 0.05;

  function roundToFifthDecimal(num: number): number {
    return Number(num.toFixed(5));
  }
  it("checks power", () => {
    const powerSettings: PowerCalculationParams = {
      usersPerDay: usersPerDay,
      metrics: metrics,
      nVariations: nVariations,
      alpha: alpha,
      statsEngine: {
        type: "frequentist",
        sequentialTesting: false,
      },
    };
    const powerSolution = [
      0.65596,
      0.91614,
      0.98342,
      0.99713,
      0.99955,
      0.99993,
      0.99999,
      1,
      1,
      0.0541,
      0.05821,
      0.06235,
      0.0665,
      0.07067,
      0.07486,
      0.07906,
      0.08328,
      0.08752,
    ];
    const mdeSolution = [
      0.36767,
      0.24505,
      0.19525,
      0.16673,
      0.14774,
      0.13394,
      0.12336,
      0.11491,
      0.10796,
      1.26769,
      0.71941,
      0.54299,
      0.4506,
      0.39208,
      0.35099,
      0.32018,
      0.29603,
      0.27647,
    ];
    const sampleSizeAndRuntime = [2, 999];
    const duration = 999;
    const resultsTS = powerMetricWeeks({ powerSettings });
    expect(resultsTS.power.map(roundToFifthDecimal)).toEqual(powerSolution);
    expect(resultsTS.mde.map(roundToFifthDecimal)).toEqual(mdeSolution);
    expect(resultsTS.sampleSizeAndRuntime.click_through_rate.weeks).toEqual(
      sampleSizeAndRuntime[0]
    );
    expect(resultsTS.sampleSizeAndRuntime.revenue.weeks).toEqual(
      sampleSizeAndRuntime[1]
    );
    expect(resultsTS.duration).toEqual(duration);
  });
  it("checks sequential power", () => {
    const powerSettings: PowerCalculationParams = {
      usersPerDay: usersPerDay,
      metrics: metrics,
      nVariations: nVariations,
      alpha: alpha,
      statsEngine: {
        type: "frequentist",
        sequentialTesting: 5000,
      },
    };
    const powerSolution = [
      0.30414,
      0.57084,
      0.75173,
      0.86177,
      0.92502,
      0.9601,
      0.97908,
      0.98916,
      0.99443,
      0.05153,
      0.05336,
      0.05512,
      0.05684,
      0.05851,
      0.06016,
      0.06178,
      0.06338,
      0.06496,
    ];
    const mdeSolution = [
      0.69817,
      0.41527,
      0.32173,
      0.27201,
      0.24014,
      0.21752,
      0.20041,
      0.18688,
      0.17583,
      5.45133,
      1.54392,
      1.03912,
      0.82437,
      0.70107,
      0.61932,
      0.56031,
      0.51526,
      0.47946,
    ];
    const sampleSizeAndRuntime = [4, 999];
    const duration = 999;
    const resultsTS = powerMetricWeeks({ powerSettings });
    expect(resultsTS.power.map(roundToFifthDecimal)).toEqual(powerSolution);
    expect(resultsTS.mde.map(roundToFifthDecimal)).toEqual(mdeSolution);
    expect(resultsTS.sampleSizeAndRuntime.click_through_rate.weeks).toEqual(
      sampleSizeAndRuntime[0]
    );
    expect(resultsTS.sampleSizeAndRuntime.revenue.weeks).toEqual(
      sampleSizeAndRuntime[1]
    );
    expect(resultsTS.duration).toEqual(duration);
  });
});
