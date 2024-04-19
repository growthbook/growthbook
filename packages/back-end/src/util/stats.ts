import chisquare from "@stdlib/stats/base/dists/chisquare";
import normal from "@stdlib/stats/base/dists/normal";

export function checkSrm(users: number[], weights: number[]) {
  // Skip variations with weight=0 or users=0
  const data: [number, number][] = [];
  let totalUsers = 0;
  let totalWeight = 0;
  for (let i = 0; i < weights.length; i++) {
    if (!weights[i] || !users[i]) continue;
    data.push([users[i], weights[i]]);
    totalUsers += users[i];
    totalWeight += weights[i];
  }

  // Skip SRM calculation if there aren't enough valid variations
  if (data.length < 2) {
    return 1;
  }

  // Calculate and return SRM p-value using a ChiSquare test
  let x = 0;
  data.forEach(([o, e]) => {
    e = (e / totalWeight) * totalUsers;
    x += Math.pow(o - e, 2) / e;
  });
  return 1 - chisquare.cdf(x, data.length - 1);
}

function returnZeroIfNotFinite(x: number): number {
  if (isFinite(x)) {
    return x;
  }
  return 0;
}

export function sumSquaresFromStats(
  sum: number,
  variance: number,
  n: number
): number {
  return returnZeroIfNotFinite(variance * (n - 1) + Math.pow(sum, 2) / n);
}

export function meanVarianceFromSums(
  sum: number,
  sum_squares: number,
  n: number
): number {
  const variance = (sum_squares - Math.pow(sum, 2) / n) / (n - 1);
  return returnZeroIfNotFinite(variance);
}

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
  n: number, 
  nVariations: number, 
  effectSize: number
): number {



  return Math.sqrt(
    frequentistVariance(
      variance,
      mean,
      n / nVariations,
      variance,
      mean * (1 + effectSize),
      n / nVariations,
      true
    )
  );
}

export function calculateRho(alpha: number, sequentialTuningParameter: number): number {
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
  const rho = calculateRho(alpha, sequentialTuningParameter);
  const v_adjusted = variance * n;
  const width =
    Math.sqrt(v_adjusted) *
    Math.sqrt(
      (2 *
        (n * Math.pow(rho, 2) + 1) *
        Math.log(Math.sqrt(n * Math.pow(rho, 2) + 1) / alpha)) /
        Math.pow(n * rho, 2)
    );
  //i match on rho
  //match on width

  return (width / normal.quantile(1.0 - 0.5 * alpha, 0, 1)) ** 2;
}

