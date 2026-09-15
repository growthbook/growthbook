import normal from "@stdlib/stats/base/dists/normal";

export function getQuantileBoundValues(
  quantile: number,
  alpha: number,
  nstar: number,
): { lower: number; upper: number } {
  const multiplier = normal.quantile(1 - alpha / 2, 0, 1);
  const binomialSE = Math.sqrt((quantile * (1 - quantile)) / nstar);
  return {
    lower: Math.max(quantile - multiplier * binomialSE, 0.00000001),
    upper: Math.min(quantile + multiplier * binomialSE, 0.99999999),
  };
}
