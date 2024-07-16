import chisquare from "@stdlib/stats/base/dists/chisquare";

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

export function proportionVarianceFromSums(sum: number, n: number): number {
  const mean = sum / n;
  return returnZeroIfNotFinite(mean * (1 - mean));
}

// compare with RatioStatistic.variance in gbstats
export function ratioVarianceFromSums({
  numerator_sum,
  numerator_sum_squares,
  denominator_sum,
  denominator_sum_squares,
  numerator_denominator_sum_product,
  n,
}: {
  numerator_sum: number;
  numerator_sum_squares: number;
  denominator_sum: number;
  denominator_sum_squares: number;
  numerator_denominator_sum_product: number;
  n: number;
}): number {
  const numerator_mean = returnZeroIfNotFinite(numerator_sum / n);
  const numerator_variance = meanVarianceFromSums(
    numerator_sum,
    numerator_sum_squares,
    n
  );
  const denominator_mean = returnZeroIfNotFinite(denominator_sum / n);
  const denominator_variance = meanVarianceFromSums(
    denominator_sum,
    denominator_sum_squares,
    n
  );
  const covariance =
    returnZeroIfNotFinite(
      numerator_denominator_sum_product - (numerator_sum * denominator_sum) / n
    ) /
    (n - 1);

  return returnZeroIfNotFinite(
    numerator_variance / Math.pow(denominator_mean, 2) -
      (2 * covariance * numerator_mean) / Math.pow(denominator_mean, 3) +
      (Math.pow(numerator_mean, 2) * denominator_variance) /
        Math.pow(denominator_mean, 4)
  );
}
