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

it("midExperimentPowerFreq", () => {
  const gbstatsResponse: MetricPowerResponseFromStatsEngine = {
    powerError: "",
    powerUpdateMessage: "successful",
    minPercentChange: 0.5,
    firstPeriodPairwiseSampleSize: 200,
    sigmahat2Delta: 1.8660831272105123,
    sigma2Posterior: 1.8660831272105125,
    deltaPosterior: 1.9191363776226797,
    upperBoundAchieved: false,
  };
  const powerParams: MidExperimentPowerParamsSingle = {
    sequential: false,
    alpha: 0.05,
    sequentialTuningParameter: 5000,
    daysRemaining: 10,
    firstPeriodSampleSize: 200,
    newDailyUsers: 20,
    numGoalMetrics: 3,
    numVariations: 2,
    variation: gbstatsResponse,
  };
  const metricId = "click_through_rate";
  const variation = 1;
  const resultsSingleMetric = calculateMidExperimentPowerSingle(
    powerParams,
    metricId,
    variation
  );
  const powerTrue = 0.10589188931752198;
  if (resultsSingleMetric.power === undefined) {
    throw new Error("power is undefined.");
  } else {
    expect(parseFloat(resultsSingleMetric.power.toFixed(5))).toEqual(
      parseFloat(powerTrue.toFixed(5))
    );
  }
});

it("midExperimentPowerSeq", () => {
  const gbstatsResponse: MetricPowerResponseFromStatsEngine = {
    powerError: "",
    powerUpdateMessage: "successful",
    minPercentChange: 0.5,
    firstPeriodPairwiseSampleSize: 2000,
    sigmahat2Delta: 0.1952289663558246,
    sigma2Posterior: 0.1952289663558246,
    deltaPosterior: 0.4090343774487013,
    upperBoundAchieved: false,
  };
  const powerParams: MidExperimentPowerParamsSingle = {
    sequential: true,
    alpha: 0.05,
    sequentialTuningParameter: 5000,
    daysRemaining: 10,
    firstPeriodSampleSize: 200,
    newDailyUsers: 20,
    numGoalMetrics: 3,
    numVariations: 2,
    variation: gbstatsResponse,
  };
  const metricId = "click_through_rate";
  const variation = 1;
  const resultsSingleMetric = calculateMidExperimentPowerSingle(
    powerParams,
    metricId,
    variation
  );
  const powerTrue = 0.05020722743685066;
  if (resultsSingleMetric.power === undefined) {
    throw new Error("power is undefined.");
  } else {
    expect(parseFloat(resultsSingleMetric.power.toFixed(5))).toEqual(
      parseFloat(powerTrue.toFixed(5))
    );
  }
});

it("midExperimentPowerBayesian", () => {
  const gbstatsResponse: MetricPowerResponseFromStatsEngine = {
    powerError: "",
    powerUpdateMessage: "successful",
    minPercentChange: 0.5 * 0.6709561916494536,
    firstPeriodPairwiseSampleSize: 200,
    sigmahat2Delta: 1.8660831272105123,
    sigma2Posterior: 1.150463162112222,
    deltaPosterior: 1.3637993148775518,
    upperBoundAchieved: false,
  };
  const powerParams: MidExperimentPowerParamsSingle = {
    sequential: false,
    alpha: 0.05,
    sequentialTuningParameter: 5000,
    daysRemaining: 10,
    firstPeriodSampleSize: 200,
    newDailyUsers: 20,
    numGoalMetrics: 3,
    numVariations: 2,
    variation: gbstatsResponse,
  };
  const metricId = "click_through_rate";
  const variation = 1;
  const resultsSingleMetric = calculateMidExperimentPowerSingle(
    powerParams,
    metricId,
    variation
  );
  const powerTrue = 0.03870059143882832;
  if (resultsSingleMetric.power === undefined) {
    throw new Error("power is undefined.");
  } else {
    expect(parseFloat(resultsSingleMetric.power.toFixed(5))).toEqual(
      parseFloat(powerTrue.toFixed(5))
    );
  }
});
