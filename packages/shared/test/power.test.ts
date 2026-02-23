import { ExperimentSnapshotTraffic } from "shared/types/experiment-snapshot";
import { MetricPowerResponseFromStatsEngine } from "shared/types/stats";
import {
  frequentistVariance,
  powerEstFrequentist,
  findMdeFrequentist,
  powerMetricWeeks,
  calculatePriorMean,
  calculatePriorVariance,
  powerEstBayesian,
  findMdeBayesian,
  MetricParamsMean,
  MetricParams,
  PowerCalculationParams,
} from "../src/power";
import {
  calculateMidExperimentPowerSingle,
  getAverageExposureOverLastNDays,
  MidExperimentPowerParamsSingle,
} from "../src/enterprise/power";

describe("backend", () => {
  it("delta method variance absolute correct", () => {
    expect(+frequentistVariance(2, 7, 4, 0.5, 5, 15, false).toFixed(5)).toEqual(
      0.53333,
    );
  });

  it("delta method variance relative correct", () => {
    expect(+frequentistVariance(2, 7, 4, 0.5, 5, 15, true).toFixed(5)).toEqual(
      0.00589,
    );
  });
  it("calculates power correctly", () => {
    const meanMetric: MetricParamsMean = {
      type: "mean",
      name: "Conversion Rate",
      effectSize: 0.05,
      mean: 10,
      standardDeviation: Math.sqrt(3909.9997749994377),
      overrideMetricLevelSettings: true,
      overridePriorLiftMean: 0,
      overridePriorLiftStandardDeviation: 1,
      overrideProper: false,
      metricPriorLiftMean: 0,
      metricPriorLiftStandardDeviation: 1,
      metricProper: false,
    };
    expect(
      +powerEstFrequentist(meanMetric, 400000, 3, 0.05, true, 0).toFixed(5),
    ).toEqual(0.52144);
  });
  it("calculates two-tailed mde correctly", () => {
    const meanMetric: MetricParamsMean = {
      type: "mean",
      name: "Conversion Rate",
      effectSize: 0.05,
      mean: 10,
      standardDeviation: Math.sqrt(3909.9997749994377),
      overrideMetricLevelSettings: true,
      overridePriorLiftMean: 0,
      overridePriorLiftStandardDeviation: 1,
      overrideProper: false,
      metricPriorLiftMean: 0,
      metricPriorLiftStandardDeviation: 1,
      metricProper: false,
    };
    const mde1 = findMdeFrequentist(meanMetric, 0.8, 400000, 3, 0.05, 0);
    let mde = 100;
    if (mde1.type === "success") {
      mde = mde1.mde;
    }
    expect(parseFloat(mde.toFixed(5))).toEqual(0.07027);
  });
  it("calculates sequential power correctly", () => {
    const meanMetric: MetricParamsMean = {
      type: "mean",
      name: "Conversion Rate",
      effectSize: 0.05,
      mean: 10,
      standardDeviation: Math.sqrt(3909.9997749994377),
      overrideMetricLevelSettings: true,
      overridePriorLiftMean: 0,
      overridePriorLiftStandardDeviation: 1,
      overrideProper: false,
      metricPriorLiftMean: 0,
      metricPriorLiftStandardDeviation: 1,
      metricProper: false,
    };
    expect(
      +powerEstFrequentist(meanMetric, 400000, 3, 0.05, true, 5000).toFixed(5),
    ).toEqual(0.20596);
  });
  it("calculates sequential mde correctly", () => {
    const meanMetric: MetricParamsMean = {
      type: "mean",
      name: "Conversion Rate",
      effectSize: 0.05,
      mean: 10,
      standardDeviation: Math.sqrt(3909.9997749994377),
      overrideMetricLevelSettings: true,
      overridePriorLiftMean: 0,
      overridePriorLiftStandardDeviation: 1,
      overrideProper: false,
      metricPriorLiftMean: 0,
      metricPriorLiftStandardDeviation: 1,
      metricProper: false,
    };
    const mde1 = findMdeFrequentist(meanMetric, 0.8, 400000, 3, 0.05, 5000);
    let mde = 100;
    if (mde1.type === "success") {
      mde = mde1.mde;
    }
    expect(parseFloat(mde.toFixed(5))).toEqual(0.12821);
  });
  const metrics: { [id: string]: MetricParams } = {
    click_through_rate: {
      effectSize: 0.05,
      name: "click_through_rate",
      conversionRate: 0.1,
      type: "binomial",
      overrideMetricLevelSettings: true,
      overridePriorLiftMean: 0,
      overridePriorLiftStandardDeviation: 1,
      overrideProper: false,
      metricPriorLiftMean: 0,
      metricPriorLiftStandardDeviation: 1,
      metricProper: false,
    },
    revenue: {
      effectSize: 0.3,
      name: "revenue",
      mean: 0.1,
      standardDeviation: Math.sqrt(0.5),
      type: "mean",
      overrideMetricLevelSettings: false,
      overridePriorLiftMean: 0,
      overridePriorLiftStandardDeviation: 1,
      overrideProper: false,
      metricPriorLiftMean: 0,
      metricPriorLiftStandardDeviation: 1,
      metricProper: false,
    },
  };
  const metricsBayesian: { [id: string]: MetricParams } = {
    click_through_rate: {
      name: "click_through_rate",
      type: "binomial",
      conversionRate: 0.1,
      effectSize: 0.05,
      overrideMetricLevelSettings: false,
      overridePriorLiftMean: 0,
      overridePriorLiftStandardDeviation: 1,
      overrideProper: false,
      metricPriorLiftMean: 0.2,
      metricPriorLiftStandardDeviation: Math.sqrt(0.3),
      metricProper: true,
    },
    revenue: {
      name: "revenue",
      type: "mean",
      effectSize: 0.3,
      mean: 0.1,
      standardDeviation: Math.sqrt(0.5),
      overrideMetricLevelSettings: false,
      overridePriorLiftMean: 0,
      overridePriorLiftStandardDeviation: 1,
      overrideProper: false,
      metricPriorLiftMean: 0.2,
      metricPriorLiftStandardDeviation: Math.sqrt(0.3),
      metricProper: true,
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
      metricValuesSource: "manual",
    };
    const powerSettingsBayesian: PowerCalculationParams = {
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
      metricValuesSource: "manual",
    };
    const powerSolution = [
      0.073, 0.17053, 0.0965, 0.29389, 0.1204, 0.41122, 0.14458, 0.51749,
      0.16895, 0.61037, 0.19342, 0.68938, 0.21791, 0.75513, 0.24235, 0.80886,
      0.26666, 0.85213,
    ];
    const mdeSolution = [
      0.36767, 1.26769, 0.24505, 0.71941, 0.19525, 0.54299, 0.16673, 0.4506,
      0.14774, 0.39208, 0.13394, 0.35099, 0.12336, 0.32018, 0.11491, 0.29603,
      0.10796, 0.27647,
    ];
    const powerSolutionBayesian = [
      0.0752, 0.15127, 0.10103, 0.29358, 0.12581, 0.41893, 0.15048, 0.52858,
      0.17516, 0.62241, 0.19984, 0.70103, 0.22446, 0.7657, 0.24899, 0.81807,
      0.27334, 0.8599,
    ];
    const mdeSolutionBayesian = [
      0.36259, 1.65287, 0.24173, 0.73248, 0.1929, 0.54036, 0.16492, 0.44561,
      0.14626, 0.38687, 0.1327, 0.34604, 0.12228, 0.3156, 0.11396, 0.29182,
      0.10712, 0.27258,
    ];
    const sampleSizeAndRuntime = [undefined, 8];
    const resultsTS = powerMetricWeeks(powerSettings);
    const resultsTSBayesian = powerMetricWeeks(powerSettingsBayesian);
    let powerMultiple = [0.0, 0.0];
    let mdeMultiple = [1e5, 1e5];
    let powerMultipleBayesian = [0.0, 0.0];
    let mdeMultipleBayesian = [1e5, 1e5];
    const w0 = undefined;
    let w1 = 0;
    const w0Bayesian = undefined;
    let w1Bayesian = 0;
    if (resultsTS.type === "success") {
      powerMultiple = resultsTS.weeks.reduce(
        (result, { metrics }) =>
          Object.values(metrics).reduce(
            (result, { power }) => [...result, power],
            result,
          ),
        [],
      );
      mdeMultiple = resultsTS.weeks.reduce(
        (result, { metrics }) =>
          Object.values(metrics).reduce(
            (result, { effectSize }) => [...result, effectSize],
            result,
          ),
        [],
      );
      if (
        resultsTS.sampleSizeAndRuntime.click_through_rate?.weeks !== undefined
      ) {
        throw new Error("should be undefined");
      }
      if (resultsTS.sampleSizeAndRuntime.revenue?.weeks !== undefined) {
        w1 = resultsTS.sampleSizeAndRuntime.revenue?.weeks;
      }
    }
    if (resultsTSBayesian.type === "success") {
      powerMultipleBayesian = resultsTSBayesian.weeks.reduce(
        (result, { metrics }) =>
          Object.values(metrics).reduce(
            (result, { power }) => [...result, power],
            result,
          ),
        [],
      );
      mdeMultipleBayesian = resultsTSBayesian.weeks.reduce(
        (result, { metrics }) =>
          Object.values(metrics).reduce(
            (result, { effectSize }) => [...result, effectSize],
            result,
          ),
        [],
      );
      if (
        resultsTSBayesian.sampleSizeAndRuntime.click_through_rate?.weeks !==
        undefined
      ) {
        throw new Error("should be undefined");
      }
      if (resultsTSBayesian.sampleSizeAndRuntime.revenue?.weeks !== undefined) {
        w1Bayesian = resultsTSBayesian.sampleSizeAndRuntime.revenue?.weeks;
      }
    }
    expect(powerMultiple.map(roundToFifthDecimal)).toEqual(powerSolution);
    expect(mdeMultiple.map(roundToFifthDecimal)).toEqual(mdeSolution);
    expect(w0).toEqual(sampleSizeAndRuntime[0]);
    expect(w1).toEqual(sampleSizeAndRuntime[1]);
    expect(powerMultipleBayesian.map(roundToFifthDecimal)).toEqual(
      powerSolutionBayesian,
    );
    expect(mdeMultipleBayesian.map(roundToFifthDecimal)).toEqual(
      mdeSolutionBayesian,
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
      metricValuesSource: "manual",
    };
    const powerSolution = [
      0.05936, 0.09832, 0.06912, 0.14992, 0.07849, 0.19972, 0.08761, 0.24784,
      0.09657, 0.29426, 0.10541, 0.33888, 0.11415, 0.38165, 0.12282, 0.42249,
      0.13142, 0.46136,
    ];
    const mdeSolution = [
      0.65545, 4.33868, 0.4112, 1.51846, 0.32394, 1.04943, 0.27607, 0.84084,
      0.24484, 0.71862, 0.22241, 0.63663, 0.20532, 0.577, 0.19172, 0.53123,
      0.18058, 0.49473,
    ];
    const sampleSizeAndRuntime = [undefined, undefined];
    const resultsTS = powerMetricWeeks(powerSettings);

    let powerMultiple = [0.0, 0.0];
    let mdeMultiple = [1e5, 1e5];
    let w0: number | undefined = undefined;
    const w1 = undefined;
    if (resultsTS.type === "success") {
      powerMultiple = resultsTS.weeks.reduce(
        (result, { metrics }) =>
          Object.values(metrics).reduce(
            (result, { power }) => [...result, power],
            result,
          ),
        [],
      );
      mdeMultiple = resultsTS.weeks.reduce(
        (result, { metrics }) =>
          Object.values(metrics).reduce(
            (result, { effectSize }) => [...result, effectSize],
            result,
          ),
        [],
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
  const effectSizeRelative = 0.07024999999999991; /*0.12033664690846606;*/
  const effectSizeAbsolute = 0.06781974621178363;
  const nPerVariation = 400000 / 3;

  const myMetricRel: MetricParams = {
    type: "mean",
    name: "Time to completion",
    mean: 10, // Baseline mean value
    standardDeviation: Math.sqrt(3909.9997749994377), // Baseline standard deviation
    effectSize: effectSizeRelative, // Expected % change in mean
    overrideMetricLevelSettings: true,
    overridePriorLiftMean: 0.05, // Prior mean for lift in mean
    overridePriorLiftStandardDeviation: Math.sqrt(0.5476), // Prior standard deviation for lift in mean
    overrideProper: true, // Whether to use a proper prior (affects prior distribution)
    metricPriorLiftMean: 0,
    metricPriorLiftStandardDeviation: 1,
    metricProper: false,
  };
  const myMetricAbs = { ...myMetricRel };
  myMetricAbs.effectSize = effectSizeAbsolute;

  const mdeRelative = findMdeBayesian(
    myMetricRel,
    alpha,
    power,
    nPerVariation,
    true,
  );
  const mdeAbsolute = findMdeBayesian(
    myMetricAbs,
    alpha,
    power,
    nPerVariation,
    false,
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
    true,
  );

  const powerAbsolute = powerEstBayesian(
    myMetricAbs,
    alpha,
    nPerVariation,
    false,
  );

  expect(parseFloat(mdeRelativeScalar.toFixed(5))).toEqual(
    parseFloat(effectSizeRelative.toFixed(5)),
  );

  expect(parseFloat(mdeAbsoluteScalar.toFixed(5))).toEqual(
    parseFloat(effectSizeAbsolute.toFixed(5)),
  );

  expect(parseFloat(powerRelative.toFixed(3))).toEqual(power);
  expect(parseFloat(powerAbsolute.toFixed(3))).toEqual(power);
});

describe("getAverageExposureOverLastNDays", () => {
  it("should get average exposure over last 3 days", () => {
    const traffic: ExperimentSnapshotTraffic = {
      overall: {
        name: "All",
        srm: 1,
        variationUnits: [],
      },
      dimension: {
        dim_exposure_date: [
          { name: "2024-01-01", srm: 1, variationUnits: [98, 187, 294] },
          { name: "2024-01-02", srm: 1, variationUnits: [103, 212, 289] },
          { name: "2024-01-03", srm: 1, variationUnits: [95, 178, 307] },
        ],
      },
    };
    expect(
      getAverageExposureOverLastNDays(traffic, 3, new Date(2024, 0, 4)),
    ).toEqual(587);
  });

  it("should get average exposure over last 3 days with missing dates", () => {
    const traffic: ExperimentSnapshotTraffic = {
      overall: {
        name: "All",
        srm: 1,
        variationUnits: [],
      },
      dimension: {
        dim_exposure_date: [
          { name: "2024-01-01", srm: 1, variationUnits: [98, 187, 294] },
          { name: "2024-01-02", srm: 1, variationUnits: [103, 212, 289] },
          // Jan 3rd will be ignored as it is the date we are running the query on
          { name: "2024-01-03", srm: 1, variationUnits: [95, 178, 307] },
        ],
      },
    };
    expect(
      getAverageExposureOverLastNDays(traffic, 3, new Date(2024, 0, 3)),
    ).toEqual(394);
  });
});

it("midExperimentPower", () => {
  const firstPeriodPairwiseSampleSize = 1000;
  const targetMDE = 0.05;
  const sigmahat2Delta = 0.008426853707414856;
  const scalingFactorFreq = 25.45703125;
  const scalingFactorSeq = 55.66796875;
  const scalingFactorBayes = 13.9404296875;

  const gbstatsResponseFreq: MetricPowerResponseFromStatsEngine = {
    status: "successful",
    errorMessage: "",
    firstPeriodPairwiseSampleSize: firstPeriodPairwiseSampleSize,
    targetMDE: targetMDE,
    sigmahat2Delta: sigmahat2Delta,
    priorProper: false,
    upperBoundAchieved: false,
    scalingFactor: scalingFactorFreq,
  };
  const gbstatsResponseSeq: MetricPowerResponseFromStatsEngine = {
    status: "successful",
    errorMessage: "",
    firstPeriodPairwiseSampleSize: firstPeriodPairwiseSampleSize,
    targetMDE: targetMDE,
    sigmahat2Delta: sigmahat2Delta,
    priorProper: false,
    upperBoundAchieved: false,
    scalingFactor: scalingFactorSeq,
  };
  const gbstatsResponseBayes: MetricPowerResponseFromStatsEngine = {
    status: "successful",
    errorMessage: "",
    firstPeriodPairwiseSampleSize: firstPeriodPairwiseSampleSize,
    targetMDE: targetMDE,
    sigmahat2Delta: sigmahat2Delta,
    priorProper: true,
    priorLiftMean: 0.05,
    priorLiftVariance: 0.001,
    upperBoundAchieved: false,
    scalingFactor: scalingFactorBayes,
  };

  const powerParamsFreq: MidExperimentPowerParamsSingle = {
    alpha: 0.05,
    sequential: false,
    sequentialTuningParameter: 5000,
    daysRemaining: 1,
    firstPeriodSampleSize: firstPeriodPairwiseSampleSize,
    newDailyUsers: firstPeriodPairwiseSampleSize * scalingFactorFreq,
    numGoalMetrics: 1,
    numVariations: 2,
    variation: gbstatsResponseFreq,
  };
  const powerParamsSeq: MidExperimentPowerParamsSingle = {
    alpha: 0.05,
    sequential: true,
    sequentialTuningParameter: 5000,
    daysRemaining: 1,
    firstPeriodSampleSize: firstPeriodPairwiseSampleSize,
    newDailyUsers: firstPeriodPairwiseSampleSize * scalingFactorSeq,
    numGoalMetrics: 1,
    numVariations: 2,
    variation: gbstatsResponseSeq,
  };
  const powerParamsBayes: MidExperimentPowerParamsSingle = {
    alpha: 0.05,
    sequential: false,
    sequentialTuningParameter: 5000,
    daysRemaining: 1,
    firstPeriodSampleSize: firstPeriodPairwiseSampleSize,
    newDailyUsers: firstPeriodPairwiseSampleSize * scalingFactorBayes,
    numGoalMetrics: 1,
    numVariations: 2,
    variation: gbstatsResponseBayes,
  };

  const metricId = "click_through_rate";
  const variation = 1;
  const resultsSingleMetricFreq = calculateMidExperimentPowerSingle(
    powerParamsFreq,
    metricId,
    variation,
  );
  const resultsSingleMetricSeq = calculateMidExperimentPowerSingle(
    powerParamsSeq,
    metricId,
    variation,
  );
  const resultsSingleMetricBayes = calculateMidExperimentPowerSingle(
    powerParamsBayes,
    metricId,
    variation,
  );
  const powerTrue = 0.8;
  if (resultsSingleMetricFreq.power === undefined) {
    throw new Error("freq power is undefined.");
  } else {
    expect(parseFloat(resultsSingleMetricFreq.power.toFixed(4))).toEqual(
      parseFloat(powerTrue.toFixed(5)),
    );
  }
  if (resultsSingleMetricSeq.power === undefined) {
    throw new Error("seq power is undefined.");
  } else {
    expect(parseFloat(resultsSingleMetricSeq.power.toFixed(4))).toEqual(
      parseFloat(powerTrue.toFixed(5)),
    );
  }
  if (resultsSingleMetricBayes.power === undefined) {
    throw new Error("bayes power is undefined.");
  } else {
    expect(parseFloat(resultsSingleMetricBayes.power.toFixed(4))).toEqual(
      parseFloat(powerTrue.toFixed(5)),
    );
  }
});
