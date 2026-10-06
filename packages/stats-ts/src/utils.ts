import normal from "@stdlib/stats/base/dists/normal";
import t from "@stdlib/stats/base/dists/t";

export function randomNormal(
  nSamples: number,
  mu: number,
  sigma: number,
): number[] {
  const u1 = Array.from({ length: nSamples }, () => Math.random());
  const u2 = Array.from({ length: nSamples }, () => Math.random());
  return u1.map((u, i) => {
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * u2[i]);
    return mu + sigma * z;
  });
}

/** Normal cumulative distribution function (exact, via `@stdlib`). */
export function normCdf(x: number, loc = 0, scale = 1): number {
  return normal.cdf(x, loc, scale);
}

/** Normal quantile function (via `@stdlib`). */
export function normQuantile(p: number, loc = 0, scale = 1): number {
  return normal.quantile(p, loc, scale);
}

/** Student's t cumulative distribution function (via `@stdlib`). */
export function tCdf(x: number, dof: number): number {
  return t.cdf(x, dof);
}

/** Student's t quantile function (via `@stdlib`). */
export function tQuantile(p: number, dof: number): number {
  return t.quantile(p, dof);
}
