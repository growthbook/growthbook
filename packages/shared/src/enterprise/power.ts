import { z } from "zod";
import normal from "@stdlib/stats/base/dists/normal/lib/index.js";
import { eachDayOfInterval, formatISO, subDays } from "date-fns";
import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
} from "shared/constants";
import { sequentialDiscriminant, sequentialRho } from "shared/power";
import { MetricPowerResponseFromStatsEngine } from "shared/types/stats";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotTraffic,
  SnapshotSettingsVariation,
} from "shared/types/experiment-snapshot";

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
  alpha: number;
  sequential: boolean;
  sequentialTuningParameter: number;
  daysRemaining: number;
  firstPeriodSampleSize: number;
  newDailyUsers: number;
  numGoalMetrics: number;
  numVariations: number;
  variation?: MetricPowerResponseFromStatsEngine;
}

export const MetricVariationPowerResultValidator = z.object({
  metricId: z.string(),
  variation: z.number(),
  errorMessage: z.string().optional(),
  power: z.number().optional(),
  isLowPowered: z.boolean().optional(),
  effectSize: z.number().optional(),
  additionalDaysNeeded: z.number().optional(),
});
export type MetricVariationPowerResult = z.infer<
  typeof MetricVariationPowerResultValidator
>;

export const MidExperimentPowerCalculationFailureValidator = z.object({
  type: z.literal("error"),
  isLowPowered: z.boolean(),
  metricVariationPowerResults: z.array(MetricVariationPowerResultValidator),
});
export type MidExperimentPowerCalculationFailureResult = z.infer<
  typeof MidExperimentPowerCalculationFailureValidator
>;

export const MidExperimentPowerCalculationSuccessValidator = z.object({
  type: z.literal("success"),
  power: z.number(),
  isLowPowered: z.boolean(),
  additionalDaysNeeded: z.number(),
  metricVariationPowerResults: z.array(MetricVariationPowerResultValidator),
});
export type MidExperimentPowerCalculationSuccessResult = z.infer<
  typeof MidExperimentPowerCalculationSuccessValidator
>;

export const MidExperimentPowerCalculationResultValidator = z.union([
  MidExperimentPowerCalculationSuccessValidator,
  MidExperimentPowerCalculationFailureValidator,
]);
export type MidExperimentPowerCalculationResult = z.infer<
  typeof MidExperimentPowerCalculationResultValidator
>;

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
  alpha: number,
): number {
  const rho = sequentialRho(alpha, sequentialTuningParameter);
  const disc = sequentialDiscriminant(n, rho, alpha);
  return Math.sqrt(s2) * Math.sqrt(disc);
}

