/**
 * Frequentist hypothesis tests.
 * TypeScript port of gbstats/frequentist/tests.py
 */

import tCDF from "@stdlib/stats-base-dists-t-cdf";
import tQuantile from "@stdlib/stats-base-dists-t-quantile";

import type { TestStatistic } from "../models/statistics";
import { sumStats, createThetaAdjustedStatistics } from "../models/statistics";
import type {
  FrequentistTestResult,
  EffectMomentsResult,
  PValueErrorMessage,
} from "../models/results";
import { defaultFrequentistResult } from "../models/results";
import type { FrequentistConfig, SequentialConfig } from "../models/settings";
import {
  DEFAULT_FREQUENTIST_CONFIG,
  DEFAULT_SEQUENTIAL_CONFIG,
} from "../models/settings";
import {
  EffectMoments,
  type EffectMomentsConfig,
  DEFAULT_EFFECT_MOMENTS_CONFIG,
} from "./postStratification";

/**
 * P-value result structure.
 */
interface PValueResult {
  pValue: number | null;
  pValueErrorMessage: PValueErrorMessage;
}

/**
 * Base class for frequentist T-tests.
 */
abstract class TTest {
  protected stats: Array<[TestStatistic, TestStatistic]>;
  protected config: FrequentistConfig;
  public statA: TestStatistic;
  public statB: TestStatistic;
  protected momentsResult: EffectMomentsResult;
  protected relative: boolean;
  protected alpha: number;

  constructor(
    stats: Array<[TestStatistic, TestStatistic]>,
    config: Partial<FrequentistConfig> = {},
  ) {
    this.stats = stats;
    this.config = { ...DEFAULT_FREQUENTIST_CONFIG, ...config };

    // Sum statistics from all pairs
    const [sumA, sumB] = sumStats(stats);
    // Apply theta adjustment for regression-adjusted statistics
    const [adjustedA, adjustedB] = createThetaAdjustedStatistics(sumA, sumB);
    this.statA = adjustedA;
    this.statB = adjustedB;

    this.relative = this.config.differenceType === "relative";
    this.alpha = this.config.alpha;

    // Compute moments result using adjusted statistics
    const momentsConfig: EffectMomentsConfig = {
      differenceType: this.relative ? "relative" : "absolute",
    };
    this.momentsResult = new EffectMoments(
      [[this.statA, this.statB]],
      momentsConfig,
    ).computeResult();
  }

  abstract get pValue(): number | null;
  abstract get confidenceInterval(): [number, number];

  /**
   * T-statistic critical value.
   */
  get criticalValue(): number {
    if (this.momentsResult.standardError === 0) {
      return 0;
    }
    return this.momentsResult.pointEstimate / this.momentsResult.standardError;
  }

  /**
   * Degrees of freedom (Welch-Satterthwaite approximation).
   */
  get dof(): number {
    const varA = this.statA.variance;
    const varB = this.statB.variance;
    const nA = this.statA.n;
    const nB = this.statB.n;

    if (nA <= 1 || nB <= 1 || varA === 0 || varB === 0) {
      return 1; // Minimum degrees of freedom
    }

    const numerator = Math.pow(varB / nB + varA / nA, 2);
    const denominator =
      Math.pow(varB, 2) / (Math.pow(nB, 2) * (nB - 1)) +
      Math.pow(varA, 2) / (Math.pow(nA, 2) * (nA - 1));

    return numerator / denominator;
  }

  /**
   * Whether this is a sequential one-sided test.
   */
  get sequentialOneSidedTest(): boolean {
    return false;
  }

  /**
   * Compute p-value result.
   */
  computePValue(): PValueResult {
    return {
      pValue: this.pValue,
      pValueErrorMessage: null,
    };
  }

