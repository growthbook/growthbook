import normal from "@stdlib/stats/base/dists/normal";

import {
  PowerCalculationParams,
  PowerCalculationParamsBayesian,
  PowerCalculationResults,
  MDEResults,
  SampleSizeAndRuntime,
  Week,
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

export function powerStandardError(
  variance: number,
  mean: number,
  nPerVariation: number,
  effectSize: number,
  relative: boolean
): number {
  return Math.sqrt(
    frequentistVariance(
      variance,
      mean,
      nPerVariation,
      variance,
      mean * (1 + effectSize),
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
  variance: number,
  mean: number,
  n: number,
  nVariations: number,
  effectSize: number,
  alpha: number,
  sequentialTuningParameter: number,
  relative: boolean
): number {
  const v_rel = frequentistVariance(
    variance,
    mean,
    n / nVariations,
    variance,
    mean * (1.0 + effectSize),
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
export function powerEst(
  effectSize: number,
  mean: number,
  variance: number,
  n: number,
  nVariations: number,
  alpha: number = 0.05,
  twoTailed: boolean = true,
  sequentialTuningParameter = 0
): number {
  const zStar = twoTailed
    ? normal.quantile(1.0 - 0.5 * alpha, 0, 1)
    : normal.quantile(1.0 - alpha, 0, 1);

  let standardError = 0;
  if (sequentialTuningParameter > 0) {
    standardError = sequentialPowerStandardError(
      variance,
      mean,
      n,
      nVariations,
      effectSize,
      alpha,
      sequentialTuningParameter,
      true
    );
  } else {
    standardError = powerStandardError(
      variance,
      mean,
      n / nVariations,
      effectSize,
      true
    );
  }
  const standardizedEffectSize = effectSize / standardError;
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
export function findMde(
  power: number,
  mean: number,
  variance: number,
  n: number,
  nVariations: number,
  alpha: number = 0.05,
  sequentialTuningParameter = 0
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
  let v = variance;
  if (sequentialTuningParameter > 0) {
    v = sequentialPowerSequentialVariance(
      variance,
      2 * nA,
      alpha,
      sequentialTuningParameter
    );
  }
  //ensure the term under the radical is non-negative and that a positive solution exists.
  if (nA <= (v * z ** 2) / mean ** 2) {
    const mdeResults: MDEResults = {
      type: "error",
      description:
        "need to increase number of users or reduce number of variations.",
    };
    return mdeResults;
  }
  const sigma2 = v / nA;
  const a_star = 1 - (z ** 2 * sigma2) / mean ** 2;
  const b_star = -2 * mean;
  const c_star = mean ** 2 - z ** 2 * sigma2;
  const disc = b_star ** 2 - 4 * a_star * c_star;
  const sol_1 = (-b_star + Math.sqrt(disc)) / (2 * a_star);
  //const sol_2 = (-b_star - Math.sqrt(disc)) / (2 * a_star);
  const mdeResults: MDEResults = {
    type: "success",
    mde: (sol_1 - mean) / mean,
  };
  return mdeResults;
}

export function powerMetricWeeks(
  powerSettings: PowerCalculationParams
): PowerCalculationResults {
  const metrics = powerSettings.metrics;
  const sampleSizeAndRuntimeNumeric: number[] = []; //for each metric, the first week they achieve 80% power.
  const nWeeks = powerSettings.nWeeks;
  let sequentialTuningParameter = 0.0;
  if (powerSettings.statsEngine.sequentialTesting !== false) {
    sequentialTuningParameter = powerSettings.statsEngine.sequentialTesting;
  }
  function getNumberOfMetrics(params: PowerCalculationParams): number {
    return Object.keys(params.metrics).length;
  }
  const nMetrics = getNumberOfMetrics(powerSettings);
  const metricKeys = Object.keys(metrics);
  const mySampleSizeAndRuntime: {
    [id: string]: SampleSizeAndRuntime | undefined;
  } = {};

  const metricThresholds = {};
  const weeks: Week[] = [...Array(nWeeks).keys()].map((idx) => ({
    users: (idx + 1) * powerSettings.usersPerWeek,
    metrics: {},
  }));

  for (let i = 0; i < nMetrics; i++) {
    const metricKey = metricKeys[i];
    const thisMetric = metrics[metricKey];
    let thisMean = 0;
    let thisVariance = 1;
    if (thisMetric.type === "binomial") {
      thisMean = thisMetric.conversionRate;
      thisVariance =
        thisMetric.conversionRate * (1 - thisMetric.conversionRate);
    } else {
      thisMean = thisMetric.mean;
      thisVariance = thisMetric.standardDeviation ** 2;
    }
    let thisMDENumeric = NaN;
    let thisSampleSizeAndRuntimeNumeric = 999;
    let lookingForSampleSizeAndRunTime = true;
    for (let j = 0; j < nWeeks; j++) {
      const n = powerSettings.usersPerWeek * (j + 1);
      const thisPower = powerEst(
        thisMetric.effectSize,
        thisMean,
        thisVariance,
        n,
        powerSettings.nVariations,
        powerSettings.alpha,
        true,
        sequentialTuningParameter
      );
      if (thisPower >= 0.8 && lookingForSampleSizeAndRunTime) {
        lookingForSampleSizeAndRunTime = false;
        thisSampleSizeAndRuntimeNumeric = j + 1;
      }
      const thisMde = findMde(
        0.8,
        thisMean,
        thisVariance,
        powerSettings.usersPerWeek * (j + 1),
        powerSettings.nVariations,
        powerSettings.alpha,
        sequentialTuningParameter
      );
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
  }
  function findMax(arr: number[]): number {
    return Math.max(...arr);
  }
  const duration = findMax(sampleSizeAndRuntimeNumeric);

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

// Function to estimate variance of tau hat conditional on tau
function estimateTauHatVariance(
  mean: number,
  effectSize: number,
  variance: number,
  nPerVariation: number,
  relative: boolean
): number {
  const s = powerStandardError(
    variance,
    mean,
    nPerVariation,
    effectSize,
    relative
  );
  return Math.pow(s, 2);
}

// Function to calculate marginal variance of tau hat
function getMarginalVarianceTauHat(
  priorVarianceRelDGP: number,
  mean: number,
  effectSize: number,
  variance: number,
  nPerVariation: number,
  relative: boolean
): number {
  const priorVarianceDGP = calculatePriorVariance(
    priorVarianceRelDGP,
    mean,
    relative
  );
  const tauHatVariance = estimateTauHatVariance(
    mean,
    effectSize,
    variance,
    nPerVariation,
    relative
  );
  return tauHatVariance + priorVarianceDGP;
}

// Function to calculate posterior precision
function getPosteriorPrecision(
  priorVarianceRelSpecified: number,
  mean: number,
  effectSize: number,
  variance: number,
  nPerVariation: number,
  relative: boolean,
  proper: boolean
): number {
  const priorVarianceSpecified = calculatePriorVariance(
    priorVarianceRelSpecified,
    mean,
    relative
  );
  const tauHatVariance = estimateTauHatVariance(
    mean,
    effectSize,
    variance,
    nPerVariation,
    relative
  );
  const properInt = proper ? 1 : 0;
  return 1 / tauHatVariance + properInt / priorVarianceSpecified;
}

// Function to calculate upper cutpoint
export function getCutpoint(
  alpha: number,
  effectSize: number,
  priorVarianceRelDGP: number,
  priorMeanRelSpecified: number,
  priorVarianceRelSpecified: number,
  proper: boolean,
  mean: number,
  variance: number,
  nPerVariation: number,
  relative: boolean,
  upper: boolean
): number {
  const priorMeanSpecified = calculatePriorMean(
    priorMeanRelSpecified,
    mean,
    relative
  );
  const priorVarianceSpecified = calculatePriorVariance(
    priorVarianceRelSpecified,
    mean,
    relative
  );
  const priorMeanDGP = calculatePriorMean(effectSize, mean, relative);

  const tauHatVariance = estimateTauHatVariance(
    mean,
    effectSize,
    variance,
    nPerVariation,
    relative
  );

  const posteriorPrecision = getPosteriorPrecision(
    priorVarianceRelSpecified,
    mean,
    effectSize,
    variance,
    nPerVariation,
    relative,
    proper
  );
  const marginalVarianceTauHat = getMarginalVarianceTauHat(
    priorVarianceRelDGP,
    mean,
    effectSize,
    variance,
    nPerVariation,
    relative
  );
  const zStar = normal.quantile(1.0 - 0.5 * alpha, 0, 1);
  const upperSign = upper ? 1 : -1;
  const properInt = proper ? 1 : 0;
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
 * @param alpha false positive rate (default: 0.05).
 * @param effectSize Scalar lift (relative to the scalar mean of the distribution, expressed as percentage).
 * @param priorVarianceRelDGP variance of the data generating process (relative scale).  use 0 for fixed treatment effect.
 * @param priorMeanRelSpecified mean of the data generating process (relative scale).
 * @param priorVarianceRelSpecified variance of the data generating process (relative scale).
 * @param proper if the specified prior is proper.
 * @param mean Scalar mean of the distribution.
 * @param variance Scalar variance of the distribution.
 * @param nPerVariation sample size per variation.
 * @param relative boolean indicator if relative inference is desired.
 * @returns Estimated power.
 */
export function powerEstBayesian(
  alpha: number,
  effectSize: number,
  priorVarianceRelDGP: number,
  priorMeanRelSpecified: number,
  priorVarianceRelSpecified: number,
  proper: boolean,
  mean: number,
  variance: number,
  nPerVariation: number,
  relative: boolean
): number {
  const upperCutpoint = getCutpoint(
    alpha,
    effectSize,
    priorVarianceRelDGP,
    priorMeanRelSpecified,
    priorVarianceRelSpecified,
    proper,
    mean,
    variance,
    nPerVariation,
    relative,
    true
  );
  const lowerCutpoint = getCutpoint(
    alpha,
    effectSize,
    priorVarianceRelDGP,
    priorMeanRelSpecified,
    priorVarianceRelSpecified,
    proper,
    mean,
    variance,
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
 * @param alpha false positive rate (default: 0.05).
 * @param power statistical power.
 * @param priorVarianceRelDGP variance of the data generating process (relative scale).  use 0 for fixed treatment effect.
 * @param priorMeanRelSpecified mean of the data generating process (relative scale).
 * @param priorVarianceRelSpecified variance of the data generating process (relative scale).
 * @param proper if the specified prior is proper.
 * @param mean Scalar mean of the distribution.
 * @param variance Scalar variance of the distribution.
 * @param nPerVariation sample size per variation.
 * @param relative boolean indicator if relative inference is desired.
 * @returns object of class MDEResults, containing type and either mde or description.
 */
export function findMdeBayesian(
  alpha: number,
  power: number,
  priorVarianceRelDGP: number,
  priorMeanRelSpecified: number,
  priorVarianceRelSpecified: number,
  proper: boolean,
  mean: number,
  variance: number,
  nPerVariation: number,
  relative: boolean,
  j: number
): MDEResults {
  let lowerBound = 0.0;
  let currentPower = powerEstBayesian(
    alpha,
    lowerBound,
    priorVarianceRelDGP,
    priorMeanRelSpecified,
    priorVarianceRelSpecified,
    proper,
    mean,
    variance,
    nPerVariation,
    relative
  );
  if (currentPower >= power) {
    /*case where prior is so strong that mde of 0 results in power of 0.8*/
    const mdeResults: MDEResults = {
      type: "success",
      mde: 0,
    };
    return mdeResults;
  }
  /*now we know mde is positive, need to find a lower bound*/
  const priorMeanSpecified = calculatePriorMean(
    priorMeanRelSpecified,
    mean,
    relative
  );
  const priorVarianceSpecified = calculatePriorVariance(
    priorVarianceRelSpecified,
    mean,
    relative
  );
  const tauHatVariance = estimateTauHatVariance(
    mean,
    lowerBound,
    variance,
    nPerVariation,
    relative
  );
  const posteriorPrecision = getPosteriorPrecision(
    priorVarianceRelSpecified,
    mean,
    lowerBound,
    variance,
    nPerVariation,
    relative,
    proper
  );
  const marginalVarianceTauHat = getMarginalVarianceTauHat(
    priorVarianceRelDGP,
    mean,
    lowerBound,
    variance,
    nPerVariation,
    relative
  );
  const zStar = normal.quantile(1.0 - alpha, 0, 1);

  lowerBound =
    marginalVarianceTauHat * Math.sqrt(posteriorPrecision) * zStar -
    (tauHatVariance * priorMeanSpecified) / priorVarianceSpecified -
    Math.sqrt(tauHatVariance) * normal.quantile(1.0 - power, 0, 1);
  // Handle relative vs. non-relative cases
  if (!relative) {
    lowerBound /= mean;
  }
  currentPower = powerEstBayesian(
    alpha,
    lowerBound,
    priorVarianceRelDGP,
    priorMeanRelSpecified,
    priorVarianceRelSpecified,
    proper,
    mean,
    variance,
    nPerVariation,
    relative
  );
  while (currentPower > power) {
    lowerBound *= 0.5;
    currentPower = powerEstBayesian(
      alpha,
      lowerBound,
      priorVarianceRelDGP,
      priorMeanRelSpecified,
      priorVarianceRelSpecified,
      proper,
      mean,
      variance,
      nPerVariation,
      relative
    );
  }
  /*maximum solution is 200% increase*/
  const maxPower = powerEstBayesian(
    alpha,
    2,
    priorVarianceRelDGP,
    priorMeanRelSpecified,
    priorVarianceRelSpecified,
    proper,
    mean,
    variance,
    nPerVariation,
    true
  );
  if (maxPower < power) {
    console.log(`failing at iteration j: %d`, j);
    console.log(`maxPower: %d`, maxPower);
    console.log(`priorVariancenRelDGP: %d`, priorVarianceRelDGP);
    console.log(`priorMeanRelSpecified: %d`, priorMeanRelSpecified);
    console.log(`priorVarianceRelSpecified: %d`, priorVarianceRelSpecified);
    console.log(
      `mean: %d, variance: %d, nPerVariation %d`,
      mean,
      variance,
      nPerVariation
    );
    const mdeResults: MDEResults = {
      type: "error",
      description:
        "need to increase number of users or reduce number of variations.",
    };
    return mdeResults;
  }
  let upperBound = 2 * lowerBound;
  currentPower = powerEstBayesian(
    alpha,
    upperBound,
    priorVarianceRelDGP,
    priorMeanRelSpecified,
    priorVarianceRelSpecified,
    proper,
    mean,
    variance,
    nPerVariation,
    relative
  );
  while (currentPower < power) {
    upperBound *= 2;
    currentPower = powerEstBayesian(
      alpha,
      upperBound,
      priorVarianceRelDGP,
      priorMeanRelSpecified,
      priorVarianceRelSpecified,
      proper,
      mean,
      variance,
      nPerVariation,
      relative
    );
  }
  let mde = 0.5 * (lowerBound + upperBound);
  currentPower = powerEstBayesian(
    alpha,
    mde,
    priorVarianceRelDGP,
    priorMeanRelSpecified,
    priorVarianceRelSpecified,
    proper,
    mean,
    variance,
    nPerVariation,
    relative
  );
  let diff = currentPower - power;
  let iters = 0;
  while (Math.abs(diff) >= 1e-5 && iters < 1e5) {
    if (diff > 0) {
      upperBound = mde;
    } else {
      lowerBound = mde;
    }
    mde = 0.5 * (lowerBound + upperBound);
    currentPower = powerEstBayesian(
      alpha,
      mde,
      priorVarianceRelDGP,
      priorMeanRelSpecified,
      priorVarianceRelSpecified,
      proper,
      mean,
      variance,
      nPerVariation,
      relative
    );
    diff = currentPower - power;
    iters += 1;
  }
  /*case where mde converged to nonzero value*/
  const mdeResults: MDEResults = {
    type: "success",
    mde: mde,
  };
  return mdeResults;
}

export function powerMetricWeeksBayesian(
  powerSettings: PowerCalculationParamsBayesian
): PowerCalculationResults {
  const metrics = powerSettings.metrics;
  const sampleSizeAndRuntimeNumeric: number[] = []; //for each metric, the first week they achieve 80% power.
  const nWeeks = powerSettings.nWeeks;
  function getNumberOfMetrics(params: PowerCalculationParamsBayesian): number {
    return Object.keys(params.metrics).length;
  }
  const nMetrics = getNumberOfMetrics(powerSettings);
  const metricKeys = Object.keys(metrics);
  const mySampleSizeAndRuntime: {
    [id: string]: SampleSizeAndRuntime | undefined;
  } = {};

  const metricThresholds = {};
  const weeks: Week[] = [...Array(nWeeks).keys()].map((idx) => ({
    users: (idx + 1) * powerSettings.usersPerWeek,
    metrics: {},
  }));

  for (let i = 0; i < nMetrics; i++) {
    const metricKey = metricKeys[i];
    const thisMetric = metrics[metricKey];
    let thisMean = 0;
    let thisVariance = 1;
    if (thisMetric.type === "binomial") {
      thisMean = thisMetric.conversionRate;
      thisVariance =
        thisMetric.conversionRate * (1 - thisMetric.conversionRate);
    } else {
      thisMean = thisMetric.mean;
      thisVariance = thisMetric.standardDeviation ** 2;
    }
    let thisMDENumeric = NaN;
    let thisSampleSizeAndRuntimeNumeric = 999;
    let lookingForSampleSizeAndRunTime = true;
    for (let j = 0; j < nWeeks; j++) {
      const n = powerSettings.usersPerWeek * (j + 1);

      const thisPower = powerEstBayesian(
        powerSettings.alpha,
        thisMetric.effectSize,
        0 /*fixed effect, so dgp variance is 0*/,
        thisMetric.priorMean,
        Math.pow(thisMetric.priorStandardDeviation, 2),
        thisMetric.proper,
        thisMean,
        thisVariance,
        n / powerSettings.nVariations,
        true
      );
      if (thisPower >= 0.8 && lookingForSampleSizeAndRunTime) {
        lookingForSampleSizeAndRunTime = false;
        thisSampleSizeAndRuntimeNumeric = j + 1;
      }
      const thisMde = findMdeBayesian(
        powerSettings.alpha,
        0.8,
        0 /*fixed effect, so dgp variance is 0*/,
        thisMetric.priorMean,
        Math.pow(thisMetric.priorStandardDeviation, 2),
        thisMetric.proper,
        thisMean,
        thisVariance,
        (powerSettings.usersPerWeek * (j + 1)) / powerSettings.nVariations,
        true,
        j
      );

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
  }
  function findMax(arr: number[]): number {
    return Math.max(...arr);
  }
  const duration = findMax(sampleSizeAndRuntimeNumeric);

  const results: PowerCalculationResults = {
    sampleSizeAndRuntime: mySampleSizeAndRuntime,
    type: "success",
    weeks,
    ...(duration !== 999 ? { weekThreshold: duration } : {}),
  };
  return results;
}