function calculateMidExperimentPowerSingleError(
  metricId: string,
  variation: number,
  errorMessage: string,
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
  variation: number,
): MetricVariationPowerResult {
  if (params.variation === undefined) {
    return calculateMidExperimentPowerSingleError(
      metricId,
      variation,
      "Missing variation.",
    );
  }
  const response = params.variation;
  if (response?.errorMessage) {
    return calculateMidExperimentPowerSingleError(
      metricId,
      variation,
      response.errorMessage,
    );
  }
  if (response.firstPeriodPairwiseSampleSize === undefined) {
    return calculateMidExperimentPowerSingleError(
      metricId,
      variation,
      "Missing firstPeriodPairwiseSampleSize.",
    );
  }
  if (response.targetMDE === undefined) {
    return calculateMidExperimentPowerSingleError(
      metricId,
      variation,
      "Missing targetMDE.",
    );
  }
  if (response.sigmahat2Delta === undefined) {
    return calculateMidExperimentPowerSingleError(
      metricId,
      variation,
      "Missing sigmahat2Delta.",
    );
  }
  if (response.priorProper === undefined) {
    return calculateMidExperimentPowerSingleError(
      metricId,
      variation,
      "Missing priorProper.",
    );
  }
  if (response.priorProper && response.priorLiftMean === undefined) {
    return calculateMidExperimentPowerSingleError(
      metricId,
      variation,
      "Missing priorLiftMean.",
    );
  }
  if (response.priorProper && response.priorLiftVariance === undefined) {
    return calculateMidExperimentPowerSingleError(
      metricId,
      variation,
      "Missing priorLiftVariance.",
    );
  }
  if (response.scalingFactor === undefined) {
    return calculateMidExperimentPowerSingleError(
      metricId,
      variation,
      "Missing scalingFactor.",
    );
  }
  const lowPowerThreshold = 0.1;
  const numTests = (params.numVariations - 1) * params.numGoalMetrics;
  const firstPeriodPairwiseSampleSize = response.firstPeriodPairwiseSampleSize;
  const secondPeriodSampleSize = params.daysRemaining * params.newDailyUsers;
  const scalingFactorLowPowerWarning =
    secondPeriodSampleSize / params.firstPeriodSampleSize;
  const targetMDE = response.targetMDE;
  const sigmahat2Delta = response.sigmahat2Delta;
  /*calculate power to evaluate low power warning*/
  /*additional units projected for the rest of the experiment*/
  const nTPrime = scalingFactorLowPowerWarning * firstPeriodPairwiseSampleSize;
  /*additional units projected for the rest of the experiment*/
  const adjustedVariance =
    (sigmahat2Delta * firstPeriodPairwiseSampleSize) /
    (firstPeriodPairwiseSampleSize + nTPrime);
  let totalPower: number;
  if (
    response.priorProper &&
    response.priorLiftMean &&
    response.priorLiftVariance
  ) {
    /*bayesian power*/
    totalPower = calculateMidExperimentPowerBayes(
      params.alpha,
      params.numVariations,
      params.numGoalMetrics,
      targetMDE,
      adjustedVariance,
      response.priorLiftMean,
      response.priorLiftVariance,
    );
  } else {
    /*freq power*/
    let halfwidth: number;
    if (params.sequential) {
      const s2 = sigmahat2Delta * firstPeriodPairwiseSampleSize;
      const nTotal =
        firstPeriodPairwiseSampleSize * (scalingFactorLowPowerWarning + 1);
      halfwidth = sequentialIntervalHalfwidth(
        s2,
        nTotal,
        params.sequentialTuningParameter,
        params.alpha / numTests,
      );
    } else {
      halfwidth =
        Math.sqrt(adjustedVariance) *
        normal.quantile(1 - params.alpha / (2 * numTests), 0, 1);
    }
    totalPower = calculateMidExperimentPowerFreq(
      targetMDE,
      halfwidth,
      adjustedVariance,
    );
  }
  /*calculate users needed for additional duration*/
  const additionalUsersNeeded = Math.ceil(
    response.scalingFactor * params.firstPeriodSampleSize,
  );

  // handle some special cases
  if (additionalUsersNeeded === 0) {
    return {
      metricId: metricId,
      variation: variation,
      effectSize: targetMDE,
      power: totalPower,
      additionalDaysNeeded: 0,
      isLowPowered: totalPower < lowPowerThreshold,
    };
  } else if (params.newDailyUsers <= 0) {
    return {
      metricId: metricId,
      variation: variation,
      effectSize: targetMDE,
      power: totalPower,
      additionalDaysNeeded: Infinity,
      isLowPowered: totalPower < lowPowerThreshold,
    };
  }

  return {
    metricId: metricId,
    variation: variation,
    effectSize: targetMDE,
    power: totalPower,
    additionalDaysNeeded: Math.ceil(
      additionalUsersNeeded / params.newDailyUsers,
    ),
    isLowPowered: totalPower < lowPowerThreshold,
  };
}

function calculateMidExperimentPowerBayes(
  alpha: number,
  numVariations: number,
  numGoalMetrics: number,
  targetMDE: number,
  variance: number,
  priorLiftMean: number,
  priorLiftVariance: number,
): number {
  const multiplier = calculateMultiplier(alpha, numVariations, numGoalMetrics);
  const posterior_precision = 1 / priorLiftVariance + 1 / variance;
  const num1 = variance * Math.sqrt(posterior_precision) * multiplier;
  const num2 = (variance * priorLiftMean) / priorLiftVariance;
  const num3 = targetMDE;
  const den = Math.sqrt(variance);
  const powerPos = 1 - normal.cdf((num1 - num2 - num3) / den, 0, 1);
  const powerNeg = normal.cdf(-(num1 + num2 + num3) / den, 0, 1);
  return powerPos + powerNeg;
}

function calculateMidExperimentPowerFreq(
  targetMDE: number,
  halfwidth: number,
  variance: number,
): number {
  const powerPos =
    1 - normal.cdf((halfwidth - targetMDE) / Math.sqrt(variance), 0, 1);
  const powerNeg = normal.cdf(
    -(halfwidth + targetMDE) / Math.sqrt(variance),
    0,
    1,
  );
  return powerPos + powerNeg;
}

