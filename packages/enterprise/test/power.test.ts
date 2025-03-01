import { ExperimentSnapshotTraffic } from "back-end/types/experiment-snapshot";
import { MetricPowerResponseFromStatsEngine } from "back-end/types/stats";
import {
  calculateMidExperimentPowerSingle,
  getAverageExposureOverLastNDays,
  MidExperimentPowerParamsSingle,
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
    variation
  );
  const resultsSingleMetricSeq = calculateMidExperimentPowerSingle(
    powerParamsSeq,
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
      parseFloat(powerTrue.toFixed(5))
    );
  }
  if (resultsSingleMetricSeq.power === undefined) {
    throw new Error("seq power is undefined.");
  } else {
    expect(parseFloat(resultsSingleMetricSeq.power.toFixed(4))).toEqual(
      parseFloat(powerTrue.toFixed(5))
    );
  }
  if (resultsSingleMetricBayes.power === undefined) {
    throw new Error("bayes power is undefined.");
  } else {
    expect(parseFloat(resultsSingleMetricBayes.power.toFixed(4))).toEqual(
      parseFloat(powerTrue.toFixed(5))
    );
  }
});
