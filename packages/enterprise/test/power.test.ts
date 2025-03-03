import { ExperimentSnapshotTraffic } from "back-end/types/experiment-snapshot";
import normal from "@stdlib/stats/base/dists/normal";
import { MetricPowerResponseFromStatsEngine } from "back-end/types/stats";
import {
  calculateMidExperimentPowerSingle,
  getAverageExposureOverLastNDays,
  MidExperimentPowerParamsSingle,
  MidExperimentPowerParamsSingleSeq,
  calculateMidExperimentPowerFreq,
  calculateMidExperimentPowerBayes,
  calculateMidExperimentPowerSeq,
} from "../src";

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
      getAverageExposureOverLastNDays(traffic, 3, new Date(2024, 0, 4))
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
      getAverageExposureOverLastNDays(traffic, 3, new Date(2024, 0, 3))
    ).toEqual(394);
  });
});

it("calculateMidExperimentPowerFreq and calculateMidExperimentPowerBayes", () => {
  const numVariations = 2;
  const numGoalMetrics = 1;
  const numTests = (numVariations - 1) * numGoalMetrics;
  const firstPeriodPairwiseSampleSize = 1000;
  const targetMDE = 0.05;
  const sigmahat2Delta = 0.008426853707414856;
  const scalingFactorFreq = 25.45703125;
  const scalingFactorBayes = 13.9404296875;
  const alpha = 0.05;
  const pValueCorrected = false;
  const priorLiftMean = 0.05;
  const priorLiftVariance = 0.001;
  const powerTrue = 0.8;

  const adjustedVarianceFreq =
    (sigmahat2Delta * firstPeriodPairwiseSampleSize) /
    (firstPeriodPairwiseSampleSize * (1 + scalingFactorFreq));
  const adjustedVarianceBayes =
    (sigmahat2Delta * firstPeriodPairwiseSampleSize) /
    (firstPeriodPairwiseSampleSize * (1 + scalingFactorBayes));
  const halfwidth =
    Math.sqrt(adjustedVarianceFreq) *
    normal.quantile(1 - alpha / (2 * numTests), 0, 1);
  const powerFreq = calculateMidExperimentPowerFreq(
    targetMDE,
    halfwidth,
    adjustedVarianceFreq
  );
  const powerBayes = calculateMidExperimentPowerBayes(
    alpha,
    pValueCorrected,
    numVariations,
    numGoalMetrics,
    targetMDE,
    adjustedVarianceBayes,
    priorLiftMean,
    priorLiftVariance
  );

  if (powerFreq === undefined) {
    throw new Error("freq power is undefined.");
  } else {
    expect(parseFloat(powerFreq.toFixed(4))).toEqual(
      parseFloat(powerTrue.toFixed(4))
    );
  }
  if (powerBayes === undefined) {
    throw new Error("bayes power is undefined.");
  } else {
    expect(parseFloat(powerBayes.toFixed(5))).toEqual(
      parseFloat(powerTrue.toFixed(5))
    );
  }
});

it("midExperimentPower for freq and Bayesian cases", () => {
  const firstPeriodPairwiseSampleSize = 1000;
  const targetMDE = 0.05;
  const sigmahat2Delta = 0.008426853707414856;
  const deltaPosterior = 0; //shouldn't matter, as these do not use experimental data
  const sigma2Posterior = 1; //shouldn't matter, as these do not use experimental data
  const scalingFactorFreq = 25.45703125;
  const scalingFactorBayes = 13.9404296875;
  const pValueCorrected = false;

  const gbstatsResponseFreq: MetricPowerResponseFromStatsEngine = {
    status: "successful",
    errorMessage: "",
    firstPeriodPairwiseSampleSize: firstPeriodPairwiseSampleSize,
    targetMDE: targetMDE,
    sigmahat2Delta: sigmahat2Delta,
    deltaPosterior: deltaPosterior,
    sigma2Posterior: sigma2Posterior,
    priorProper: false,
    upperBoundAchieved: false,
    scalingFactor: scalingFactorFreq,
  };
  const gbstatsResponseBayes: MetricPowerResponseFromStatsEngine = {
    status: "successful",
    errorMessage: "",
    firstPeriodPairwiseSampleSize: firstPeriodPairwiseSampleSize,
    targetMDE: targetMDE,
    sigmahat2Delta: sigmahat2Delta,
    deltaPosterior: deltaPosterior,
    sigma2Posterior: sigma2Posterior,
    priorProper: true,
    priorLiftMean: 0.05,
    priorLiftVariance: 0.001,
    upperBoundAchieved: false,
    scalingFactor: scalingFactorBayes,
  };

  const powerParamsFreq: MidExperimentPowerParamsSingle = {
    alpha: 0.05,
    pValueCorrected: pValueCorrected,
    sequential: false,
    sequentialTuningParameter: 5000,
    daysRemaining: 1,
    firstPeriodSampleSize: firstPeriodPairwiseSampleSize,
    newDailyUsers: firstPeriodPairwiseSampleSize * scalingFactorFreq,
    numGoalMetrics: 1,
    numVariations: 2,
    variation: gbstatsResponseFreq,
  };
  const powerParamsBayes: MidExperimentPowerParamsSingle = {
    alpha: 0.05,
    pValueCorrected: pValueCorrected,
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
    variation
  );
  const resultsSingleMetricBayes = calculateMidExperimentPowerSingle(
    powerParamsBayes,
    metricId,
    variation
  );
  const powerTrue = 0.8;
  if (resultsSingleMetricFreq.power === undefined) {
    throw new Error("freq power is undefined.");
  } else {
    expect(parseFloat(resultsSingleMetricFreq.power.toFixed(4))).toEqual(
      parseFloat(powerTrue.toFixed(4))
    );
  }
  if (resultsSingleMetricBayes.power === undefined) {
    throw new Error("bayes power is undefined.");
  } else {
    expect(parseFloat(resultsSingleMetricBayes.power.toFixed(4))).toEqual(
      parseFloat(powerTrue.toFixed(4))
    );
  }
});

