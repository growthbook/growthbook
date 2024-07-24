import normal from "@stdlib/stats/base/dists/normal";

import {
  PowerCalculationParams,
  PowerCalculationResults,
  MDEResults,
  SampleSizeAndRuntime,
  Week,
  MetricParams,
} from "./types";

/**
 * delta method for relative difference
 *
 * @param varA Scalar control distribution variance.
 * @param meanA Scalar control mean.
 * @param nA Control sample size.
 * @param varB Scalar treatment distribution variance.
 * @param meanB Scalar treatment distribution mean.
 * @param nB Treatment sample size.
 * @param relative boolean indicator for relative effects.
 * @returns variance.
 */
export function frequentistVariance(
  varA: number,
  meanA: number,
  nA: number,
  varB: number,
  meanB: number,
  nB: number,
  relative: boolean
): number {
  if (relative) {
    return (
      varB / (Math.pow(meanA, 2) * nB) +
      (varA * Math.pow(meanB, 2)) / (Math.pow(meanA, 4) * nA)
    );
  } else {
    return varB / nB + varA / nA;
  }
}

function getMetricMean(metric: MetricParams): number {
  return metric.type === "mean" ? metric.mean : metric.conversionRate;
}

type PriorParams = {
  proper: boolean;
  priorLiftMean: number;
  priorLiftStandardDeviation: number;
};

function getMetricPriorParams(params: MetricParams): PriorParams {
  if (params.overrideMetricLevelSettings)
    return {
      proper: params.overrideProper,
      priorLiftMean: params.overridePriorLiftMean,
      priorLiftStandardDeviation: params.overridePriorLiftStandardDeviation,
    };

  return {
    proper: params.metricProper,
    priorLiftMean: params.metricPriorLiftMean,
    priorLiftStandardDeviation: params.metricPriorLiftStandardDeviation,
  };
}

function getMetricVariance(metric: MetricParams): number {
  return metric.type === "mean"
    ? Math.pow(metric.standardDeviation, 2)
    : metric.conversionRate * (1 - metric.conversionRate);
}

export function powerStandardError(
  metric: MetricParams,
  nPerVariation: number,
  relative: boolean
): number {
  const metricMean = getMetricMean(metric);
  const metricVariance = getMetricVariance(metric);
  return Math.sqrt(
    frequentistVariance(
      metricVariance,
      metricMean,
      nPerVariation,
      metricVariance,
      metricMean * (1 + metric.effectSize),
      nPerVariation,
      relative
    )
  );
}

export function calculateRho(
  alpha: number,
  sequentialTuningParameter: number
): number {
  return Math.sqrt(
    (-2 * Math.log(alpha) + Math.log(-2 * Math.log(alpha) + 1)) /
      sequentialTuningParameter
  );
}

export function sequentialPowerSequentialVariance(
  variance: number,
  n: number,
  alpha: number,
  sequentialTuningParameter: number
): number {
  const standardErrorSampleMean = Math.sqrt(variance / n);
  const rho = calculateRho(alpha, sequentialTuningParameter);
  const partUnderRadical =
    (2 *
      (n * Math.pow(rho, 2) + 1) *
      Math.log(Math.sqrt(n * Math.pow(rho, 2) + 1) / alpha)) /
    Math.pow(n * rho, 2);
  const zSequential = Math.sqrt(n) * Math.sqrt(partUnderRadical);
  const zStar = normal.quantile(1.0 - 0.5 * alpha, 0, 1);
  const standardErrorSequential =
    (standardErrorSampleMean * zSequential) / zStar;
  const vSequential = Math.pow(standardErrorSequential, 2);
  return n * vSequential;
}

export function sequentialPowerStandardError(
  metric: MetricParams,
  n: number,
  nVariations: number,
  alpha: number,
  sequentialTuningParameter: number,
  relative: boolean
): number {
  const metricMean = getMetricMean(metric);
  const metricVariance = getMetricVariance(metric);
  const v_rel = frequentistVariance(
    metricVariance,
    metricMean,
    n / nVariations,
    metricVariance,
    metricMean * (1.0 + metric.effectSize),
    n / nVariations,
    relative
  );
  return Math.sqrt(
    sequentialPowerSequentialVariance(
      v_rel,
      (2 * n) / nVariations,
      alpha,
      sequentialTuningParameter
    )
  );
}

