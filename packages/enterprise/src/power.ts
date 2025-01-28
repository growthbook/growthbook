import normal from "@stdlib/stats/base/dists/normal";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotTraffic,
  SnapshotSettingsVariation,
} from "back-end/types/experiment-snapshot";
import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
} from "shared/constants";
import { MetricPowerResponseFromStatsEngine } from "back-end/types/stats";
import { sequentialDiscriminant, sequentialRho } from "shared/power";
import { eachDayOfInterval, formatISO, subDays } from "date-fns";

export interface MidExperimentPowerParams {
  alpha: number;
  sequential: boolean;
  sequentialTuningParameter: number;
  daysRemaining: number;
  firstPeriodSampleSize: number;
  newDailyUsers: number;
  numGoalMetrics: number;
  variationWeights: number[];
  variations: MidExperimentSingleVariationParams[];
}

export interface MidExperimentSingleVariationParams {
  // For a single variation, we need to know the power for each metric.
  metrics: {
    [metricId: string]: MetricPowerResponseFromStatsEngine | undefined;
  };
}

export interface MidExperimentPowerParamsSingle {
  sequential: boolean;
  alpha: number;
  sequentialTuningParameter: number;
  daysRemaining: number;
  firstPeriodSampleSize: number;
  newDailyUsers: number;
  numGoalMetrics: number;
  numVariations: number;
  variation?: MetricPowerResponseFromStatsEngine;
}

export type MetricVariationPowerResult = {
  metricId: string;
  variation: number;
  errorMessage?: string;
  power?: number;
  isLowPowered?: boolean;
  effectSize?: number;
  additionalDaysNeeded?: number;
};

export type MidExperimentPowerCalculationFailureResult = {
  type: "error";
  isLowPowered: boolean;
  metricVariationPowerResults: MetricVariationPowerResult[];
};

export type MidExperimentPowerCalculationSuccessResult = {
  type: "success";
  power: number;
  isLowPowered: boolean;
  additionalDaysNeeded: number;
  metricVariationPowerResults: MetricVariationPowerResult[];
};

export type MidExperimentPowerCalculationResult =
  | MidExperimentPowerCalculationSuccessResult
  | MidExperimentPowerCalculationFailureResult;

function finalPosteriorVariance(
  sigma2Posterior: number,
  sigmahat2Delta: number,
  scalingFactor: number
): number {
  const precPrior = 1 / sigma2Posterior;
  const precData = 1 / (sigmahat2Delta / scalingFactor);
  const prec = precPrior + precData;
  return 1 / prec;
}

/**
 * Calculates the halfwidth of a sequential confidence interval.
 *
 * @param s2 The "variance" of the data.  Not really the variance, as it is the sample size times the variance of the effect estimate.
 * @param n The total sample size.
 * @param sequentialTuningParameter The tuning parameter for the sequential test.
 * @param alpha The significance level.
 * @returns The halfwidth of the sequential interval.
 */
function sequentialIntervalHalfwidth(
  s2: number,
  n: number,
  sequentialTuningParameter: number,
  alpha: number
): number {
  const rho = sequentialRho(alpha, sequentialTuningParameter);
  const disc = sequentialDiscriminant(n, rho, alpha);
  return Math.sqrt(s2) * Math.sqrt(disc);
}

function calculateMidExperimentPowerSingleError(
  metricId: string,
  variation: number,
  errorMessage: string
): MetricVariationPowerResult {
  return {
    metricId: metricId,
    variation: variation,
    errorMessage: errorMessage,
  };
}

/**
 * Calculates mid-experiment power for a single metric and variation combination.
 *
 * @param params The parameters needed for power calculation
 * @param metricId The ID of the metric
 * @param variation The variation index
 * @returns Power calculation result for this metric/variation pair
 */