export function sequentialPowerStandardError(
  variance: number, 
  mean: number, 
  n: number, 
  nVariations: number, 
  effectSize: number, 
  alpha: number, 
  sequentialTuningParameter: number
): number {
  const v = sequentialPowerSequentialVariance(variance, n / nVariations, alpha, sequentialTuningParameter);
  return Math.sqrt(
    frequentistVariance(
      v,
      mean,
      n / nVariations,
      v,
      mean * (1.0 + effectSize),
      n / nVariations,
      true
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
  if (typeof twoTailed !== "boolean") {
    throw new Error("twoTailed must be boolean.");
  }
  const zStar = twoTailed
    ? normal.quantile(1.0 - 0.5 * alpha, 0, 1)
    : normal.quantile(1.0 - alpha, 0, 1);
  
  let standardError = 0;
  if (sequentialTuningParameter > 0) {
      standardError = sequentialPowerStandardError(variance, 
        mean, 
        n, 
        nVariations, 
        effectSize, 
        alpha,
        sequentialTuningParameter
      )
    } else {      
      standardError = powerStandardError(
        variance, 
        mean, 
        n, 
        nVariations, 
        effectSize, 
      )
    }
  ;
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
 * @param twoTailed Binary indicator if the test is 1 or 2-tailed (default: true).
 * @returns Estimated power.
 */
export function findMde(
  power: number,
  mean: number,
  variance: number,
  n: number,
  nVariations: number,
  alpha: number = 0.05,
  twoTailed: boolean = true, 
  sequentialTuningParameter = 0
): number {
  // Error handling:
  if (power <= alpha) {
    throw new Error("power must be greater than alpha.");
  }
  if (typeof twoTailed !== "boolean") {
    throw new Error("twoTailed must be boolean.");
  }
  const nA = n/nVariations
  const z = normal.quantile(1.0 - 0.5 * alpha, 0, 1) - normal.quantile(1.0 - power, 0, 1);
  let v = variance; 
  if (sequentialTuningParameter > 0) {
    v = sequentialPowerSequentialVariance(variance, nA, alpha, sequentialTuningParameter);
  }
  if (nA <= v * z ** 2 / (2 * mean ** 2)) {
    throw new Error("need to increase number of users or reduce number of variations.");
  }
  const sigma2 = v / nA;
  const a_star = (1 - z ** 2 * sigma2 / mean ** 2);
  const b_star = -2 * mean; 
  const c_star = mean ** 2 - z ** 2 * sigma2; 
  const disc = b_star ** 2  - 4 * a_star * c_star;
  const sol_1 = (-b_star + Math.sqrt(disc)) / (2 * a_star); 
  //const sol_2 = (-b_star - Math.sqrt(disc)) / (2 * a_star); 
  return (sol_1 - mean) / mean;
}

export type MetricParams =
  | {
      type: "mean";
      name: string;
      effectSize: number;
      mean: number;
      standardDeviation: number;
    }
  | {
      type: "binomial";
      name: string;
      effectSize: number;
      conversionRate: number;
    };

export interface PowerCalculationParams {
  metrics: { [id: string]: MetricParams };
  nVariations: number;
  usersPerDay: number;
  alpha: number;
  statsEngine: {
    type: "frequentist";
    sequentialTesting: false | number;
  };
}

interface SampleSizeAndRuntime {
  name: string;
  effectSize: number;
  users: number;
  weeks: number;
  type: "mean" | "binomial";
}

export type PowerCalculationResults = {
  usersPerDay: number;
  nWeeks: number;
  metrics: { [id: string]: MetricParams }; // Array representing metrics
  nVariations: number 
  alpha: number
  power: number[]; // nMetrics * nWeeks length array of numbers for power values
  mde: number[]; // nMetrics * nWeeks length array of numbers for minimum detectable effects
  sampleSizeAndRuntime: {
    [id: string]: SampleSizeAndRuntime;
  };//first weeks when 80% power is achieved
  duration: number; //scalar indicating when 80% power is achieved for all metrics; returns 999 if > 9;
};

export function powerMetricWeeks(
  {powerSettings}: {
  powerSettings: PowerCalculationParams
  }
) 
: PowerCalculationResults
{
  const metrics = powerSettings.metrics
  const power: number[] = [];
  const mde: number[] = [];
  const sampleSizeAndRuntimeNumeric: number[] = []; //for each metric, the first week they achieve 80% power. 
  const nWeeks = 9; //constant for now
  let sequentialTuningParameter = 0.0; 
  if (powerSettings.statsEngine.sequentialTesting !== false) {
    sequentialTuningParameter = powerSettings.statsEngine.sequentialTesting;
  }
  function getNumberOfMetrics(params: PowerCalculationParams): number {
    return Object.keys(params.metrics).length;
  }  
  const nMetrics = getNumberOfMetrics(powerSettings);
  let mySampleSizeAndRuntime: { [id: string]: SampleSizeAndRuntime } = {};
  for (let i = 0; i < nMetrics; i++) {
    const thisMetric = metrics[Object.keys(metrics)[i]]; 
    let thisMean = 0;
    let thisVariance = 1;
    if (thisMetric.type === "binomial") {
      thisMean = thisMetric.conversionRate;
      thisVariance = thisMetric.conversionRate * (1 - thisMetric.conversionRate);
    } else {
      thisMean = thisMetric.mean;
      thisVariance = thisMetric.standardDeviation ** 2;
    }
    let thisSampleSizeAndRuntimeNumeric = 999;
    let lookingForSampleSizeAndRunTime =  true; 
    for (let j = 0; j < nWeeks; j++) {
      let n = powerSettings.usersPerDay * (j + 1);
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
      const thisMde =findMde(
        0.8,
        thisMean,
        thisVariance,
        powerSettings.usersPerDay * (j + 1),
        powerSettings.nVariations,
        powerSettings.alpha,
        true, 
        sequentialTuningParameter
      );
      power.push(thisPower); 
      mde.push(thisMde);
    }
    sampleSizeAndRuntimeNumeric.push(thisSampleSizeAndRuntimeNumeric);
    let thisSampleSizeAndRuntime: SampleSizeAndRuntime = {
      name: thisMetric.name,
      effectSize: thisMetric.effectSize,
      users: powerSettings.usersPerDay,
      weeks: thisSampleSizeAndRuntimeNumeric,
      type: thisMetric.type,
    };
    mySampleSizeAndRuntime[thisMetric.name] = thisSampleSizeAndRuntime;    
  }
  function findMax(arr: number[]): number {
    return Math.max(...arr);
  }
  const duration = findMax(sampleSizeAndRuntimeNumeric);
  const results: PowerCalculationResults = {
    usersPerDay: powerSettings.usersPerDay,
    nWeeks: nWeeks,
    metrics: powerSettings.metrics,
    nVariations: powerSettings.nVariations,
    alpha: powerSettings.alpha, 
    power: power,
    mde: mde, 
    sampleSizeAndRuntime: mySampleSizeAndRuntime, 
    duration: duration
  };
  return results;
}

