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
 * Performs power calculation
 *
 * @param effectSize Scalar lift (relative to the scalar mean of the distribution, expressed as percentage).
 * @param mean Scalar mean of the distribution.
 * @param variance Scalar variance of the distribution.
 * @param n Scalar sample size.
 * @param n_variations Scalar number of variations.
 * @param alpha false positive rate (default: 0.05).
 * @param twoTailed Binary indicator if the test is 1 or 2-tailed (default: true).
 * @returns Estimated power.
 */
export function powerEst(
  effectSize: number,
  mean: number,
  variance: number,
  n: number,
  n_variations: number,
  alpha: number = 0.05,
  twoTailed: boolean = true
): number {
  if (typeof twoTailed !== "boolean") {
    throw new Error("twoTailed must be boolean.");
  }

  const zStar = twoTailed
    ? normal.quantile(1.0 - 0.5 * alpha, 0, 1)
    : normal.quantile(1.0 - alpha, 0, 1);

  const standardError = Math.sqrt((2 * variance * n_variations) / n);
  const standardizedEffectSize = (effectSize * mean) / standardError;
  const upperCutpoint = zStar - standardizedEffectSize;
  let power = 1 - normal.cdf(upperCutpoint, 0, 1);

  if (twoTailed) {
    const lowerCutpoint = -zStar - standardizedEffectSize;
    power += normal.cdf(lowerCutpoint, 0, 1);
  }
  return power;
}