it("calculateMidExperimentPowerSeq", () => {
  const numVariations = 3;
  const numGoalMetrics = 1;
  const firstPeriodPairwiseSampleSize = 7016;
  const targetMDE = 0.05;
  const sigmahat2Delta = 0.0004932909556005973;
  const deltaPosterior = 0.0006910992396780842;
  const sigma2Posterior = 0.0004932909556005973;
  const scalingFactorSeq = 4.25390625;
  const pValueCorrected = true;
  const params: MidExperimentPowerParamsSingleSeq = {
    alpha: 0.05,
    pValueCorrected: pValueCorrected,
    sequentialTuningParameter: 5000,
    numGoalMetrics: numGoalMetrics,
    numVariations: numVariations,
    sigmahat2Delta: sigmahat2Delta,
    deltaPosterior: deltaPosterior,
    sigma2Posterior: sigma2Posterior,
    firstPeriodPairwiseSampleSize: firstPeriodPairwiseSampleSize,
    targetMDE: targetMDE,
    scalingFactor: scalingFactorSeq,
  };
  const totalPower = calculateMidExperimentPowerSeq(params);
  const powerTrue = 0.7993904752120736;
  if (totalPower === undefined) {
    throw new Error("seq power is undefined.");
  } else {
    expect(parseFloat(totalPower.toFixed(5))).toEqual(
      parseFloat(powerTrue.toFixed(5))
    );
  }
});

it("midExperimentPower for sequential case", () => {
  const numVariations = 3;
  const numGoalMetrics = 1;
  const firstPeriodPairwiseSampleSize = 7016;
  const targetMDE = 0.05;
  const sigmahat2Delta = 0.0004932909556005973;
  const deltaPosterior = 0.0006910992396780842;
  const sigma2Posterior = 0.0004932909556005973;
  const scalingFactorSeq = 4.25390625;
  const pValueCorrected = true;

  const gbstatsResponseSeq: MetricPowerResponseFromStatsEngine = {
    status: "successful",
    errorMessage: "",
    firstPeriodPairwiseSampleSize: firstPeriodPairwiseSampleSize,
    targetMDE: targetMDE,
    sigmahat2Delta: sigmahat2Delta,
    deltaPosterior: deltaPosterior,
    sigma2Posterior: sigma2Posterior,
    priorProper: false,
    upperBoundAchieved: false,
    scalingFactor: scalingFactorSeq,
  };
  const powerParamsSeq: MidExperimentPowerParamsSingle = {
    alpha: 0.05,
    pValueCorrected: pValueCorrected,
    sequential: true,
    sequentialTuningParameter: 5000,
    daysRemaining: 1,
    firstPeriodSampleSize: firstPeriodPairwiseSampleSize,
    newDailyUsers: firstPeriodPairwiseSampleSize * scalingFactorSeq,
    numGoalMetrics: numGoalMetrics,
    numVariations: numVariations,
    variation: gbstatsResponseSeq,
  };

  const metricId = "click_through_rate";
  const variation = 1;
  const resultsSingleMetricSeq = calculateMidExperimentPowerSingle(
    powerParamsSeq,
    metricId,
    variation
  );
  const powerTrue = 0.7993904752120736;
  if (resultsSingleMetricSeq.power === undefined) {
    throw new Error("seq power is undefined.");
  } else {
    expect(parseFloat(resultsSingleMetricSeq.power.toFixed(5))).toEqual(
      parseFloat(powerTrue.toFixed(5))
    );
  }
});
