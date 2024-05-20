import {
  MetricParamsFrequentist,
  MetricParamsBayesian,
  PowerCalculationParams,
  PowerCalculationParamsBayesian,
} from "@/components/PowerCalculation/types";

import {
  frequentistVariance,
  powerEst,
  findMde,
  powerMetricWeeks,
  calculatePriorMean,
  calculatePriorVariance,
  powerEstBayesian,
  findMdeBayesian,
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
    const meanMetric: MetricParamsFrequentist = {
      type: "mean",
      name: "Conversion Rate",
      effectSize: 0.05,
      metricMean: 10,
      metricStandardDeviation: Math.sqrt(3909.9997749994377),
    };
    expect(+powerEst(meanMetric, 400000, 3, 0.05, true, 0).toFixed(5)).toEqual(
      0.52144
    );
  });
  it("calculates two-tailed mde correctly", () => {
    const meanMetric: MetricParamsFrequentist = {
      type: "mean",
      name: "Conversion Rate",
      effectSize: 0.05,
      metricMean: 10,
      metricStandardDeviation: Math.sqrt(3909.9997749994377),
    };
    const mde1 = findMde(meanMetric, 0.8, 400000, 3, 0.05, 0);
    let mde = 100;
    if (mde1.type === "success") {
      mde = mde1.mde;
    }
    expect(parseFloat(mde.toFixed(5))).toEqual(0.07027);
  });
  it("calculates sequential power correctly", () => {
    const meanMetric: MetricParamsFrequentist = {
      type: "mean",
      name: "Conversion Rate",
      effectSize: 0.05,
      metricMean: 10,
      metricStandardDeviation: Math.sqrt(3909.9997749994377),
    };
    expect(
      +powerEst(meanMetric, 400000, 3, 0.05, true, 5000).toFixed(5)
    ).toEqual(0.20596);
  });
  it("calculates sequential mde correctly", () => {
    const meanMetric: MetricParamsFrequentist = {
      type: "mean",
      name: "Conversion Rate",
      effectSize: 0.05,
      metricMean: 10,
      metricStandardDeviation: Math.sqrt(3909.9997749994377),
    };
    const mde1 = findMde(meanMetric, 0.8, 400000, 3, 0.05, 5000);
    let mde = 100;
    if (mde1.type === "success") {
      mde = mde1.mde;
    }
    expect(parseFloat(mde.toFixed(5))).toEqual(0.12821);
  });
  const metrics: { [id: string]: MetricParamsFrequentist } = {
    click_through_rate: {
      effectSize: 0.3,
      name: "click_through_rate",
      conversionRate: 0.1,
      type: "binomial",
    },
    revenue: {
      effectSize: 0.05,
      name: "revenue",
      metricMean: 0.1,
      metricStandardDeviation: Math.sqrt(0.5),
      type: "mean",
    },
  };
  const metricsBayesian: { [id: string]: MetricParamsBayesian } = {
    click_through_rate: {
      name: "click_through_rate",
      type: "binomial",
      conversionRate: 0.1,
      effectSize: 0.3,
      priorStandardDeviationDGP: 0,
      priorLiftMean: 0.2,
      priorLiftStandardDeviation: Math.sqrt(0.3),
      proper: true,
    },
    revenue: {
      name: "revenue",
      type: "mean",
      effectSize: 0.05,
      priorStandardDeviationDGP: 0,
      metricMean: 0.1,
      metricStandardDeviation: Math.sqrt(0.5),
      priorLiftMean: 0.2,
      priorLiftStandardDeviation: Math.sqrt(0.3),
      proper: true,
    },
  };

  const usersPerWeek = 4500;
  const nVariations = 3;
  const alpha = 0.05;
  const nWeeks = 9;

  function roundToFifthDecimal(num: number): number {
    return Number(num.toFixed(5));
  }

  it("checks power", () => {
    const powerSettings: PowerCalculationParams = {
      usersPerWeek: usersPerWeek,
      metrics: metrics,
      nVariations: nVariations,
      nWeeks: nWeeks,
      targetPower: 0.8,
      alpha: alpha,
      statsEngineSettings: {
        type: "frequentist",
        sequentialTesting: false,
      },
    };
    const powerSettingsBayesian: PowerCalculationParamsBayesian = {
      usersPerWeek: usersPerWeek,
      metrics: metricsBayesian,
      nVariations: nVariations,
      nWeeks: nWeeks,
      targetPower: 0.8,
      alpha: alpha,
      statsEngineSettings: {
        type: "bayesian",
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
    const powerSolutionBayesian = [
      0.6679,
      0.04054,
      0.92121,
      0.05343,
      0.98467,
      0.06103,
      0.99738,
      0.06705,
      0.99959,
      0.07239,
      0.99994,
      0.07739,
      0.99999,
      0.08219,
      1.0,
      0.08686,
      1.0,
      0.09146,
    ];
    const mdeSolutionBayesian = [
      0.36258,
      1.65289,
      0.24173,
      0.73247,
      0.1929,
      0.54036,
      0.16491,
      0.44561,
      0.14625,
      0.38687,
      0.13269,
      0.34604,
      0.12228,
      0.3156,
      0.11396,
      0.29181,
      0.10711,
      0.27258,
    ];

    const sampleSizeAndRuntime = [2, undefined];
    const resultsTS = powerMetricWeeks(powerSettings);
    const resultsTSBayesian = powerMetricWeeks(powerSettingsBayesian);
    let powerMultiple = [0.0, 0.0];
    let mdeMultiple = [1e5, 1e5];
    let powerMultipleBayesian = [0.0, 0.0];
    let mdeMultipleBayesian = [1e5, 1e5];
    let w0 = 0;
    const w1 = undefined;
    let w0Bayesian = 0;
    const w1Bayesian = undefined;
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
    if (resultsTSBayesian.type === "success") {
      powerMultipleBayesian = resultsTSBayesian.weeks.reduce(
        (result, { metrics }) =>
          Object.values(metrics).reduce(
            (result, { power }) => [...result, power],
            result
          ),
        []
      );
      mdeMultipleBayesian = resultsTSBayesian.weeks.reduce(
        (result, { metrics }) =>
          Object.values(metrics).reduce(
            (result, { effectSize }) => [...result, effectSize],
            result
          ),
        []
      );
      if (
        resultsTSBayesian.sampleSizeAndRuntime.click_through_rate?.weeks !==
        undefined
      ) {
        w0Bayesian =
          resultsTSBayesian.sampleSizeAndRuntime.click_through_rate?.weeks;
      }
      if (resultsTSBayesian.sampleSizeAndRuntime.revenue?.weeks !== undefined) {
        throw new Error("should be undefined");
      }
    }
    expect(powerMultiple.map(roundToFifthDecimal)).toEqual(powerSolution);
    expect(mdeMultiple.map(roundToFifthDecimal)).toEqual(mdeSolution);
    expect(sampleSizeAndRuntime[0]).toEqual(w0);
    expect(sampleSizeAndRuntime[1]).toEqual(w1);
    expect(powerMultipleBayesian.map(roundToFifthDecimal)).toEqual(
      powerSolutionBayesian
    );
    expect(mdeMultipleBayesian.map(roundToFifthDecimal)).toEqual(
      mdeSolutionBayesian
    );
    expect(sampleSizeAndRuntime[0]).toEqual(w0Bayesian);
    expect(sampleSizeAndRuntime[1]).toEqual(w1Bayesian);
  });
  it("checks sequential power", () => {
    const powerSettings: PowerCalculationParams = {
      usersPerWeek: usersPerWeek,
      metrics: metrics,
      nVariations: nVariations,
      alpha: alpha,
      nWeeks: 9,
      targetPower: 0.8,
      statsEngineSettings: {
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

it("calculatePriorMean", () => {
  expect(+calculatePriorMean(1 / 7, 4, true)).toEqual(1 / 7);
  expect(+calculatePriorMean(1 / 7, 4, false)).toEqual(4 / 7);
});
it("calculatePriorVariance", () => {
  expect(+calculatePriorVariance(1 / 7, 4, true)).toEqual(1 / 7);
  expect(+calculatePriorVariance(1 / 7, 4, false)).toEqual(16 / 7);
});

it("powerEstBayesian", () => {
  const power = 0.8;
  const alpha = 0.05;
  const effectSizeRelative = 0.12033664690846606;
  const effectSizeAbsolute = 0.11431978395869613;
  const nPerVariation = 400000 / 3;

  const myMetricRel: MetricParamsBayesian = {
    type: "mean",
    name: "Time to completion",
    metricMean: 10, // Baseline mean value
    metricStandardDeviation: Math.sqrt(3909.9997749994377), // Baseline standard deviation
    effectSize: effectSizeRelative, // Expected % change in mean
    priorStandardDeviationDGP: Math.sqrt(0.010000000000000002),
    priorLiftMean: 0.05, // Prior mean for lift in mean
    priorLiftStandardDeviation: Math.sqrt(0.5476), // Prior standard deviation for lift in mean
    proper: true, // Whether to use a proper prior (affects prior distribution)
  };
  const myMetricAbs = { ...myMetricRel };
  myMetricAbs.effectSize = effectSizeAbsolute;

  const mdeRelative = findMdeBayesian(
    myMetricRel,
    alpha,
    power,
    nPerVariation,
    true
  );
  const mdeAbsolute = findMdeBayesian(
    myMetricAbs,
    alpha,
    power,
    nPerVariation,
    false
  );
  let mdeRelativeScalar = -999;
  if (mdeRelative.type === "success") {
    mdeRelativeScalar = mdeRelative.mde;
  }
  let mdeAbsoluteScalar = -999;
  if (mdeAbsolute.type === "success") {
    mdeAbsoluteScalar = mdeAbsolute.mde;
  }

  const powerRelative = powerEstBayesian(
    myMetricRel,
    alpha,
    nPerVariation,
    true
  );

  const powerAbsolute = powerEstBayesian(
    myMetricAbs,
    alpha,
    nPerVariation,
    false
  );

  expect(parseFloat(mdeRelativeScalar.toFixed(5))).toEqual(
    parseFloat(effectSizeRelative.toFixed(5))
  );

  expect(parseFloat(mdeAbsoluteScalar.toFixed(5))).toEqual(
    parseFloat(effectSizeAbsolute.toFixed(5))
  );

  expect(parseFloat(powerRelative.toFixed(5))).toEqual(power);
  expect(parseFloat(powerAbsolute.toFixed(5))).toEqual(power);
});