  /**
   * Compute the full test result.
   */
  computeResult(): FrequentistTestResult {
    // Check for error in moments result
    if (this.momentsResult.errorMessage) {
      return this.defaultOutput(this.momentsResult.errorMessage);
    }

    // Check for alpha > 0.5 in sequential one-sided tests
    if (this.sequentialOneSidedTest && this.alpha >= 0.5) {
      return this.defaultOutput(
        null,
        "ALPHA_GREATER_THAN_0.5_FOR_SEQUENTIAL_ONE_SIDED_TEST",
      );
    }

    const pValueResult = this.computePValue();

    return {
      expected: this.momentsResult.pointEstimate,
      ci: this.confidenceInterval,
      pValue: pValueResult.pValue,
      uplift: {
        dist: "normal",
        mean: this.momentsResult.pointEstimate,
        stddev: this.momentsResult.standardError,
      },
      errorMessage: null,
      pValueErrorMessage: pValueResult.pValueErrorMessage,
    };
  }

  protected defaultOutput(
    errorMessage: string | null = null,
    pValueErrorMessage: PValueErrorMessage = null,
  ): FrequentistTestResult {
    return defaultFrequentistResult(errorMessage, pValueErrorMessage);
  }
}

/**
 * Two-sided T-test with unequal variances (Welch's T-test).
 */
export class TwoSidedTTest extends TTest {
  constructor(
    stats: Array<[TestStatistic, TestStatistic]>,
    config: Partial<FrequentistConfig> = {},
  ) {
    super(stats, config);
  }

  get pValue(): number | null {
    const cv = Math.abs(this.criticalValue);
    return 2 * (1 - tCDF(cv, this.dof));
  }

  get confidenceInterval(): [number, number] {
    const halfwidth =
      tQuantile(1 - this.alpha / 2, this.dof) *
      this.momentsResult.standardError;
    const pe = this.momentsResult.pointEstimate;
    return [pe - halfwidth, pe + halfwidth];
  }
}

/**
 * One-sided T-test (treatment > control).
 */
export class OneSidedTreatmentGreaterTTest extends TTest {
  constructor(
    stats: Array<[TestStatistic, TestStatistic]>,
    config: Partial<FrequentistConfig> = {},
  ) {
    super(stats, config);
  }

  get pValue(): number | null {
    // P-value for one-sided test: P(T > t) = 1 - CDF(t)
    return 1 - tCDF(this.criticalValue, this.dof);
  }

  get confidenceInterval(): [number, number] {
    // One-sided CI: [-halfwidth + PE, +Infinity]
    const halfwidth =
      tQuantile(1 - this.alpha, this.dof) * this.momentsResult.standardError;
    return [this.momentsResult.pointEstimate - halfwidth, Infinity];
  }
}

/**
 * One-sided T-test (treatment < control).
 */
export class OneSidedTreatmentLesserTTest extends TTest {
  constructor(
    stats: Array<[TestStatistic, TestStatistic]>,
    config: Partial<FrequentistConfig> = {},
  ) {
    super(stats, config);
  }

  get pValue(): number | null {
    // P-value for one-sided test: P(T < t) = CDF(t)
    return tCDF(this.criticalValue, this.dof);
  }

  get confidenceInterval(): [number, number] {
    // One-sided CI: [-Infinity, PE + halfwidth]
    const halfwidth =
      tQuantile(1 - this.alpha, this.dof) * this.momentsResult.standardError;
    return [-Infinity, this.momentsResult.pointEstimate + halfwidth];
  }
}

/**
 * Base class for sequential T-tests.
 */
abstract class SequentialTTest extends TTest {
  protected sequentialConfig: SequentialConfig;
  protected _rho: number;

  constructor(
    stats: Array<[TestStatistic, TestStatistic]>,
    config: Partial<SequentialConfig> = {},
  ) {
    const fullConfig = { ...DEFAULT_SEQUENTIAL_CONFIG, ...config };
    super(stats, fullConfig);
    this.sequentialConfig = fullConfig;
    // Compute rho using the configured value or calculate it
    this._rho =
      fullConfig.rho ??
      sequentialRho(
        this.alpha,
        fullConfig.sequentialTuningParameter,
        !this.sequentialOneSidedTest,
      );
  }

  /**
   * Total sample size across both groups.
   */
  protected get n(): number {
    return this.statA.n + this.statB.n;
  }

  abstract get halfwidth(): number;
}