export function calculateMidExperimentPowerSingle(
  params: MidExperimentPowerParamsSingle,
  metricId: string,
  variation: number
): MetricVariationPowerResult {
  if (params.variation === undefined) {
    return calculateMidExperimentPowerSingleError(
      metricId,
      variation,
      "Missing variation."
    );
  }
  const response = params.variation;
  if (response?.errorMessage) {
    return calculateMidExperimentPowerSingleError(
      metricId,
      variation,
      response.errorMessage
    );
  }
  if (response.sigmahat2Delta === undefined) {
    return calculateMidExperimentPowerSingleError(
      metricId,
      variation,
      "Missing sigmahat2Delta."
    );
  }
  if (response.sigma2Posterior === undefined) {
    return calculateMidExperimentPowerSingleError(
      metricId,
      variation,
      "Missing sigma2Posterior."
    );
  }
  if (response.deltaPosterior === undefined) {
    return calculateMidExperimentPowerSingleError(
      metricId,
      variation,
      "Missing deltaPosterior."
    );
  }
  if (response.firstPeriodPairwiseSampleSize === undefined) {
    return calculateMidExperimentPowerSingleError(
      metricId,
      variation,
      "Missing firstPeriodPairwiseSampleSize."
    );
  }
  const lowPowerThreshold = 0.1;
  const numTests = (params.numVariations - 1) * params.numGoalMetrics;
  const firstPeriodPairwiseSampleSize = response.firstPeriodPairwiseSampleSize;
  const secondPeriodSampleSize = params.daysRemaining * params.newDailyUsers;
  const scalingFactor = secondPeriodSampleSize / params.firstPeriodSampleSize;
  let halfwidth: number;

  const sigmahat2Delta = response.sigmahat2Delta;
  const sigma2Posterior = response.sigma2Posterior;
  const deltaPosterior = response.deltaPosterior;
  const mPrime = 2 * response.minPercentChange;
  const vPrime = sigmahat2Delta;
  if (params.sequential) {
    const s2 = sigmahat2Delta * firstPeriodPairwiseSampleSize;
    const nTotal = firstPeriodPairwiseSampleSize * (scalingFactor + 1);
    halfwidth = sequentialIntervalHalfwidth(
      s2,
      nTotal,
      params.sequentialTuningParameter,
      params.alpha / numTests
    );
  } else {
    const zStar = normal.quantile(1.0 - (0.5 * params.alpha) / numTests, 0, 1);
    const v = finalPosteriorVariance(
      sigma2Posterior,
      sigmahat2Delta,
      scalingFactor
    );
    const s = Math.sqrt(v);
    halfwidth = zStar * s;
  }
  const marginalVar = sigma2Posterior + sigmahat2Delta / scalingFactor;
  const num1 = (halfwidth * marginalVar) / sigma2Posterior;
  const num2 =
    ((sigmahat2Delta / scalingFactor) * deltaPosterior) / sigma2Posterior;
  const num3 = mPrime;
  const den = Math.sqrt(vPrime);
  const numPos = num1 - num2 - num3;
  const numNeg = -num1 - num2 - num3;
  const powerPos = 1 - normal.cdf(numPos / den, 0, 1);
  const powerNeg = normal.cdf(numNeg / den, 0, 1);
  const totalPower = powerPos + powerNeg;
  const additionalUsers = Math.ceil(
    scalingFactor * params.firstPeriodSampleSize
  );
  const powerResults: MetricVariationPowerResult = {
    metricId: metricId,
    variation: variation,
    effectSize: mPrime,
    power: totalPower,
    additionalDaysNeeded: Math.ceil(additionalUsers / params.newDailyUsers),
    isLowPowered: totalPower < lowPowerThreshold,
  };
  return powerResults;
}