function calculateMultiplier(
  alpha: number,
  numVariations: number,
  numGoalMetrics: number,
): number {
  const numTests = (numVariations - 1) * numGoalMetrics;
  return normal.quantile(1 - alpha / (2 * numTests), 0, 1);
}

export function calculateMidExperimentPower(
  powerSettings: MidExperimentPowerParams,
): MidExperimentPowerCalculationResult {
  const {
    sequentialTuningParameter,
    sequential,
    alpha,
    daysRemaining,
    firstPeriodSampleSize,
    newDailyUsers,
    numGoalMetrics,
    variationWeights,
    variations,
  } = powerSettings;

  const numVariations = variations.length;
  const minPowerByVariation = new Array(numVariations).fill(1);
  const maxDaysByVariation = new Array(numVariations).fill(0);
  const lowPowerThreshold = 0.1;
  const metricVariationPowerArray: MetricVariationPowerResult[] = [];

  let metricVariationCounter = 0;
  let metricVariationFailure = 0;
  for (let variation = 1; variation < numVariations; variation++) {
    const thisProportionOfUsers =
      variationWeights[0] + variationWeights[variation];
    const thisNewDailyUsers = newDailyUsers * thisProportionOfUsers;
    const thisVariation = variations[variation];
    let minPowerWithinVariation = 1.0;
    let maxDaysWithinVariation = 0;
    for (const [metricId, variationMetricData] of Object.entries(
      thisVariation.metrics,
    )) {
      metricVariationCounter += 1;
      if (variationMetricData === undefined) {
        metricVariationFailure += 1;
      } else if (variationMetricData.status === "unsuccessful") {
        metricVariationFailure += 1;
        metricVariationPowerArray.push({
          metricId: metricId,
          variation: variation,
          power: undefined,
          effectSize: variationMetricData.targetMDE,
          errorMessage: variationMetricData.errorMessage,
        });
      } else {
        const powerParams: MidExperimentPowerParamsSingle = {
          sequential: sequential,
          alpha: alpha,
          sequentialTuningParameter: sequentialTuningParameter,
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
          variation,
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
          metricVariationFailure += 1;
        }
      }
    }
    minPowerByVariation[variation] = minPowerWithinVariation;
    maxDaysByVariation[variation] = maxDaysWithinVariation;
  }
  // drop un-used baseline variation and
  // find the best powered variation to use for experiment overall
  const maxPower = Math.max(...minPowerByVariation.slice(1));
  const minDaysNeeded = Math.min(...maxDaysByVariation.slice(1));
  const lowPowerWarning = maxPower < lowPowerThreshold;
  // pass if 80% of tests worked
  if (metricVariationFailure / metricVariationCounter < 0.2) {
    return {
      type: "success",
      power: maxPower,
      additionalDaysNeeded: minDaysNeeded,
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
  baseDate = new Date(),
): number {
  const lastNDates = eachDayOfInterval({
    start: subDays(baseDate, nDays),
    end: subDays(baseDate, 1),
  }).map((date) => formatISO(date, { representation: "date" }));

  const dailyTraffic = traffic.dimension?.["dim_exposure_date"];
  if (dailyTraffic) {
    const totalExposure = dailyTraffic
      .filter((dim) => lastNDates.includes(dim.name))
      .map((dim) => dim.variationUnits.reduce((acc, num) => acc + num, 0))
      .reduce((acc, num) => acc + num, 0);
    return Math.floor(totalExposure / nDays);
  }

  return 0;
}

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
  const analysisVariations = analysis.results?.[0].variations;
  const variationsPowerResponses = analysisVariations.map((variation) => ({
    metrics: Object.fromEntries(
      goalMetrics.map((metricId) => [
        metricId,
        variation.metrics[metricId]?.power,
      ]),
    ),
  }));

  const daysToAverageOver = 7;
  const newDailyUsers = getAverageExposureOverLastNDays(
    trafficHealth,
    daysToAverageOver,
  );

  const firstPeriodSampleSize = trafficHealth.overall.variationUnits.reduce(
    (acc, it) => acc + it,
    0,
  );

  const power = calculateMidExperimentPower({
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

  // Be extra safe and validate it so it doesn't fail when saving to the DB
  // We had this issue with NaN
  const parsedPower =
    MidExperimentPowerCalculationResultValidator.safeParse(power);

  return parsedPower.success ? parsedPower.data : undefined;
}
