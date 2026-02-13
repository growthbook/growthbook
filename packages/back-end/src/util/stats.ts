// @ts-expect-error - ESM requires full path to index.js
import chisquare from "@stdlib/stats/base/dists/chisquare/lib/index.js";
import { returnZeroIfNotFinite } from "shared/util";

export function checkSrm(users: number[], weights: number[]) {
  // Skip variations with weight=0 or a missing user count
  const data: [number, number][] = [];
  let totalUsers = 0;
  let totalWeight = 0;
  for (let i = 0; i < weights.length; i++) {
    if (!weights[i] || users[i] === undefined) continue;
    data.push([users[i], weights[i]]);
    totalUsers += users[i];
    totalWeight += weights[i];
  }

  // Skip SRM calculation if there aren't enough valid variations
  if (data.length < 2) {
    return 1;
  }

  // if no data, no need to calculate SRM
  if (totalUsers === 0) {
    return 1;
  }

  // Calculate and return SRM p-value using a ChiSquare test
  let x = 0;
  data.forEach(([o, e]) => {
    e = (e / totalWeight) * totalUsers;
    x += Math.pow(o - e, 2) / e;
  });
  return chi2pvalue(x, data.length - 1);
}

export function chi2pvalue(x: number, df: number) {
  return 1 - chisquare.cdf(x, df);
}

export function sumSquaresFromStats(
  sum: number,
  variance: number,
  n: number,
): number {
  return returnZeroIfNotFinite(variance * (n - 1) + Math.pow(sum, 2) / n);
}