/**
 * Sequential two-sided T-test.
 */
export class SequentialTwoSidedTTest extends SequentialTTest {
  constructor(
    stats: Array<[TestStatistic, TestStatistic]>,
    config: Partial<SequentialConfig> = {},
  ) {
    super(stats, config);
  }

  get halfwidth(): number {
    const s2 = Math.pow(this.momentsResult.standardError, 2) * this.n;
    return sequentialIntervalHalfwidth(
      s2,
      this.n,
      this.sequentialConfig.sequentialTuningParameter,
      this.alpha,
      this._rho,
    );
  }

  get pValue(): number | null {
    // Equation 155 in https://arxiv.org/pdf/2103.06476v7.pdf
    // Slight reparameterization for this quantity
    const st2 =
      (Math.pow(this.momentsResult.pointEstimate, 2) * this.n) /
      Math.pow(this.momentsResult.standardError, 2);
    const tr2p1 = this.n * Math.pow(this._rho, 2) + 1;
    const evalue =
      Math.exp((Math.pow(this._rho, 2) * st2) / (2 * tr2p1)) / Math.sqrt(tr2p1);
    return Math.min(1 / evalue, 1);
  }

  get confidenceInterval(): [number, number] {
    const pe = this.momentsResult.pointEstimate;
    return [pe - this.halfwidth, pe + this.halfwidth];
  }
}

/**
 * Sequential one-sided T-test (treatment < control).
 * This is the base class for sequential one-sided tests.
 */
export class SequentialOneSidedTreatmentLesserTTest extends SequentialTTest {
  constructor(
    stats: Array<[TestStatistic, TestStatistic]>,
    config: Partial<SequentialConfig> = {},
  ) {
    super(stats, config);
  }

  override get sequentialOneSidedTest(): boolean {
    return true;
  }

  /**
   * Whether this is a "lesser" test (treatment < control).
   */
  get lesser(): boolean {
    return true;
  }

  get halfwidth(): number {
    const s2 = Math.pow(this.momentsResult.standardError, 2) * this.n;
    return sequentialIntervalHalfwidthOneSided(
      s2,
      this.n,
      this.sequentialConfig.sequentialTuningParameter,
      this.alpha,
      this._rho,
    );
  }

  get pValue(): number | null {
    // P-value is computed via bisection search in computePValue
    return null;
  }

  get confidenceInterval(): [number, number] {
    if (this.lesser) {
      return [-Infinity, this.momentsResult.pointEstimate + this.halfwidth];
    } else {
      return [this.momentsResult.pointEstimate - this.halfwidth, Infinity];
    }
  }