function getSequentialTuningParameter(
  sequentialTesting: false | number
): number {
  let sequentialTuningParameter = 0.0;
  if (sequentialTesting !== false) {
    sequentialTuningParameter = sequentialTesting;
  }
  return sequentialTuningParameter;
}

/**
 * Performs power calculation
 *
 * @param effectSize Scalar lift (relative to the scalar mean of the distribution, expressed as percentage).
 * @param mean Scalar mean of the distribution.
 * @param variance Scalar variance of the distribution.
 * @param n Scalar sample size.
 * @param nVariations Scalar number of variations.
 * @param alpha false positive rate (default: 0.05).
 * @param twoTailed Binary indicator if the test is 1 or 2-tailed (default: true).
 * @returns Estimated power.
 */
export function powerEstFrequentist(
  metric: MetricParams,
  n: number,
  nVariations: number,
  alpha: number = 0.05,
  twoTailed: boolean = true,
  sequentialTesting: false | number
): number {
  const zStar = twoTailed
    ? normal.quantile(1.0 - 0.5 * alpha, 0, 1)
    : normal.quantile(1.0 - alpha, 0, 1);

  let standardError = 0;
  const sequentialTuningParameter = getSequentialTuningParameter(
    sequentialTesting
  );
  if (sequentialTuningParameter > 0) {
    standardError = sequentialPowerStandardError(
      metric,
      n,
      nVariations,
      alpha,
      sequentialTuningParameter,
      true
    );
  } else {
    standardError = powerStandardError(metric, n / nVariations, true);
  }
  const standardizedEffectSize = metric.effectSize / standardError;
  const upperCutpoint = zStar - standardizedEffectSize;
  let power = 1 - normal.cdf(upperCutpoint, 0, 1);
  if (twoTailed) {
    const lowerCutpoint = -zStar - standardizedEffectSize;
    power += normal.cdf(lowerCutpoint, 0, 1);
  }
  return power;
}

/**
 * Calculates minimum detectable effect
 *
 * @param power desired power.
 * @param mean Scalar mean of the distribution.
 * @param variance Scalar variance of the distribution.
 * @param n Scalar sample size.
 * @param nVariations Scalar number of variations.
 * @param alpha false positive rate (default: 0.05).
 * @returns object of class MDEResults, containing type and either mde or description.
 */
export function findMdeFrequentist(
  metric: MetricParams,
  power: number,
  n: number,
  nVariations: number,
  alpha: number = 0.05,
  sequentialTesting: false | number
): MDEResults {
  // Error handling:
  if (power <= alpha) {
    const mdeResults: MDEResults = {
      type: "error",
      description: "power must be greater than alpha.",
    };
    return mdeResults;
  }
  const nA = n / nVariations;
  const z =
    normal.quantile(1.0 - 0.5 * alpha, 0, 1) -
    normal.quantile(1.0 - power, 0, 1);
  const m = getMetricMean(metric);
  let v = getMetricVariance(metric);
  const sequentialTuningParameter = getSequentialTuningParameter(
    sequentialTesting
  );
  if (sequentialTuningParameter > 0) {
    v = sequentialPowerSequentialVariance(
      getMetricVariance(metric),
      2 * nA,
      alpha,
      sequentialTuningParameter
    );
  }
  //ensure the term under the radical is non-negative and that a positive solution exists.
  if (nA <= (v * z ** 2) / m ** 2) {
    const mdeResults: MDEResults = {
      type: "error",
      description:
        "need to increase number of users or reduce number of variations.",
    };
    return mdeResults;
  }
  const sigma2 = v / nA;
  const a_star = 1 - (z ** 2 * sigma2) / m ** 2;
  const b_star = -2 * m;
  const c_star = m ** 2 - z ** 2 * sigma2;
  const disc = b_star ** 2 - 4 * a_star * c_star;
  const sol_1 = (-b_star + Math.sqrt(disc)) / (2 * a_star);
  //const sol_2 = (-b_star - Math.sqrt(disc)) / (2 * a_star);
  const mdeResults: MDEResults = {
    type: "success",
    mde: (sol_1 - m) / m,
  };
  return mdeResults;
}

