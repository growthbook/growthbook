/**
 * Mid-experiment power analysis.
 * TypeScript port of gbstats/power/midexperimentpower.py
 */

import normalCDF from "@stdlib/stats-base-dists-normal-cdf";
import normalQuantile from "@stdlib/stats-base-dists-normal-quantile";

import type { GaussianPrior } from "../models/settings";
import type { EffectMomentsResult, TestResult } from "../models/results";
import { sequentialIntervalHalfwidth } from "../frequentist/tests";

export interface MidExperimentPowerConfig {
  targetPower: number;
  targetMde: number;
  numGoalMetrics?: number;
  numVariations?: number;
  priorEffect?: GaussianPrior | null;
  pValueCorrected?: boolean;
  sequential?: boolean;
  sequentialTuningParameter?: number;
}

export interface MidExperimentPowerResult {
  scalingFactor: number | null;
  powerAtScalingFactor?: number | null;
  converged?: boolean;
  upperBoundAchieved?: boolean;
  error?: string | null;
}

export class MidExperimentPower {
  private effectMoments: EffectMomentsResult;
  private testResult: TestResult;
  private alpha: number;
  private numGoalMetrics: number;
  private numTests: number;
  private multiplier: number;
  private targetPower: number;
  private adjustedPower: number;
  private targetMde: number;
  private priorEffect: GaussianPrior | null;
  private sequential: boolean;
  private sequentialTuningParameter: number;

  constructor(
    momentsResult: EffectMomentsResult,
    testResult: TestResult,
    config: { alpha: number },
    powerConfig: MidExperimentPowerConfig,
  ) {
    this.effectMoments = momentsResult;
    this.testResult = testResult;
    this.alpha = config.alpha;

    const numGoalMetrics = powerConfig.numGoalMetrics ?? 1;
    const numVariations = powerConfig.numVariations ?? 2;
    const pValueCorrected = powerConfig.pValueCorrected ?? false;

    this.numGoalMetrics = numGoalMetrics;
    this.numTests = pValueCorrected ? (numVariations - 1) * numGoalMetrics : 1;
    this.multiplier = normalQuantile(
      1 - this.alpha / (2 * this.numTests),
      0,
      1,
    );
    this.targetPower = powerConfig.targetPower;
    this.adjustedPower = Math.pow(this.targetPower, 1 / this.numGoalMetrics);
    this.targetMde = Math.abs(powerConfig.targetMde);
    this.priorEffect = powerConfig.priorEffect ?? null;
    this.sequential = powerConfig.sequential ?? false;
    this.sequentialTuningParameter =
      powerConfig.sequentialTuningParameter ?? 5000;
  }

  /**
   * Pairwise sample size (nA + nB).
   */
  get pairwiseSampleSize(): number {
    return this.effectMoments.pairwiseSampleSize;
  }

  /**
   * Estimated variance of the effect (sigma_hat^2_delta).
   */
  get sigmahat2Delta(): number {
    if (this.testResult.errorMessage !== null) {
      return 0;
    }
    return Math.pow(this.effectMoments.standardError, 2);
  }

  /**
   * Maximum iterations for bisection search.
   */
  get maxIters(): number {
    return 100;
  }

  /**
   * Maximum iterations for finding scaling factor upper bound.
   * 2^27 = 134,217,728
   */
  get maxItersScalingFactor(): number {
    return 27;
  }

  /**
   * Check if already powered (scaling factor of 0 is sufficient).
   */
  get alreadyPowered(): boolean {
    return this.power(0) > this.adjustedPower;
  }

  /**
   * Calculate the power of a hypothesis test.
   *
   * @param scalingFactor The scaling factor for additional samples.
   * @returns The power of the test.
   */
  power(scalingFactor: number): number {
    const nTPrime = scalingFactor * this.pairwiseSampleSize;
    const adjustedVariance = this.sigmahat2Delta / (1 + scalingFactor);

    if (this.priorEffect && this.priorEffect.proper) {
      // Bayesian power calculation
      const posteriorPrecision =
        1 / this.priorEffect.variance + 1 / adjustedVariance;
      const num1 =
        adjustedVariance * Math.pow(posteriorPrecision, 0.5) * this.multiplier;
      const num2 =
        (adjustedVariance * this.priorEffect.mean) / this.priorEffect.variance;
      const num3 = this.targetMde;
      const den = Math.pow(adjustedVariance, 0.5);
      const partPos = 1 - normalCDF((num1 - num2 - num3) / den, 0, 1);
      const partNeg = normalCDF(-(num1 + num2 + num3) / den, 0, 1);
      return partPos + partNeg;
    } else {
      // Frequentist power calculation
      let halfwidth: number;
      if (this.sequential) {
        const s2 = this.pairwiseSampleSize * this.sigmahat2Delta;
        const nTotal = this.pairwiseSampleSize + nTPrime;
        halfwidth = sequentialIntervalHalfwidth(
          s2,
          nTotal,
          this.sequentialTuningParameter,
          this.alpha / this.numTests,
        );
      } else {
        halfwidth = this.multiplier * Math.pow(adjustedVariance, 0.5);
      }
      const partPos =
        1 -
        normalCDF(
          (halfwidth - this.targetMde) / Math.pow(adjustedVariance, 0.5),
          0,
          1,
        );
      const partNeg = normalCDF(
        -(halfwidth + this.targetMde) / Math.pow(adjustedVariance, 0.5),
        0,
        1,
      );
      return partPos + partNeg;
    }
  }

  /**
   * Calculate the scaling factor needed to achieve target power.
   *
   * @returns The scaling factor result.
   */
  calculateScalingFactor(): MidExperimentPowerResult {
    // Case where this (metric, variation) is already ready for decision
    if (this.alreadyPowered) {
      return {
        scalingFactor: 0,
        converged: true,
        upperBoundAchieved: false,
        error: null,
        powerAtScalingFactor: this.power(0),
      };
    }

    // First find minimum scaling_factor such that power is greater than target
    let scalingFactor = 1;
    let currentPower = this.power(scalingFactor);

    for (let i = 0; i < this.maxItersScalingFactor; i++) {
      if (currentPower < this.adjustedPower) {
        scalingFactor *= 2;
        currentPower = this.power(scalingFactor);
      } else {
        break;
      }
    }

    if (currentPower < this.adjustedPower) {
      return {
        scalingFactor: null,
        converged: false,
        upperBoundAchieved: true,
        error: "could not find upper bound for scaling factor",
      };
    }

    // Then perform bisection search
    let scalingFactorLower = 0;
    let scalingFactorUpper = scalingFactor;
    let diff = currentPower - this.adjustedPower;
    const tolerance = 1e-5;
    let iteration = 0;

    for (iteration = 0; iteration < this.maxIters; iteration++) {
      if (diff > 0) {
        scalingFactorUpper = scalingFactor;
      } else {
        scalingFactorLower = scalingFactor;
      }
      scalingFactor = 0.5 * (scalingFactorLower + scalingFactorUpper);
      currentPower = this.power(scalingFactor);
      diff = currentPower - this.adjustedPower;
      if (Math.abs(diff) < tolerance) {
        break;
      }
    }

    const converged = iteration < this.maxIters - 1;

    return {
      scalingFactor,
      converged,
      upperBoundAchieved: false,
      error: converged ? null : "bisection search did not converge",
      powerAtScalingFactor: currentPower,
    };
  }
}