  override computePValue(): PValueResult {
    const rho = this._rho;
    const differenceType = this.relative ? "relative" : "absolute";
    const tol = 1e-6;
    const maxIters = 100;
    let minAlpha = 1e-5;
    let maxAlpha = 0.4999;

    // Create a test with the minimum alpha to check bounds
    const TestClass = this.lesser
      ? SequentialOneSidedTreatmentLesserTTest
      : SequentialOneSidedTreatmentGreaterTTest;

    const ciIndex = this.lesser ? 1 : 0;

    // Test with minimum alpha (wider CI)
    const testSmall = new TestClass([[this.statA, this.statB]], {
      differenceType,
      alpha: minAlpha,
      rho,
      sequentialTuningParameter:
        this.sequentialConfig.sequentialTuningParameter,
    });
    const ciSmall = testSmall.confidenceInterval;

    if (this.lesser) {
      // For lesser test, check upper bound of CI
      if (ciSmall[ciIndex] < 0) {
        return { pValue: minAlpha, pValueErrorMessage: null };
      }
      // Test with maximum alpha (narrower CI)
      const testBig = new TestClass([[this.statA, this.statB]], {
        differenceType,
        alpha: maxAlpha,
        rho,
        sequentialTuningParameter:
          this.sequentialConfig.sequentialTuningParameter,
      });
      const ciBig = testBig.confidenceInterval;
      if (ciBig[ciIndex] > 0) {
        return { pValue: maxAlpha, pValueErrorMessage: null };
      }
    } else {
      // For greater test, check lower bound of CI
      if (ciSmall[ciIndex] > 0) {
        return { pValue: minAlpha, pValueErrorMessage: null };
      }
      const testBig = new TestClass([[this.statA, this.statB]], {
        differenceType,
        alpha: maxAlpha,
        rho,
        sequentialTuningParameter:
          this.sequentialConfig.sequentialTuningParameter,
      });
      const ciBig = testBig.confidenceInterval;
      if (ciBig[ciIndex] < 0) {
        return { pValue: maxAlpha, pValueErrorMessage: null };
      }
    }

    // Bisection search
    let thisAlpha = 0.5 * (minAlpha + maxAlpha);
    let diff = 0;
    let iters = 0;

    for (let i = 0; i < maxIters; i++) {
      iters = i;
      const testThis = new TestClass([[this.statA, this.statB]], {
        differenceType,
        alpha: thisAlpha,
        rho,
        sequentialTuningParameter:
          this.sequentialConfig.sequentialTuningParameter,
      });
      const ciThis = testThis.confidenceInterval;
      diff = ciThis[ciIndex] - 0;

      if (this.lesser) {
        if (diff > 0) {
          minAlpha = thisAlpha;
        } else {
          maxAlpha = thisAlpha;
        }
      } else {
        if (diff < 0) {
          minAlpha = thisAlpha;
        } else {
          maxAlpha = thisAlpha;
        }
      }

      thisAlpha = 0.5 * (minAlpha + maxAlpha);

      if (Math.abs(diff) < tol) {
        break;
      }
    }

    const converged = Math.abs(diff) < tol && iters !== maxIters;
    if (converged) {
      return { pValue: thisAlpha, pValueErrorMessage: null };
    } else {
      return {
        pValue: null,
        pValueErrorMessage: "NUMERICAL_PVALUE_NOT_CONVERGED",
      };
    }
  }
}

/**
 * Sequential one-sided T-test (treatment > control).
 */
export class SequentialOneSidedTreatmentGreaterTTest extends SequentialOneSidedTreatmentLesserTTest {
  constructor(
    stats: Array<[TestStatistic, TestStatistic]>,
    config: Partial<SequentialConfig> = {},
  ) {
    super(stats, config);
  }

  override get lesser(): boolean {
    return false;
  }
}

/**
 * Calculate rho for sequential testing.
 */
export function sequentialRho(
  alpha: number,
  sequentialTuningParameter: number,
  twoSided: boolean = true,
): number {
  const alphaArg = twoSided ? alpha : 2 * alpha;
  return Math.sqrt(
    (-2 * Math.log(alphaArg) + Math.log(-2 * Math.log(alphaArg) + 1)) /
      sequentialTuningParameter,
  );
}

/**
 * Calculate the halfwidth for a sequential two-sided confidence interval.
 */
export function sequentialIntervalHalfwidth(
  s2: number,
  n: number,
  sequentialTuningParameter: number,
  alpha: number,
  rho?: number,
): number {
  const r = rho ?? sequentialRho(alpha, sequentialTuningParameter, true);
  return (
    Math.sqrt(s2) *
    Math.sqrt(
      (2 *
        (n * Math.pow(r, 2) + 1) *
        Math.log(Math.sqrt(n * Math.pow(r, 2) + 1) / alpha)) /
        Math.pow(n * r, 2),
    )
  );
}

/**
 * Calculate the halfwidth for a sequential one-sided confidence interval.
 */
export function sequentialIntervalHalfwidthOneSided(
  s2: number,
  n: number,
  sequentialTuningParameter: number,
  alpha: number,
  rho?: number,
): number {
  const r = rho ?? sequentialRho(alpha, sequentialTuningParameter, false);
  const part1 = s2;
  const part2 = (2 * (n * Math.pow(r, 2) + 1)) / Math.pow(n * r, 2);
  const part3 = Math.log(1 + Math.sqrt(n * Math.pow(r, 2) + 1) / (2 * alpha));
  return Math.sqrt(part1 * part2 * part3);
}