export function powerMetricWeeks(
  powerSettings: PowerCalculationParams
): PowerCalculationResults {
  const sampleSizeAndRuntimeNumeric: number[] = []; //for each metric, the first week they achieve 80% power.
  const mySampleSizeAndRuntime: {
    [id: string]: SampleSizeAndRuntime | undefined;
  } = {};

  const metricThresholds = {};
  const weeks: Week[] = [...Array(powerSettings.nWeeks).keys()].map((idx) => ({
    users: (idx + 1) * powerSettings.usersPerWeek,
    metrics: {},
  }));

  Object.entries(powerSettings.metrics).forEach(([metricKey, thisMetric]) => {
    let thisMDENumeric = NaN;
    let thisSampleSizeAndRuntimeNumeric = 999;
    let lookingForSampleSizeAndRunTime = true;
    for (let j = 0; j < powerSettings.nWeeks; j++) {
      const n = powerSettings.usersPerWeek * (j + 1);
      /*initialize block-scoped variables*/
      let thisPower = 0.0;
      let thisMde: MDEResults = {
        type: "success",
        mde: -999,
      };
      if (powerSettings.statsEngineSettings.type === "frequentist") {
        thisPower = powerEstFrequentist(
          thisMetric,
          n,
          powerSettings.nVariations,
          powerSettings.alpha,
          true,
          powerSettings.statsEngineSettings.sequentialTesting
        );
        thisMde = findMdeFrequentist(
          thisMetric,
          0.8,
          n,
          powerSettings.nVariations,
          powerSettings.alpha,
          powerSettings.statsEngineSettings.sequentialTesting
        );
      } else {
        thisPower = powerEstBayesian(
          thisMetric,
          powerSettings.alpha,
          n / powerSettings.nVariations,
          true
        );
        thisMde = findMdeBayesian(
          thisMetric,
          powerSettings.alpha,
          0.8,
          n / powerSettings.nVariations,
          true
        );
      }
      if (
        Math.round(thisPower * 100) / 100 >= 0.8 &&
        lookingForSampleSizeAndRunTime
      ) {
        lookingForSampleSizeAndRunTime = false;
        thisSampleSizeAndRuntimeNumeric = j + 1;
      }
      if (thisMde.type === "success") {
        thisMDENumeric = thisMde.mde;
      }
      if (
        powerSettings.targetPower < thisPower &&
        metricThresholds[metricKey] === undefined
      )
        metricThresholds[metricKey] = j;
      weeks[j].metrics[metricKey] = {
        effectSize: thisMDENumeric,
        power: thisPower,
        isThreshold: metricThresholds[metricKey] === j,
      };
    }
    sampleSizeAndRuntimeNumeric.push(thisSampleSizeAndRuntimeNumeric);
    const thisSampleSizeAndRuntime =
      thisSampleSizeAndRuntimeNumeric !== 999
        ? {
            weeks: thisSampleSizeAndRuntimeNumeric,
            users: powerSettings.usersPerWeek * thisSampleSizeAndRuntimeNumeric,
          }
        : undefined;
    mySampleSizeAndRuntime[metricKey] = thisSampleSizeAndRuntime;
  });
  const duration = Math.max(...sampleSizeAndRuntimeNumeric);

  const results: PowerCalculationResults = {
    sampleSizeAndRuntime: mySampleSizeAndRuntime,
    type: "success",
    weeks,
    ...(duration !== 999 ? { weekThreshold: duration } : {}),
  };
  return results;
}

/*******************/
export function calculatePriorMean(
  priorMeanRel: number,
  mean: number,
  relative: boolean
): number {
  return relative ? priorMeanRel : priorMeanRel * Math.abs(mean);
}

export function calculatePriorVariance(
  priorVarianceRel: number,
  mean: number,
  relative: boolean
): number {
  return relative ? priorVarianceRel : priorVarianceRel * Math.pow(mean, 2);
}

