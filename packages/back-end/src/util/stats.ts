import chisquare from "@stdlib/stats/base/dists/chisquare";
import { returnZeroIfNotFinite } from "shared/util";

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

export function sumSquaresFromStats(
  sum: number,
  variance: number,
  n: number
): number {
  return returnZeroIfNotFinite(variance * (n - 1) + Math.pow(sum, 2) / n);
}
