/**
 * Bayesian hypothesis tests.
 * TypeScript port of gbstats/bayesian/tests.py
 */

import normalCDF from "@stdlib/stats-base-dists-normal-cdf";

import type { TestStatistic } from "../models/statistics";
import { sumStats, createThetaAdjustedStatistics } from "../models/statistics";
import type {
  BayesianTestResult,
  EffectMomentsResult,
} from "../models/results";
import { defaultBayesianResult } from "../models/results";
import type { EffectBayesianConfig } from "../models/settings";
import { DEFAULT_EFFECT_BAYESIAN_CONFIG } from "../models/settings";
import {
  EffectMoments,
  type EffectMomentsConfig,
  BASELINE_VARIATION_ZERO_MESSAGE,
} from "../frequentist/postStratification";
import {
  truncatedNormalMean,
  gaussianCredibleInterval,
  normalSF,
} from "../utils";

/**
 * Effect-based Bayesian A/B test.
 */
export class EffectBayesianABTest {
  protected stats: Array<[TestStatistic, TestStatistic]>;
  protected config: EffectBayesianConfig;
  public statA: TestStatistic;
  public statB: TestStatistic;
  public momentsResult: EffectMomentsResult;
  protected relative: boolean;
  protected alpha: number;
  protected inverse: boolean;

  constructor(
    stats: Array<[TestStatistic, TestStatistic]>,
    config: Partial<EffectBayesianConfig> = {},
  ) {
    this.stats = stats;
    this.config = { ...DEFAULT_EFFECT_BAYESIAN_CONFIG, ...config };

    // Sum statistics from all pairs
    const [sumA, sumB] = sumStats(stats);
    // Apply theta adjustment for regression-adjusted statistics
    const [adjustedA, adjustedB] = createThetaAdjustedStatistics(sumA, sumB);
    this.statA = adjustedA;
    this.statB = adjustedB;

    this.relative = this.config.differenceType === "relative";
    this.alpha = this.config.alpha;
    this.inverse = this.config.inverse;

    // Compute moments result using adjusted statistics
    const momentsConfig: EffectMomentsConfig = {
      differenceType: this.relative ? "relative" : "absolute",
    };
    this.momentsResult = new EffectMoments(
      [[this.statA, this.statB]],
      momentsConfig,
    ).computeResult();
  }

  /**
   * Data mean (point estimate from moments).
   */
  get dataMean(): number {
    return this.momentsResult.pointEstimate;
  }

  /**
   * Data variance (squared standard error from moments).
   */
  get dataVariance(): number {
    return Math.pow(this.momentsResult.standardError, 2);
  }

  /**
   * Compute the Bayesian test result.
   */
  computeResult(): BayesianTestResult {
    // Check for error in moments result
    if (this.momentsResult.errorMessage !== null) {
      return this.defaultOutput(this.momentsResult.errorMessage);
    }

    // Scale prior if needed based on prior_type vs difference_type
    let scaledPriorEffect = this.config.priorEffect;

    if (this.relative && this.config.priorType === "absolute") {
      // Scale absolute prior to relative
      const unadjustedMean = this.statA.unadjustedMean ?? this.statA.mean;
      scaledPriorEffect = {
        mean: this.config.priorEffect.mean / Math.abs(unadjustedMean),
        variance:
          this.config.priorEffect.variance / Math.pow(unadjustedMean, 2),
        proper: this.config.priorEffect.proper,
      };
    } else if (!this.relative && this.config.priorType === "relative") {
      // Scale relative prior to absolute
      const unadjustedMean = this.statA.unadjustedMean ?? this.statA.mean;
      if (this.config.priorEffect.proper && unadjustedMean === 0) {
        return this.defaultOutput(BASELINE_VARIATION_ZERO_MESSAGE);
      }
      scaledPriorEffect = {
        mean: this.config.priorEffect.mean * Math.abs(unadjustedMean),
        variance:
          this.config.priorEffect.variance * Math.pow(unadjustedMean, 2),
        proper: this.config.priorEffect.proper,
      };
    }

    // Compute posterior precision and mean
    let postPrec: number;
    let meanDiff: number;

    if (this.dataVariance) {
      postPrec =
        1 / this.dataVariance +
        (scaledPriorEffect.proper ? 1 / scaledPriorEffect.variance : 0);

      if (scaledPriorEffect.proper) {
        meanDiff =
          (this.dataMean / this.dataVariance +
            scaledPriorEffect.mean / scaledPriorEffect.variance) /
          postPrec;
      } else {
        meanDiff = this.dataMean;
      }
    } else {
      postPrec = scaledPriorEffect.proper ? 1 / scaledPriorEffect.variance : 0;
      meanDiff = scaledPriorEffect.proper ? scaledPriorEffect.mean : 0;
    }

    if (postPrec === 0) {
      return this.defaultOutput(BASELINE_VARIATION_ZERO_MESSAGE);
    }

    const stdDiff = Math.sqrt(1 / postPrec);

    // Compute results
    const ctw = this.chanceToWin(meanDiff, stdDiff);
    const ci = gaussianCredibleInterval(meanDiff, stdDiff, this.alpha);
    let risk = EffectBayesianABTest.getRisk(meanDiff, stdDiff);

    // Flip risk for inverse metrics
    if (this.inverse) {
      risk = [risk[1], risk[0]];
    }

    return {
      chanceToWin: ctw,
      expected: meanDiff,
      ci,
      uplift: {
        dist: "normal",
        mean: meanDiff,
        stddev: stdDiff,
      },
      risk,
      riskType: this.relative ? "relative" : "absolute",
      errorMessage: null,
    };
  }

  /**
   * Calculate the probability that treatment is better than control.
   *
   * P(effect > 0) = 1 - Phi(0, mean, std) = Phi_sf(0, mean, std)
   * where Phi_sf is the survival function (1 - CDF).
   */
  chanceToWin(meanDiff: number, stdDiff: number): number {
    // Use numerically stable survival function
    const sf = normalSF(0, meanDiff, stdDiff);
    return this.inverse ? 1 - sf : sf;
  }

  /**
   * Calculate risk (expected loss) for both control and treatment.
   *
   * Risk for control: E[max(0, effect)] = (1 - P(effect < 0)) * E[effect | effect > 0]
   * Risk for treatment: E[max(0, -effect)] = P(effect < 0) * |E[effect | effect < 0]|
   */
  static getRisk(mu: number, sigma: number): [number, number] {
    const probCtrlIsBetter = normalCDF(0.0, mu, sigma);

    // E[effect | effect < 0] - truncated to (-inf, 0)
    const mnNeg = truncatedNormalMean(mu, sigma, -Infinity, 0.0);

    // E[effect | effect > 0] - truncated to (0, inf)
    const mnPos = truncatedNormalMean(mu, sigma, 0.0, Infinity);

    // Risk for control: if treatment is actually better, we lose the positive effect
    const riskCtrl = (1.0 - probCtrlIsBetter) * mnPos;

    // Risk for treatment: if control is actually better, we lose by the negative effect
    const riskTrt = -probCtrlIsBetter * mnNeg;

    return [riskCtrl, riskTrt];
  }

  protected defaultOutput(
    errorMessage: string | null = null,
  ): BayesianTestResult {
    return defaultBayesianResult(errorMessage, this.relative);
  }
}