function calculatePriorMeanSpecified(
  metric: MetricParams,
  relative: boolean
): number {
  const metricMean = getMetricMean(metric);
  return calculatePriorMean(
    getMetricPriorParams(metric).priorLiftMean,
    metricMean,
    relative
  );
}

function calculatePriorVarianceSpecified(
  metric: MetricParams,
  relative: boolean
): number {
  const metricMean = getMetricMean(metric);
  return calculatePriorVariance(
    Math.pow(getMetricPriorParams(metric).priorLiftStandardDeviation, 2),
    metricMean,
    relative
  );
}

function calculatePriorMeanDGP(
  metric: MetricParams,
  relative: boolean
): number {
  const metricMean = getMetricMean(metric);
  return calculatePriorMean(metric.effectSize, metricMean, relative);
}

function calculatePriorVarianceDGP(
  metric: MetricParams,
  relative: boolean
): number {
  const metricMean = getMetricMean(metric);
  /*priorStandardDeviationDGP is 0 because we assume true fixed effect size*/
  const priorStandardDeviationDGP = 0;
  return calculatePriorVariance(
    Math.pow(priorStandardDeviationDGP, 2),
    metricMean,
    relative
  );
}

// Function to estimate variance of tau hat conditional on tau
function estimateTauHatVariance(
  metric: MetricParams,
  nPerVariation: number,
  relative: boolean
): number {
  const s = powerStandardError(metric, nPerVariation, relative);
  return Math.pow(s, 2);
}

// Function to calculate marginal variance of tau hat
function getMarginalVarianceTauHat(
  metric: MetricParams,
  nPerVariation: number,
  relative: boolean
): number {
  const priorVarianceDGP = calculatePriorVarianceDGP(metric, relative);
  const tauHatVariance = estimateTauHatVariance(
    metric,
    nPerVariation,
    relative
  );
  return tauHatVariance + priorVarianceDGP;
}

// Function to calculate posterior precision
function getPosteriorPrecision(
  metric: MetricParams,
  nPerVariation: number,
  relative: boolean
): number {
  const priorVarianceSpecified = calculatePriorVarianceSpecified(
    metric,
    relative
  );
  const tauHatVariance = estimateTauHatVariance(
    metric,
    nPerVariation,
    relative
  );
  const properInt = getMetricPriorParams(metric).proper ? 1 : 0;
  return 1 / tauHatVariance + properInt / priorVarianceSpecified;
}

export function getCutpoint(
  metric: MetricParams,
  alpha: number,
  nPerVariation: number,
  relative: boolean,
  upper: boolean
): number {
  const priorMeanSpecified = calculatePriorMeanSpecified(metric, relative);
  const priorVarianceSpecified = calculatePriorVarianceSpecified(
    metric,
    relative
  );
  const priorMeanDGP = calculatePriorMeanDGP(metric, relative);
  const tauHatVariance = estimateTauHatVariance(
    metric,
    nPerVariation,
    relative
  );
  const posteriorPrecision = getPosteriorPrecision(
    metric,
    nPerVariation,
    relative
  );
  const marginalVarianceTauHat = getMarginalVarianceTauHat(
    metric,
    nPerVariation,
    relative
  );
  const zStar = normal.quantile(1.0 - 0.5 * alpha, 0, 1);
  const upperSign = upper ? 1 : -1;
  const properInt = getMetricPriorParams(metric).proper ? 1 : 0;

  const numerator =
    upperSign * tauHatVariance * Math.sqrt(posteriorPrecision) * zStar -
    (properInt * (tauHatVariance * priorMeanSpecified)) /
      priorVarianceSpecified -
    priorMeanDGP;
  const denominator = Math.sqrt(marginalVarianceTauHat);
  return numerator / denominator;
}

/**
 * Performs power calculation
 *
 * @param metric an object of class MetricParams that has info about prior mean and sd, metric mean and sd, and effect size.
 * @param alpha false positive rate (default: 0.05).
 * @param nPerVariation sample size per variation.
 * @param relative boolean indicator if relative inference is desired.
 * @returns Estimated power.
 */
