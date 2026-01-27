/**
 * Utility functions for statistical calculations.
 * TypeScript port of gbstats/utils.py
 */

import normalCDF from "@stdlib/stats-base-dists-normal-cdf";
import normalPDF from "@stdlib/stats-base-dists-normal-pdf";
import normalQuantile from "@stdlib/stats-base-dists-normal-quantile";
import chi2CDF from "@stdlib/stats-base-dists-chisquare-cdf";

/**
 * Calculate the relative or absolute difference between two means.
 */
export function frequentistDiff(
  meanA: number,
  meanB: number,
  relative: boolean,
  meanAUnadjusted?: number,
): number {
  const baseline = meanAUnadjusted ?? meanA;
  if (relative) {
    if (baseline === 0) {
      return 0;
    }
    return (meanB - meanA) / baseline;
  }
  return meanB - meanA;
}

/**
 * Calculate the variance of the difference between two groups.
 */
export function frequentistVariance(
  varA: number,
  meanA: number,
  nA: number,
  varB: number,
  meanB: number,
  nB: number,
  relative: boolean,
): number {
  if (relative) {
    return varianceOfRatios(meanB, varB / nB, meanA, varA / nA, 0);
  }
  return varB / nB + varA / nA;
}

/**
 * Calculate the variance of M/D using the delta method.
 *
 * Given numerator random variable M (mean = meanM, var = varM),
 * denominator random variable D (mean = meanD, var = varD),
 * and covariance covMD, what is the variance of M / D?
 */
export function varianceOfRatios(
  meanM: number,
  varM: number,
  meanD: number,
  varD: number,
  covMD: number,
): number {
  if (meanD === 0) {
    return 0;
  }
  return (
    varM / Math.pow(meanD, 2) +
    (varD * Math.pow(meanM, 2)) / Math.pow(meanD, 4) -
    (2 * covMD * meanM) / Math.pow(meanD, 3)
  );
}

/**
 * Calculate the mean of a truncated normal distribution.
 *
 * Given X ~ N(mu, sigma^2) truncated to [a, b], returns E[X | a < X < b].
 * Formula: mu + sigma * (phi(alpha) - phi(beta)) / (Phi(beta) - Phi(alpha))
 * where alpha = (a - mu) / sigma, beta = (b - mu) / sigma,
 * phi is the standard normal PDF, and Phi is the standard normal CDF.
 */
export function truncatedNormalMean(
  mu: number,
  sigma: number,
  a: number,
  b: number,
): number {
  // Standardize bounds
  const alpha = (a - mu) / sigma;
  const beta = (b - mu) / sigma;

  // Use stdlib's PDF for better precision
  const phiAlpha = isFinite(alpha) ? normalPDF(alpha, 0, 1) : 0;
  const phiBeta = isFinite(beta) ? normalPDF(beta, 0, 1) : 0;

  // Use survival function identity for numerical stability
  let PhiAlpha: number;
  let PhiBeta: number;

  if (isFinite(alpha)) {
    PhiAlpha = alpha < 0 ? normalCDF(alpha, 0, 1) : 1 - normalCDF(-alpha, 0, 1);
  } else {
    PhiAlpha = alpha < 0 ? 0 : 1;
  }

  if (isFinite(beta)) {
    PhiBeta = beta < 0 ? normalCDF(beta, 0, 1) : 1 - normalCDF(-beta, 0, 1);
  } else {
    PhiBeta = beta < 0 ? 0 : 1;
  }

  // Handle edge cases
  const denominator = PhiBeta - PhiAlpha;
  if (denominator === 0) return mu;

  return mu + (sigma * (phiAlpha - phiBeta)) / denominator;
}

/**
 * Calculate a Gaussian credible interval.
 *
 * Returns the (1-alpha) credible interval for a normal distribution
 * with given mean and standard deviation.
 */
export function gaussianCredibleInterval(
  meanDiff: number,
  stdDiff: number,
  alpha: number,
): [number, number] {
  const lower = normalQuantile(alpha / 2, meanDiff, stdDiff);
  const upper = normalQuantile(1 - alpha / 2, meanDiff, stdDiff);
  return [lower, upper];
}

/**
 * Run a chi-squared test for sample ratio mismatch (SRM).
 *
 * Tests whether the observed user counts match the expected weights.
 * Returns a p-value where small values indicate a mismatch.
 */
export function checkSrm(users: number[], weights: number[]): number {
  const totalObserved = users.reduce((a, b) => a + b, 0);
  if (totalObserved === 0) {
    return 1;
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let x = 0;

  for (let i = 0; i < users.length; i++) {
    if (weights[i] <= 0) {
      continue;
    }
    const e = (weights[i] / totalWeight) * totalObserved;
    x += Math.pow(users[i] - e, 2) / e;
  }

  // Chi-squared survival function (1 - CDF)
  // degrees of freedom = number of categories - 1
  return 1 - chi2CDF(x, users.length - 1);
}

/**
 * Calculate the covariance matrix for a multinomial distribution.
 * Given X ~ multinomial(1, nu), what is the covariance matrix of X?
 */
export function multinomialCovariance(nu: number[]): number[][] {
  const n = nu.length;
  const result: number[][] = Array(n)
    .fill(null)
    .map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        result[i][j] = nu[i] * (1 - nu[i]);
      } else {
        result[i][j] = -nu[i] * nu[j];
      }
    }
  }

  return result;
}

/**
 * Check if the confidence interval indicates statistical significance.
 */
export function isStatisticallySignificant(ci: [number, number]): boolean {
  return ci[0] > 0 || ci[1] < 0;
}

/**
 * Normal survival function (1 - CDF) with better numerical stability.
 * For values where CDF is close to 1, uses the complementary calculation.
 * Uses the identity: SF(x; mu, sigma) = CDF(-z; 0, 1) where z = (x - mu) / sigma
 */
export function normalSF(x: number, mu: number, sigma: number): number {
  // Handle degenerate distribution (all probability mass at mu)
  if (sigma <= 0) {
    return x < mu ? 1 : 0;
  }
  const z = (x - mu) / sigma;
  if (z > 0) {
    // When z > 0, CDF(z) is close to 1, so 1-CDF(z) loses precision
    // Use identity: 1 - CDF(z) = CDF(-z) for standard normal
    return normalCDF(-z, 0, 1);
  } else {
    // When z <= 0, direct calculation is stable
    return 1 - normalCDF(z, 0, 1);
  }
}
