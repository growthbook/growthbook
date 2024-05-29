import {
  MetricParams,
  PowerCalculationParams,
} from "@/components/PowerCalculation/types";

import {
  frequentistVariance,
  powerEst,
  findMde,
  powerMetricWeeks,
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
    const mde1 = findMde(0.8, 10.0, 3909.9997749994377, 400000, 3, 0.05);
    let mde = 100;
    if (mde1.type === "success") {
      mde = mde1.mde;
    }
    expect(parseFloat(mde.toFixed(5))).toEqual(0.07027);
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
    ).toEqual(0.20596);
  });
  it("calculates sequential mde correctly", () => {
    const mde1 = findMde(0.8, 10.0, 3909.9997749994377, 400000, 3, 0.05, 5000);
    let mde = 100;
    if (mde1.type === "success") {
      mde = mde1.mde;
    }
    expect(parseFloat(mde.toFixed(5))).toEqual(0.12821);
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
  const usersPerWeek = 4500;
  const nVariations = 3;
  const alpha = 0.05;

  function roundToFifthDecimal(num: number): number {
    return Number(num.toFixed(5));
  }

  it("checks power", () => {
    const powerSettings: PowerCalculationParams = {
      usersPerWeek: usersPerWeek,
      metrics: metrics,
      nVariations: nVariations,
      nWeeks: 9,
      targetPower: 0.8,
      alpha: alpha,
      statsEngine: {
        type: "frequentist",
        sequentialTesting: false,
      },
    };
    const powerSolution = [
      0.65596,
      0.0541,
      0.91614,
      0.05821,
      0.98342,
      0.06235,
      0.99713,
      0.0665,
      0.99955,
      0.07067,
      0.99993,
      0.07486,
      0.99999,
      0.07906,
      1.0,
      0.08328,
      1.0,
      0.08752,
    ];
    const mdeSolution = [
      0.36767,
      1.26769,
      0.24505,
      0.71941,
      0.19525,
      0.54299,
      0.16673,
      0.4506,
      0.14774,
      0.39208,
      0.13394,
      0.35099,
      0.12336,
      0.32018,
      0.11491,
      0.29603,
      0.10796,
      0.27647,
    ];
    const sampleSizeAndRuntime = [2, undefined];
    const resultsTS = powerMetricWeeks(powerSettings);
    let powerMultiple = [0.0, 0.0];
    let mdeMultiple = [1e5, 1e5];
    let w0 = 0;
    const w1 = undefined;
    if (resultsTS.type === "success") {
      powerMultiple = resultsTS.weeks.reduce(
        (result, { metrics }) =>
          Object.values(metrics).reduce(
            (result, { power }) => [...result, power],
            result
          ),
        []
      );
      mdeMultiple = resultsTS.weeks.reduce(
        (result, { metrics }) =>
          Object.values(metrics).reduce(
            (result, { effectSize }) => [...result, effectSize],
            result
          ),
        []
      );
      if (
        resultsTS.sampleSizeAndRuntime.click_through_rate?.weeks !== undefined
      ) {
        w0 = resultsTS.sampleSizeAndRuntime.click_through_rate?.weeks;
      }
      if (resultsTS.sampleSizeAndRuntime.revenue?.weeks !== undefined) {
        throw new Error("should be undefined");
      }
    }
    expect(powerMultiple.map(roundToFifthDecimal)).toEqual(powerSolution);
    expect(mdeMultiple.map(roundToFifthDecimal)).toEqual(mdeSolution);
    expect(sampleSizeAndRuntime[0]).toEqual(w0);
    expect(sampleSizeAndRuntime[1]).toEqual(w1);
  });
  it("checks sequential power", () => {
    const powerSettings: PowerCalculationParams = {
      usersPerWeek: usersPerWeek,
      metrics: metrics,
      nVariations: nVariations,
      alpha: alpha,
      nWeeks: 9,
      targetPower: 0.8,
      statsEngine: {
        type: "frequentist",
        sequentialTesting: 5000,
      },
    };
    const powerSolution = [
      0.32738,
      0.05168,
      0.57751,
      0.05341,
      0.74687,
      0.05506,
      0.85299,
      0.05666,
      0.91653,
      0.05822,
      0.95341,
      0.05976,
      0.97435,
      0.06127,
      0.98603,
      0.06277,
      0.99247,
      0.06424,
    ];
    const mdeSolution = [
      0.65545,
      4.33868,
      0.4112,
      1.51846,
      0.32394,
      1.04943,
      0.27607,
      0.84084,
      0.24484,
      0.71862,
      0.22241,
      0.63663,
      0.20532,
      0.577,
      0.19172,
      0.53123,
      0.18058,
      0.49473,
    ];
    const sampleSizeAndRuntime = [4, undefined];
    const resultsTS = powerMetricWeeks(powerSettings);

    let powerMultiple = [0.0, 0.0];
    let mdeMultiple = [1e5, 1e5];
    let w0 = 0;
    const w1 = undefined;
    if (resultsTS.type === "success") {
      powerMultiple = resultsTS.weeks.reduce(
        (result, { metrics }) =>
          Object.values(metrics).reduce(
            (result, { power }) => [...result, power],
            result
          ),
        []
      );
      mdeMultiple = resultsTS.weeks.reduce(
        (result, { metrics }) =>
          Object.values(metrics).reduce(
            (result, { effectSize }) => [...result, effectSize],
            result
          ),
        []
      );
      if (
        resultsTS.sampleSizeAndRuntime.click_through_rate?.weeks !== undefined
      ) {
        w0 = resultsTS.sampleSizeAndRuntime.click_through_rate?.weeks;
      }
      if (resultsTS.sampleSizeAndRuntime.revenue?.weeks !== undefined) {
        throw new Error("should be undefined");
      }
    }
    expect(powerMultiple.map(roundToFifthDecimal)).toEqual(powerSolution);
    expect(mdeMultiple.map(roundToFifthDecimal)).toEqual(mdeSolution);
    expect(sampleSizeAndRuntime[0]).toEqual(w0);
    expect(sampleSizeAndRuntime[1]).toEqual(w1);
  });
});
