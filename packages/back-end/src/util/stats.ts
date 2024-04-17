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
  sequential_tuning_parameter = 0
): number {
  if (typeof twoTailed !== "boolean") {
    throw new Error("twoTailed must be boolean.");
  }
  const zStar = twoTailed
    ? normal.quantile(1.0 - 0.5 * alpha, 0, 1)
    : normal.quantile(1.0 - alpha, 0, 1);

  let standardError = Math.sqrt(
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
  if (sequential_tuning_parameter > 0) {
    const rho = Math.sqrt(
      (-2 * Math.log(alpha) + Math.log(-2 * Math.log(alpha) + 1)) /
        sequential_tuning_parameter
    );
    //console.log("rho:", rho);
    const v_adjusted = variance * n;
    //console.log("v_adjusted:", v_adjusted);
    const width =
      Math.sqrt(v_adjusted) *
      Math.sqrt(
        (2 *
          (n * Math.pow(rho, 2) + 1) *
          Math.log(Math.sqrt(n * Math.pow(rho, 2) + 1) / alpha)) /
          Math.pow(n * rho, 2)
      );
    const v = (width / normal.quantile(1.0 - 0.5 * alpha, 0, 1)) ** 2;
    standardError = Math.sqrt(
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
  const standardizedEffectSize = effectSize / standardError;
  const upperCutpoint = zStar - standardizedEffectSize;
  //console.log("upperCutpoint:", upperCutpoint);
  let power = 1 - normal.cdf(upperCutpoint, 0, 1);
  //console.log("power_1:", power);
  if (twoTailed) {
    const lowerCutpoint = -zStar - standardizedEffectSize;
    power += normal.cdf(lowerCutpoint, 0, 1);
    //console.log("power_2:", power);
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
  twoTailed: boolean = true
): number {
  // Error handling:
  if (power <= alpha) {
    throw new Error("power must be greater than alpha.");
  }
  if (typeof twoTailed !== "boolean") {
    throw new Error("twoTailed must be boolean.");
  }
  //const tauVariance = 2 * variance * nVariations / n;
  //const standardError = Math.sqrt(tauVariance);
  //const threshLow = normal.quantile(1.0 - power, 0.0, 1.0);
  //const threshHigh = normal.quantile(1.0 - alpha, 0.0, 1.0);
  //const standardError = Math.sqrt(frequentistVariance(variance, mean, n / nVariations, variance, mean * (1 + 1), n / nVariations, true));
  //let lowerBound = standardError * (threshHigh - threshLow);

  let tau = 0.01;
  let s2 = frequentistVariance(
    variance,
    mean,
    n / nVariations,
    variance,
    mean * (1 + tau),
    n / nVariations,
    true
  );
  let s = Math.sqrt(s2);
  const threshold =
    normal.quantile(1.0 - 0.5 * alpha, 0, 1) -
    normal.quantile(1.0 - power, 0, 1);
  if (tau / s > threshold) {
    return s * threshold;
  } else {
    let iters = 0;
    while (tau / s <= threshold && iters < 1e5) {
      tau += 0.01;
      s2 = frequentistVariance(
        variance,
        mean,
        n / nVariations,
        variance,
        mean * (1 + tau),
        n / nVariations,
        true
      );
      s = Math.sqrt(s2);
      iters++;
    }
    if (iters >= 1e5) {
      throw new Error("findMde did not converge.");
    }
    return s * threshold;
  }
  /* if (twoTailed) {
    const threshHighTwoTailed = normal.quantile(1 - 0.5 * alpha, 0, 1);
    let upperBound = standardError * (threshHighTwoTailed - threshLow);
    let mde = 0.5 * (lowerBound + upperBound);   
    //mde needs to be expressed as a percentage of the mean, rather than absolute terms; 
    let currentPower = powerEst(mde / mean, mean, variance, n, nVariations, alpha, twoTailed);
    let diff = currentPower - power; 
    let iters = 0;
    while (Math.abs(diff) > 1e-5 && iters < 1e5) {
      if (diff > 0) {
        upperBound = mde;
        mde = 0.5 * (mde + lowerBound);
      } else {
        lowerBound = mde;
        mde = 0.5 * (mde + upperBound);
      }
      currentPower = powerEst(mde / mean, mean, variance, n, nVariations, alpha, twoTailed);
      diff = currentPower - power;
      iters++;
    }
    if (iters >= 1e5) {
      throw new Error("findMde did not converge.");
    }
    return mde;  
  } else {
    return lowerBound;
  } */
}