export function powerEstBayesian(
  metric: MetricParams,
  alpha: number,
  nPerVariation: number,
  relative: boolean
): number {
  const upperCutpoint = getCutpoint(
    metric,
    alpha,
    nPerVariation,
    relative,
    true
  );
  const lowerCutpoint = getCutpoint(
    metric,
    alpha,
    nPerVariation,
    relative,
    false
  );
  const powerPos = 1.0 - normal.cdf(upperCutpoint, 0, 1);
  const powerNeg = normal.cdf(lowerCutpoint, 0, 1);
  return powerPos + powerNeg;
}

/**
 * Performs mde calc
 * @param metric an object of class MetricParams that has info about prior mean and sd, metric mean and sd, and effect size.
 * @param alpha false positive rate (default: 0.05).
 * @param nPerVariation sample size per variation.
 * @param relative boolean indicator if relative inference is desired.
 * @param stepSize step size used in initial grid search.
 * @returns object of class MDEResults, containing type and either mde or description.
 */
function sweepGridFine(
  metric: MetricParams,
  alpha: number,
  power: number,
  nPerVariation: number,
  relative: boolean,
  stepSize: number
): MDEResults {
  const effectSize = metric.effectSize;
  const stepSizeFiner = stepSize / 100;
  const lowerBound = effectSize - stepSize;
  for (
    let effectSizeFiner = lowerBound;
    effectSizeFiner < effectSize;
    effectSizeFiner += stepSizeFiner
  ) {
    metric.effectSize = effectSizeFiner;
    const p = powerEstBayesian(metric, alpha, nPerVariation, relative);
    if (p >= power) {
      const mdeResults: MDEResults = {
        type: "success",
        mde: effectSizeFiner,
      };
      return mdeResults;
    }
  }
  const mdeResults: MDEResults = {
    type: "error",
    description: "MDE achieving power = 0.8 does not exist in this range. ",
  };
  return mdeResults;
}

/**
 * Performs mde calc
 * @param metric an object of class MetricParams that has info about prior mean and sd, metric mean and sd, and effect size.
 * @param alpha false positive rate (default: 0.05).
 * @param nPerVariation sample size per variation.
 * @param relative boolean indicator if relative inference is desired.
 * @returns object of class MDEResults, containing type and either mde or description.
 */
export function findMdeBayesian(
  metric: MetricParams,
  alpha: number,
  power: number,
  nPerVariation: number,
  relative: boolean
): MDEResults {
  /*fixed effect size, so prior variance of data generating process is 0*/
  let effectSize = 0;
  const dummyMetric = { ...metric, effectSize: effectSize };
  dummyMetric.effectSize = effectSize;
  let currentPower = powerEstBayesian(
    dummyMetric,
    alpha,
    nPerVariation,
    relative
  );
  /*case where 0 effect size results in at least 80% power*/
  if (currentPower >= power) {
    const mdeResults: MDEResults = {
      type: "success",
      mde: effectSize,
    };
    return mdeResults;
  }
  const stepSizeCoarse = 1e-3;
  const maxError = normal.pdf(0, 0, 1) * stepSizeCoarse;
  /*using integer of 5000 for stability in loop;
  combined with stepsize of 1e-3, max effectSize is 500%*/
  const numIters = 5000;
  for (let i = 0; i < numIters; i++) {
    effectSize = stepSizeCoarse * i;
    dummyMetric.effectSize = effectSize;
    currentPower = powerEstBayesian(
      dummyMetric,
      alpha,
      nPerVariation,
      relative
    );
    if (currentPower >= power - maxError) {
      const currentPowerFine = sweepGridFine(
        dummyMetric,
        alpha,
        power,
        nPerVariation,
        relative,
        stepSizeCoarse
      );
      if (currentPowerFine.type === "success") {
        return currentPowerFine;
      }
    }
  }
  /*case where mde is greater than 500% or doesn't exist*/
  const mdeResults: MDEResults = {
    type: "error",
    description: "MDE achieving power = 0.8 does not exist. ",
  };
  return mdeResults;
}