export function calculateMidExperimentPower(
  powerSettings: MidExperimentPowerParams
): MidExperimentPowerCalculationResult {
  const sequentialTuningParameter = powerSettings.sequentialTuningParameter;
  const sequential = powerSettings.sequential;
  const alpha = powerSettings.alpha;
  const daysRemaining = powerSettings.daysRemaining;
  const firstPeriodSampleSize = powerSettings.firstPeriodSampleSize;
  const newDailyUsers = powerSettings.newDailyUsers;
  const numGoalMetrics = powerSettings.numGoalMetrics;
  const variationWeights = powerSettings.variationWeights;
  const variations = powerSettings.variations;
  const numVariations = variations.length;
  const minPowerByVariation = new Array(numVariations).fill(1);
  const maxDaysByVariation = new Array(numVariations).fill(0);
  const lowPowerThreshold = 0.1;
  const metricVariationPowerArray: MetricVariationPowerResult[] = [];
  let calculateAdditionalDays = true;

  for (let variation = 1; variation < numVariations; variation++) {
    const thisProportionOfUsers =
      variationWeights[0] + variationWeights[variation];
    const thisNewDailyUsers = newDailyUsers * thisProportionOfUsers;
    const thisVariation = variations[variation];
    let minPowerWithinVariation = 1.0;
    let maxDaysWithinVariation = 0;
    for (const [metricId, variationMetricData] of Object.entries(
      thisVariation.metrics
    )) {
      if (variationMetricData === undefined) {
        calculateAdditionalDays = false;
      } else if (variationMetricData.status === "unsuccessful") {
        calculateAdditionalDays = false;
        metricVariationPowerArray.push({
          metricId: metricId,
          variation: variation,
          power: undefined,
          effectSize: variationMetricData.minPercentChange * 2,
          errorMessage: variationMetricData.errorMessage,
        });
      } else if (variationMetricData.status === "already significant") {
        metricVariationPowerArray.push({
          metricId: metricId,
          variation: variation,
          effectSize: variationMetricData.minPercentChange * 2,
          power: 1,
          additionalDaysNeeded: 0,
          isLowPowered: false,
        });
      } else {
        const powerParams: MidExperimentPowerParamsSingle = {
          sequential,
          alpha,
          sequentialTuningParameter,
          daysRemaining: daysRemaining,
          firstPeriodSampleSize: firstPeriodSampleSize,
          newDailyUsers: thisNewDailyUsers,
          numGoalMetrics,
          numVariations,
          variation: variationMetricData,
        };
        const resultsSingleMetric = calculateMidExperimentPowerSingle(
          powerParams,
          metricId,
          variation
        );
        metricVariationPowerArray.push(resultsSingleMetric);
        if (
          !resultsSingleMetric.errorMessage &&
          resultsSingleMetric.power !== undefined &&
          resultsSingleMetric.additionalDaysNeeded !== undefined
        ) {
          const thisPower = resultsSingleMetric.power;
          const theseAdditionalDays = resultsSingleMetric.additionalDaysNeeded;
          if (thisPower < minPowerWithinVariation) {
            minPowerWithinVariation = thisPower;
          }
          if (theseAdditionalDays > maxDaysWithinVariation) {
            maxDaysWithinVariation = resultsSingleMetric.additionalDaysNeeded;
          }
        } else {
          calculateAdditionalDays = false;
        }
      }
    }
    minPowerByVariation[variation] = minPowerWithinVariation;
    maxDaysByVariation[variation] = maxDaysWithinVariation;
  }
  const maxPower = Math.max(...minPowerByVariation.slice(1));
  const lowPowerWarning = maxPower < lowPowerThreshold;
  if (calculateAdditionalDays) {
    return {
      type: "success",
      power: maxPower,
      additionalDaysNeeded: Math.min(...maxDaysByVariation),
      isLowPowered: lowPowerWarning,
      metricVariationPowerResults: metricVariationPowerArray,
    };
  } else {
    return {
      type: "error",
      isLowPowered: lowPowerWarning,
      metricVariationPowerResults: metricVariationPowerArray,
    };
  }
}

export function getAverageExposureOverLastNDays(
  traffic: ExperimentSnapshotTraffic,
  nDays: number,
  baseDate = new Date()
) {
  const lastNDates = eachDayOfInterval({
    start: subDays(baseDate, nDays),
    end: subDays(baseDate, 1),
  }).map((date) => formatISO(date, { representation: "date" }));

  const totalExposure = traffic.dimension?.dim_exposure_date
    .filter((dim) => lastNDates.includes(dim.name))
    .map((dim) => dim.variationUnits.reduce((acc, num) => acc + num, 0))
    .reduce((acc, num) => acc + num, 0);

  return Math.floor(totalExposure / nDays);
}

// NB: Should only be called if the experiment has been running
// for > settings.experimentMinLengthDays and < settings.experimentMaxLengthDays
export function analyzeExperimentPower({
  trafficHealth,
  targetDaysRemaining,
  analysis,
  goalMetrics,
  variationsSettings,
}: {
  trafficHealth: ExperimentSnapshotTraffic;
  targetDaysRemaining: number;
  analysis: ExperimentSnapshotAnalysis;
  goalMetrics: string[];
  variationsSettings: SnapshotSettingsVariation[];
}): MidExperimentPowerCalculationResult | undefined {
  const analysisVariations = analysis.results[0].variations;
  const variationsPowerResponses = analysisVariations.map((variation) => ({
    metrics: Object.fromEntries(
      goalMetrics.map((metricId) => [
        metricId,
        variation.metrics[metricId]?.power,
      ])
    ),
  }));

  const daysToAverageOver = 7;
  const newDailyUsers = getAverageExposureOverLastNDays(
    trafficHealth,
    daysToAverageOver
  );

  const firstPeriodSampleSize = trafficHealth.overall.variationUnits.reduce(
    (acc, it) => acc + it,
    0
  );

  return calculateMidExperimentPower({
    sequentialTuningParameter:
      analysis.settings.sequentialTestingTuningParameter ??
      DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
    sequential: analysis.settings.sequentialTesting ?? false,
    alpha: analysis.settings.pValueThreshold ?? DEFAULT_P_VALUE_THRESHOLD,
    daysRemaining: targetDaysRemaining,
    firstPeriodSampleSize: firstPeriodSampleSize,
    newDailyUsers: newDailyUsers,
    numGoalMetrics: goalMetrics.length,
    variationWeights: variationsSettings.map((it) => it.weight),
    variations: variationsPowerResponses,
  });
}
