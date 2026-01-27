/**
 * Post-stratification for A/B test analysis.
 * TypeScript port of gbstats/models/tests.py post-stratification classes.
 */

import type { TestStatistic, Statistic } from "../models/statistics";
import {
  SampleMeanStatistic,
  ProportionStatistic,
  RatioStatistic,
  RegressionAdjustedStatistic,
  RegressionAdjustedRatioStatistic,
  sumStats,
  createThetaAdjustedStatistics,
} from "../models/statistics";
import type { EffectMomentsResult } from "../models/results";
import type { DifferenceType } from "../models/settings";

// Error messages - must match Python gbstats for test compatibility
export const ZERO_NEGATIVE_VARIANCE_MESSAGE = "ZERO_NEGATIVE_VARIANCE";
export const BASELINE_VARIATION_ZERO_MESSAGE =
  "ZERO_NEGATIVE_BASELINE_VARIATION";

/**
 * Base interface for strata results.
 */
export interface StrataResultBase {
  n: number;
  errorMessage: string | null;
}

/**
 * Strata result for count/mean metrics.
 */
export interface StrataResultCount extends StrataResultBase {
  effect: number;
  controlMean: number;
  effectCov: number;
  controlMeanCov: number;
  effectControlMeanCov: number;
}

/**
 * Strata result for ratio metrics.
 */
export interface StrataResultRatio extends StrataResultBase {
  numeratorEffect: number;
  numeratorControlMean: number;
  denominatorEffect: number;
  denominatorControlMean: number;
  numeratorEffectCov: number;
  numeratorControlMeanCov: number;
  denominatorEffectCov: number;
  denominatorControlMeanCov: number;
  numeratorEffectNumeratorControlMeanCov: number;
  numeratorEffectDenominatorEffectCov: number;
  numeratorEffectDenominatorControlMeanCov: number;
  numeratorControlMeanDenominatorEffectCov: number;
  numeratorControlMeanDenominatorControlMeanCov: number;
  denominatorEffectDenominatorControlMeanCov: number;
}

/**
 * Configuration for effect moments calculation.
 */
export interface EffectMomentsConfig {
  differenceType: DifferenceType;
}

export const DEFAULT_EFFECT_MOMENTS_CONFIG: EffectMomentsConfig = {
  differenceType: "relative",
};

/**
 * Post-stratification summary for count/mean metrics.
 */
export class PostStratificationSummary {
  protected strataResults: StrataResultBase[];
  protected nuHat: number[];
  protected relative: boolean;
  private _alphaMatrix: number[][] | null = null;
  private _mean: number[] | null = null;
  private _covariance: number[][] | null = null;
  private _nabla: number[] | null = null;
  private _pointEstimate: number | null = null;
  private _estimatedVariance: number | null = null;

  constructor(
    strataResults: StrataResultBase[],
    nuHat: number[] | null = null,
    relative: boolean = true,
  ) {
    this.strataResults = strataResults;
    this.relative = relative;

    // Calculate nuHat from sample sizes if not provided
    if (nuHat === null) {
      const totalN = strataResults.reduce((sum, s) => sum + s.n, 0);
      this.nuHat = strataResults.map((s) => s.n / totalN);
    } else {
      this.nuHat = nuHat;
    }
  }

  get n(): number[] {
    return this.strataResults.map((s) => s.n);
  }

  get nTotal(): number {
    return this.n.reduce((sum, n) => sum + n, 0);
  }

  get lenAlpha(): number {
    return 2;
  }

  get numCells(): number {
    return this.strataResults.length;
  }

  /**
   * Alpha matrix: lenAlpha x numCells matrix of means.
   * Row 0: control_mean, Row 1: effect
   */
  get alphaMatrix(): number[][] {
    if (this._alphaMatrix === null) {
      const results = this.strataResults as StrataResultCount[];
      this._alphaMatrix = [
        results.map((s) => s.controlMean),
        results.map((s) => s.effect),
      ];
    }
    return this._alphaMatrix;
  }

  /**
   * Mean: alphaMatrix.dot(nuHat)
   */
  get mean(): number[] {
    if (this._mean === null) {
      this._mean = this.alphaMatrix.map((row) =>
        row.reduce((sum, val, i) => sum + val * this.nuHat[i], 0),
      );
    }
    return this._mean;
  }

  /**
   * Cell covariance matrix for a count result.
   */
  static cellCovarianceCount(stat: StrataResultCount): number[][] {
    return [
      [stat.controlMeanCov, stat.effectControlMeanCov],
      [stat.effectControlMeanCov, stat.effectCov],
    ];
  }

  /**
   * Calculate the covariance matrix of the weighted means of the alpha vectors.
   * Uses multinomial distribution for the cell proportions.
   */
  static covarianceOfMultinomialWeightedMeans(
    nTotal: number,
    alphaMatrix: number[][],
    alphaCov: number[][][],
    nu: number[],
  ): number[][] {
    const nuCov = multinomialCovariance(nu).map((row) =>
      row.map((v) => v / nTotal),
    );
    const lenAlpha = alphaMatrix.length;
    const numCells = alphaMatrix[0].length;

    // Part 1: alphaMatrix @ nuCov @ alphaMatrix.T
    // First compute alphaMatrix @ nuCov
    const alphaNuCov: number[][] = [];
    for (let i = 0; i < lenAlpha; i++) {
      const row: number[] = [];
      for (let j = 0; j < numCells; j++) {
        let sum = 0;
        for (let k = 0; k < numCells; k++) {
          sum += alphaMatrix[i][k] * nuCov[k][j];
        }
        row.push(sum);
      }
      alphaNuCov.push(row);
    }

    // Now compute (alphaMatrix @ nuCov) @ alphaMatrix.T
    const part1: number[][] = [];
    for (let i = 0; i < lenAlpha; i++) {
      const row: number[] = [];
      for (let j = 0; j < lenAlpha; j++) {
        let sum = 0;
        for (let k = 0; k < numCells; k++) {
          sum += alphaNuCov[i][k] * alphaMatrix[j][k];
        }
        row.push(sum);
      }
      part1.push(row);
    }

    // Part 2: sum of nu[cell] * alphaCov[cell] / nTotal
    const part2: number[][] = Array(lenAlpha)
      .fill(null)
      .map(() => Array(lenAlpha).fill(0));
    for (let cell = 0; cell < numCells; cell++) {
      for (let i = 0; i < lenAlpha; i++) {
        for (let j = 0; j < lenAlpha; j++) {
          part2[i][j] += (nu[cell] * alphaCov[cell][i][j]) / nTotal;
        }
      }
    }

    // Total covariance = part1 + part2
    const result: number[][] = [];
    for (let i = 0; i < lenAlpha; i++) {
      const row: number[] = [];
      for (let j = 0; j < lenAlpha; j++) {
        row.push(part1[i][j] + part2[i][j]);
      }
      result.push(row);
    }
    return result;
  }

  /**
   * Covariance matrix of the aggregated means.
   */
  get covariance(): number[][] {
    if (this._covariance === null) {
      const results = this.strataResults as StrataResultCount[];
      const alphaCov: number[][][] = results.map((s) =>
        PostStratificationSummary.cellCovarianceCount(s),
      );
      this._covariance =
        PostStratificationSummary.covarianceOfMultinomialWeightedMeans(
          this.nTotal,
          this.alphaMatrix,
          alphaCov,
          this.nuHat,
        );
    }
    return this._covariance;
  }

  /**
   * Gradient for transforming from [controlMean, effect] to point estimate.
   */
  get nabla(): number[] {
    if (this._nabla === null) {
      if (this.relative) {
        if (this.mean[0] === 0) {
          this._nabla = [0, 0];
        } else {
          this._nabla = [
            -this.mean[1] / Math.pow(this.mean[0], 2),
            1 / this.mean[0],
          ];
        }
      } else {
        this._nabla = [0, 1];
      }
    }
    return this._nabla;
  }

  /**
   * Point estimate of the effect.
   */
  get pointEstimate(): number {
    if (this._pointEstimate === null) {
      if (this.relative) {
        if (this.mean[0] === 0) {
          this._pointEstimate = 0;
        } else {
          this._pointEstimate = this.mean[1] / this.mean[0];
        }
      } else {
        this._pointEstimate = this.mean[1];
      }
    }
    return this._pointEstimate;
  }

  /**
   * Estimated variance of the point estimate.
   */
  get estimatedVariance(): number {
    if (this._estimatedVariance === null) {
      // nabla.T @ covariance @ nabla
      const cov = this.covariance;
      const n = this.nabla;
      let result = 0;
      for (let i = 0; i < this.lenAlpha; i++) {
        for (let j = 0; j < this.lenAlpha; j++) {
          result += n[i] * cov[i][j] * n[j];
        }
      }
      this._estimatedVariance = result;
    }
    return this._estimatedVariance;
  }

  /**
   * Unadjusted baseline mean (control mean).
   */
  get unadjustedBaselineMean(): number {
    return this.mean[0];
  }

  /**
   * Return uninformative output when analysis can't be performed.
   */
  protected defaultOutput(
    errorMessage: string | null = null,
  ): EffectMomentsResult {
    return {
      pointEstimate: 0,
      standardError: 0,
      pairwiseSampleSize: 0,
      errorMessage,
      postStratificationApplied: true,
    };
  }

  /**
   * Check if variance is zero or negative.
   */
  private hasZeroVariance(): boolean {
    return this.estimatedVariance <= 0;
  }

  computeResult(): EffectMomentsResult {
    if (this.hasZeroVariance()) {
      return this.defaultOutput(ZERO_NEGATIVE_VARIANCE_MESSAGE);
    }
    if (this.unadjustedBaselineMean === 0) {
      return this.defaultOutput(BASELINE_VARIATION_ZERO_MESSAGE);
    }
    return {
      pointEstimate: this.pointEstimate,
      standardError: Math.sqrt(this.estimatedVariance),
      pairwiseSampleSize: this.nTotal,
      errorMessage: null,
      postStratificationApplied: true,
    };
  }
}

/**
 * Post-stratification summary for ratio metrics.
 */
export class PostStratificationSummaryRatio extends PostStratificationSummary {
  private _alphaMatrixRatio: number[][] | null = null;
  private _meanRatio: number[] | null = null;
  private _covarianceRatio: number[][] | null = null;
  private _nablaRatio: number[] | null = null;
  private _pointEstimateRatio: number | null = null;
  private _estimatedVarianceRatio: number | null = null;

  constructor(
    strataResults: StrataResultRatio[],
    nuHat: number[] | null = null,
    relative: boolean = true,
  ) {
    super(strataResults, nuHat, relative);
  }

  override get lenAlpha(): number {
    return 4;
  }

  /**
   * Alpha matrix: 4 x numCells matrix of means.
   * Row 0: numerator_control_mean
   * Row 1: numerator_effect
   * Row 2: denominator_control_mean
   * Row 3: denominator_effect
   */
  override get alphaMatrix(): number[][] {
    if (this._alphaMatrixRatio === null) {
      const results = this.strataResults as StrataResultRatio[];
      this._alphaMatrixRatio = [
        results.map((s) => s.numeratorControlMean),
        results.map((s) => s.numeratorEffect),
        results.map((s) => s.denominatorControlMean),
        results.map((s) => s.denominatorEffect),
      ];
    }
    return this._alphaMatrixRatio;
  }

  /**
   * Mean: alphaMatrix.dot(nuHat)
   */
  override get mean(): number[] {
    if (this._meanRatio === null) {
      this._meanRatio = this.alphaMatrix.map((row) =>
        row.reduce((sum, val, i) => sum + val * this.nuHat[i], 0),
      );
    }
    return this._meanRatio;
  }

  /**
   * Cell covariance matrix for a ratio result.
   */
  static cellCovarianceRatio(stat: StrataResultRatio): number[][] {
    return [
      [
        stat.numeratorControlMeanCov,
        stat.numeratorEffectNumeratorControlMeanCov,
        stat.numeratorControlMeanDenominatorControlMeanCov,
        stat.numeratorControlMeanDenominatorEffectCov,
      ],
      [
        stat.numeratorEffectNumeratorControlMeanCov,
        stat.numeratorEffectCov,
        stat.numeratorEffectDenominatorControlMeanCov,
        stat.numeratorEffectDenominatorEffectCov,
      ],
      [
        stat.numeratorControlMeanDenominatorControlMeanCov,
        stat.numeratorEffectDenominatorControlMeanCov,
        stat.denominatorControlMeanCov,
        stat.denominatorEffectDenominatorControlMeanCov,
      ],
      [
        stat.numeratorControlMeanDenominatorEffectCov,
        stat.numeratorEffectDenominatorEffectCov,
        stat.denominatorEffectDenominatorControlMeanCov,
        stat.denominatorEffectCov,
      ],
    ];
  }

  /**
   * Covariance matrix of the aggregated means.
   */
  override get covariance(): number[][] {
    if (this._covarianceRatio === null) {
      const results = this.strataResults as StrataResultRatio[];
      const alphaCov: number[][][] = results.map((s) =>
        PostStratificationSummaryRatio.cellCovarianceRatio(s),
      );
      this._covarianceRatio =
        PostStratificationSummary.covarianceOfMultinomialWeightedMeans(
          this.nTotal,
          this.alphaMatrix,
          alphaCov,
          this.nuHat,
        );
    }
    return this._covarianceRatio;
  }

  /**
   * Helper values for relative point estimate calculation.
   */
  get pointEstimateRelNumerator(): number {
    return this.mean[2] * (this.mean[0] + this.mean[1]);
  }

  get pointEstimateRelDenominator(): number {
    return this.mean[0] * (this.mean[2] + this.mean[3]);
  }

  /**
   * Gradient for transforming to point estimate.
   */
  override get nabla(): number[] {
    if (this._nablaRatio === null) {
      const nabla = [0, 0, 0, 0];

      if (this.relative) {
        if (this.mean[0] === 0) {
          this._nablaRatio = [0, 0, 0, 0];
          return this._nablaRatio;
        }
        nabla[0] =
          (this.mean[2] * this.pointEstimateRelDenominator -
            (this.mean[2] + this.mean[3]) * this.pointEstimateRelNumerator) /
          Math.pow(this.pointEstimateRelDenominator, 2);
        nabla[1] = this.mean[2] / this.pointEstimateRelDenominator;
        nabla[2] =
          ((this.mean[0] + this.mean[1]) * this.pointEstimateRelDenominator -
            this.mean[0] * this.pointEstimateRelNumerator) /
          Math.pow(this.pointEstimateRelDenominator, 2);
        nabla[3] =
          -this.pointEstimateRelNumerator /
          (this.mean[0] * Math.pow(this.mean[2] + this.mean[3], 2));
      } else {
        if (this.mean[2] === 0 || this.mean[2] + this.mean[3] === 0) {
          this._nablaRatio = [0, 0, 0, 0];
          return this._nablaRatio;
        }
        nabla[1] = 1 / (this.mean[2] + this.mean[3]);
        nabla[0] = nabla[1] - 1 / this.mean[2];
        nabla[3] =
          -(this.mean[0] + this.mean[1]) /
          Math.pow(this.mean[2] + this.mean[3], 2);
        nabla[2] = nabla[3] + this.mean[0] / Math.pow(this.mean[2], 2);
      }
      this._nablaRatio = nabla;
    }
    return this._nablaRatio;
  }

  /**
   * Point estimate of the effect.
   */
  override get pointEstimate(): number {
    if (this._pointEstimateRatio === null) {
      if (this.relative) {
        if (this.pointEstimateRelDenominator === 0) {
          this._pointEstimateRatio = 0;
        } else {
          this._pointEstimateRatio =
            this.pointEstimateRelNumerator / this.pointEstimateRelDenominator -
            1;
        }
      } else {
        const mnTrtNum = this.mean[0] + this.mean[1];
        const mnTrtDen = this.mean[2] + this.mean[3];
        const mnCtrlNum = this.mean[0];
        const mnCtrlDen = this.mean[2];
        if (mnTrtDen === 0 || mnCtrlDen === 0) {
          this._pointEstimateRatio = 0;
        } else {
          this._pointEstimateRatio =
            mnTrtNum / mnTrtDen - mnCtrlNum / mnCtrlDen;
        }
      }
    }
    return this._pointEstimateRatio;
  }

  /**
   * Estimated variance of the point estimate.
   */
  override get estimatedVariance(): number {
    if (this._estimatedVarianceRatio === null) {
      const cov = this.covariance;
      const n = this.nabla;
      let result = 0;
      for (let i = 0; i < this.lenAlpha; i++) {
        for (let j = 0; j < this.lenAlpha; j++) {
          result += n[i] * cov[i][j] * n[j];
        }
      }
      this._estimatedVarianceRatio = result;
    }
    return this._estimatedVarianceRatio;
  }

  /**
   * Unadjusted baseline mean for ratio metrics.
   */
  override get unadjustedBaselineMean(): number {
    if (this.mean[2] === 0) {
      return 0;
    }
    return this.mean[0] / this.mean[2];
  }

  override computeResult(): EffectMomentsResult {
    if (this.estimatedVariance <= 0) {
      return this.defaultOutput(ZERO_NEGATIVE_VARIANCE_MESSAGE);
    }
    if (this.unadjustedBaselineMean === 0) {
      return this.defaultOutput(BASELINE_VARIATION_ZERO_MESSAGE);
    }
    return {
      pointEstimate: this.pointEstimate,
      standardError: Math.sqrt(this.estimatedVariance),
      pairwiseSampleSize: this.nTotal,
      errorMessage: null,
      postStratificationApplied: true,
    };
  }
}

/**
 * Main class for post-stratified effect moments calculation.
 * Handles variance reduction through stratification in A/B tests.
 */
export class EffectMomentsPostStratification {
  private stats: Array<[TestStatistic, TestStatistic]>;
  private relative: boolean;

  constructor(
    stats: Array<[TestStatistic, TestStatistic]>,
    config: EffectMomentsConfig = DEFAULT_EFFECT_MOMENTS_CONFIG,
  ) {
    this.stats = stats;
    this.relative = config.differenceType === "relative";
  }

  /**
   * Return uninformative output when analysis can't be performed.
   */
  private defaultOutput(
    errorMessage: string | null = null,
  ): EffectMomentsResult {
    return {
      pointEstimate: 0,
      standardError: 0,
      pairwiseSampleSize: 0,
      errorMessage,
      postStratificationApplied: true,
    };
  }

  /**
   * Check if any variance is zero or negative.
   */
  private static hasZeroVariance(
    statA: TestStatistic,
    statB: TestStatistic,
  ): boolean {
    return statA.hasZeroVariance || statB.hasZeroVariance;
  }

  /**
   * Check if a cell has enough data for analysis.
   */
  private static isCellViable(
    statA: TestStatistic,
    statB: TestStatistic,
  ): boolean {
    if (EffectMomentsPostStratification.hasZeroVariance(statA, statB)) {
      return false;
    }
    // Need 7 units per cell to run CUPED post-stratification on ratio metrics
    if (
      statA instanceof RegressionAdjustedRatioStatistic ||
      statB instanceof RegressionAdjustedRatioStatistic
    ) {
      if (statA.n + statB.n <= 6) {
        return false;
      }
    }
    return true;
  }

  /**
   * Combine cells that don't have enough data into larger cells.
   */
  static combineCellsForAnalysis<T extends Statistic>(
    stats: Array<[T, T]>,
  ): Array<[T, T]> {
    // Sort cells from largest to smallest by number of users
    const sortedCells = [...stats].sort(
      (a, b) => b[0].n + b[1].n - (a[0].n + a[1].n),
    );

    const cellsForAnalysis = [sortedCells[0]];

    for (let i = 1; i < sortedCells.length; i++) {
      if (
        EffectMomentsPostStratification.isCellViable(
          sortedCells[i][0] as unknown as TestStatistic,
          sortedCells[i][1] as unknown as TestStatistic,
        )
      ) {
        cellsForAnalysis.push(sortedCells[i]);
      } else {
        // Combine cells that cannot compute stats independently with the largest cell
        const combined = sumStats([
          cellsForAnalysis[0],
          sortedCells[i],
        ] as Array<[T, T]>);
        cellsForAnalysis[0] = combined;
      }
    }

    return cellsForAnalysis;
  }

  /**
   * Compute the effect moments result with post-stratification.
   */
  computeResult(): EffectMomentsResult {
    // Sum all stats to check overall validity
    const [statA, statB] = sumStats(this.stats);

    // Check for zero/negative variance
    if (EffectMomentsPostStratification.hasZeroVariance(statA, statB)) {
      return this.defaultOutput(ZERO_NEGATIVE_VARIANCE_MESSAGE);
    }

    // Check for baseline zero
    // For RegressionAdjustedRatioStatistic, mean can be 0 when pre-period data is missing
    // but unadjustedMean (post-period only) may still be valid. In this case, the per-cell
    // fallback logic will handle it, so we only check unadjustedMean.
    if (
      !(statA instanceof RegressionAdjustedRatioStatistic) &&
      statA.mean === 0
    ) {
      return this.defaultOutput(BASELINE_VARIATION_ZERO_MESSAGE);
    }
    if (statA.unadjustedMean === 0) {
      return this.defaultOutput(BASELINE_VARIATION_ZERO_MESSAGE);
    }

    // Combine cells that don't have enough data
    const cellsForAnalysis =
      EffectMomentsPostStratification.combineCellsForAnalysis(this.stats);

    // If only one cell after combining, use regular EffectMoments (single-cell case)
    if (cellsForAnalysis.length === 1) {
      const [cellA, cellB] = cellsForAnalysis[0];
      const [adjustedA, adjustedB] = createThetaAdjustedStatistics(
        cellA,
        cellB,
      );

      return new EffectMoments([[adjustedA, adjustedB]], {
        differenceType: this.relative ? "relative" : "absolute",
      }).computeResult();
    }

    // Multi-cell case: compute strata results and aggregate
    const strataResults: (StrataResultCount | StrataResultRatio)[] = [];
    for (const cell of cellsForAnalysis) {
      const cellResult = this.computeStrataResult(cell);
      if (cellResult.errorMessage !== null) {
        return this.defaultOutput(cellResult.errorMessage);
      }
      strataResults.push(cellResult);
    }

    // Check if we have ratio-type results
    if (this.isRatioResult(strataResults[0])) {
      return new PostStratificationSummaryRatio(
        strataResults as StrataResultRatio[],
        null,
        this.relative,
      ).computeResult();
    } else {
      return new PostStratificationSummary(
        strataResults as StrataResultCount[],
        null,
        this.relative,
      ).computeResult();
    }
  }

  /**
   * Check if a strata result is a ratio type.
   */
  private isRatioResult(
    result: StrataResultCount | StrataResultRatio,
  ): result is StrataResultRatio {
    return "numeratorEffect" in result;
  }

  /**
   * Compute strata result for a single cell.
   */
  computeStrataResult(
    statPair: [TestStatistic, TestStatistic],
  ): StrataResultCount | StrataResultRatio {
    const [statA, statB] = statPair;

    // Dispatch based on statistic type
    if (
      (statA instanceof ProportionStatistic ||
        statA instanceof SampleMeanStatistic) &&
      (statB instanceof ProportionStatistic ||
        statB instanceof SampleMeanStatistic)
    ) {
      return CreateStrataResult.computeResult(statA, statB);
    } else if (
      statA instanceof RegressionAdjustedStatistic &&
      statB instanceof RegressionAdjustedStatistic
    ) {
      return CreateStrataResultRegressionAdjusted.computeResult(statA, statB);
    } else if (
      statA instanceof RatioStatistic &&
      statB instanceof RatioStatistic
    ) {
      return CreateStrataResultRatio.computeResult(statA, statB);
    } else if (
      statA instanceof RegressionAdjustedRatioStatistic &&
      statB instanceof RegressionAdjustedRatioStatistic
    ) {
      return CreateStrataResultRegressionAdjustedRatio.computeResult(
        statA,
        statB,
      );
    } else {
      throw new Error("Invalid statistic pair for strata result");
    }
  }
}

/**
 * Calculate variance for relative RegressionAdjustedStatistic (CUPED).
 */
function frequentistVarianceRelativeCuped(
  statA: RegressionAdjustedStatistic,
  statB: RegressionAdjustedStatistic,
): number {
  const denTrt = statB.n * Math.pow(statA.unadjustedMean, 2);
  const denCtrl = statA.n * Math.pow(statA.unadjustedMean, 2);
  if (denTrt === 0 || denCtrl === 0) {
    return 0;
  }

  const theta = statA.theta ?? 0;

  const numTrt =
    statB.postStatistic.variance +
    Math.pow(theta, 2) * statB.preStatistic.variance -
    2 * theta * statB.covariance;
  const vTrt = numTrt / denTrt;

  const constVal = -statB.postStatistic.mean;
  const numA =
    (statA.postStatistic.variance * Math.pow(constVal, 2)) /
    Math.pow(statA.postStatistic.mean, 2);
  const numB =
    (2 * theta * statA.covariance * constVal) / statA.postStatistic.mean;
  const numC = Math.pow(theta, 2) * statA.preStatistic.variance;
  const vCtrl = (numA + numB + numC) / denCtrl;

  return vTrt + vCtrl;
}

/**
 * Calculate variance for relative RegressionAdjustedRatioStatistic (CUPED ratio).
 */
function frequentistVarianceRelativeCupedRatio(
  statA: RegressionAdjustedRatioStatistic,
  statB: RegressionAdjustedRatioStatistic,
): number {
  if (statA.unadjustedMean === 0 || statA.dStatisticPost.mean === 0) {
    return 0;
  }

  const gAbs = statB.mean - statA.mean;
  const gRelDen = Math.abs(statA.unadjustedMean);

  const nablaCtrl0Num = -(gRelDen + gAbs) / statA.dStatisticPost.mean;
  const nablaCtrl0Den = Math.pow(gRelDen, 2);
  const nablaCtrl0 = nablaCtrl0Num / nablaCtrl0Den;

  const nablaCtrl1Num =
    (statA.mStatisticPost.mean * gRelDen) /
      Math.pow(statA.dStatisticPost.mean, 2) +
    (statA.mStatisticPost.mean * gAbs) / Math.pow(statA.dStatisticPost.mean, 2);
  const nablaCtrl1Den = Math.pow(gRelDen, 2);
  const nablaCtrl1 = nablaCtrl1Num / nablaCtrl1Den;

  const nablaA: [number, number, number, number] = [
    nablaCtrl0,
    nablaCtrl1,
    -statA.nabla[2] / gRelDen,
    -statA.nabla[3] / gRelDen,
  ];

  const nablaB: [number, number, number, number] = [
    statB.nabla[0] / gRelDen,
    statB.nabla[1] / gRelDen,
    statB.nabla[2] / gRelDen,
    statB.nabla[3] / gRelDen,
  ];

  // Compute nablaA.T @ statA.lambdaMatrix @ nablaA
  const lambdaA = statA.lambdaMatrix;
  const lambdaB = statB.lambdaMatrix;

  // Helper function for nabla.T @ lambda @ nabla
  const quadraticForm = (nabla: number[], lambda: number[][]): number => {
    let result = 0;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        result += nabla[i] * lambda[i][j] * nabla[j];
      }
    }
    return result;
  };

  const termA = quadraticForm(nablaA, lambdaA) / statA.n;
  const termB = quadraticForm(nablaB, lambdaB) / statB.n;

  return termA + termB;
}

/**
 * Calculate the variance based on statistic types.
 */
function frequentistVarianceAllCases(
  statA: TestStatistic,
  statB: TestStatistic,
  relative: boolean,
): number {
  if (
    statA instanceof RegressionAdjustedStatistic &&
    statB instanceof RegressionAdjustedStatistic &&
    relative
  ) {
    return frequentistVarianceRelativeCuped(statA, statB);
  } else if (
    statA instanceof RegressionAdjustedRatioStatistic &&
    statB instanceof RegressionAdjustedRatioStatistic &&
    relative
  ) {
    return frequentistVarianceRelativeCupedRatio(statA, statB);
  } else {
    return frequentistVarianceBasic(statA, statB, relative);
  }
}

/**
 * Calculate the frequentist difference between two means.
 */
function frequentistDiff(
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
 * Calculate the basic variance of the difference between two groups.
 *
 * For relative effects, uses the delta method for the variance of a ratio.
 * The relative effect is (meanB - meanA) / meanA = meanB/meanA - 1,
 * so its variance equals the variance of meanB/meanA.
 *
 * Using variance_of_ratios(meanM, varM, meanD, varD, covMD):
 *   = varM/meanD^2 + varD*meanM^2/meanD^4 - 2*covMD*meanM/meanD^3
 *
 * With meanM=meanB, varM=varB/nB, meanD=meanA, varD=varA/nA, covMD=0:
 *   = (varB/nB)/meanA^2 + (varA/nA)*meanB^2/meanA^4
 */
function frequentistVarianceBasic(
  statA: TestStatistic,
  statB: TestStatistic,
  relative: boolean,
): number {
  const varA = statA.variance;
  const varB = statB.variance;
  const nA = statA.n;
  const nB = statB.n;
  const meanA = statA.mean;
  const meanB = statB.mean;

  if (relative) {
    // Use the unadjusted mean as baseline for CUPED statistics
    const baseline = statA.unadjustedMean ?? meanA;
    if (baseline === 0) {
      return 0;
    }
    // Delta method: variance of meanB/meanA
    // = (varB/nB)/meanA^2 + (varA/nA)*meanB^2/meanA^4
    return (
      varB / nB / Math.pow(baseline, 2) +
      ((varA / nA) * Math.pow(meanB, 2)) / Math.pow(baseline, 4)
    );
  }
  return varB / nB + varA / nA;
}

/**
 * Check if a statistic has zero or negative variance.
 */
function hasZeroVariance(stat: TestStatistic): boolean {
  if (stat.n <= 1) return true;
  return stat.variance <= 0;
}

/**
 * Effect moments calculation without post-stratification.
 */
export class EffectMoments {
  private stats: Array<[TestStatistic, TestStatistic]>;
  private relative: boolean;
  private statA: TestStatistic;
  private statB: TestStatistic;

  constructor(
    stats: Array<[TestStatistic, TestStatistic]>,
    config: EffectMomentsConfig = DEFAULT_EFFECT_MOMENTS_CONFIG,
  ) {
    this.stats = stats;
    this.relative = config.differenceType === "relative";
    // Sum the statistics from all cells
    const [sumA, sumB] = sumStats(stats);
    this.statA = sumA;
    this.statB = sumB;
  }

  /**
   * Return uninformative output when analysis can't be performed.
   */
  private defaultOutput(
    errorMessage: string | null = null,
  ): EffectMomentsResult {
    return {
      pointEstimate: 0,
      standardError: 0,
      pairwiseSampleSize: 0,
      errorMessage,
      postStratificationApplied: false,
    };
  }

  /**
   * Get the point estimate (effect size).
   */
  get pointEstimate(): number {
    return frequentistDiff(
      this.statA.mean,
      this.statB.mean,
      this.relative,
      this.statA.unadjustedMean,
    );
  }

  /**
   * Get the variance of the effect.
   */
  get variance(): number {
    return frequentistVarianceAllCases(this.statA, this.statB, this.relative);
  }

  /**
   * Check if any variance is zero or negative.
   */
  private hasZeroVarianceCheck(): boolean {
    return (
      hasZeroVariance(this.statA) ||
      hasZeroVariance(this.statB) ||
      this.variance <= 0
    );
  }

  /**
   * Compute the effect moments result.
   */
  computeResult(): EffectMomentsResult {
    // Check for zero/negative variance
    if (this.hasZeroVarianceCheck()) {
      return this.defaultOutput(ZERO_NEGATIVE_VARIANCE_MESSAGE);
    }

    // Check for baseline variation with zero mean
    if (this.statA.mean === 0) {
      return this.defaultOutput(BASELINE_VARIATION_ZERO_MESSAGE);
    }
    if (this.statA.unadjustedMean === 0) {
      return this.defaultOutput(BASELINE_VARIATION_ZERO_MESSAGE);
    }

    // Check type consistency for regression adjusted statistics
    if (this.statA instanceof RegressionAdjustedStatistic) {
      if (!(this.statB instanceof RegressionAdjustedStatistic)) {
        return this.defaultOutput(
          "If stat_a is a RegressionAdjustedStatistic, stat_b must be as well",
        );
      }
    }
    if (this.statB instanceof RegressionAdjustedStatistic) {
      if (!(this.statA instanceof RegressionAdjustedStatistic)) {
        return this.defaultOutput(
          "If stat_b is a RegressionAdjustedStatistic, stat_a must be as well",
        );
      }
    }

    return {
      pointEstimate: this.pointEstimate,
      standardError: Math.sqrt(this.variance),
      pairwiseSampleSize: this.statA.n + this.statB.n,
      errorMessage: null,
      postStratificationApplied: false,
    };
  }
}

/**
 * Calculate multinomial covariance matrix.
 */
export function multinomialCovariance(nu: number[]): number[][] {
  const k = nu.length;
  const cov: number[][] = Array(k)
    .fill(null)
    .map(() => Array(k).fill(0));

  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      if (i === j) {
        cov[i][j] = nu[i] * (1 - nu[i]);
      } else {
        cov[i][j] = -nu[i] * nu[j];
      }
    }
  }

  return cov;
}

// ==============================================================
// CreateStrataResult Helper Classes
// ==============================================================

/**
 * Create strata result for count/mean metrics.
 */
export class CreateStrataResult {
  static computeResult(
    statA: SampleMeanStatistic | ProportionStatistic,
    statB: SampleMeanStatistic | ProportionStatistic,
  ): StrataResultCount {
    const n = statA.n + statB.n;

    if (n <= 1 || statA.variance <= 0 || statB.variance <= 0) {
      return this.defaultOutput(ZERO_NEGATIVE_VARIANCE_MESSAGE);
    }

    // Regression coefficients are just the means
    const effect = statB.mean - statA.mean;
    const controlMean = statA.mean;

    // Variance of coefficients
    const effectCov =
      (statB.variance * n) / statB.n + (statA.variance * n) / statA.n;
    const controlMeanCov = (statA.variance * n) / statA.n;

    // Covariance between effect and control mean
    const effectControlMeanCov = (-statA.variance * n) / statA.n;

    return {
      n,
      effect,
      controlMean,
      effectCov,
      controlMeanCov,
      effectControlMeanCov,
      errorMessage: null,
    };
  }

  static defaultOutput(errorMessage: string | null = null): StrataResultCount {
    return {
      n: 0,
      effect: 0,
      controlMean: 0,
      effectCov: 0,
      controlMeanCov: 0,
      effectControlMeanCov: 0,
      errorMessage,
    };
  }
}

/**
 * Create strata result for regression adjusted (CUPED) count/mean metrics.
 * Uses OLS regression approach from Python gbstats Algorithm 1 (RA version).
 */
export class CreateStrataResultRegressionAdjusted {
  static computeResult(
    statA: RegressionAdjustedStatistic,
    statB: RegressionAdjustedStatistic,
  ): StrataResultCount {
    const nA = statA.n;
    const nB = statB.n;
    const n = nA + nB;

    // Check for zero variance
    if (statA.hasZeroVariance || statB.hasZeroVariance) {
      return CreateStrataResult.defaultOutput(ZERO_NEGATIVE_VARIANCE_MESSAGE);
    }

    // Check for baseline covariance zero (pre-period variance)
    if (statA.preStatistic.variance <= 0 || statB.preStatistic.variance <= 0) {
      // Fallback to non-RA result
      return CreateStrataResult.computeResult(
        statA.postStatistic as SampleMeanStatistic | ProportionStatistic,
        statB.postStatistic as SampleMeanStatistic | ProportionStatistic,
      );
    }

    // Build XTX matrix (3x3 design matrix product)
    const preStatA = statA.preStatistic as SampleMeanStatistic;
    const preStatB = statB.preStatistic as SampleMeanStatistic;
    const preSumSquares = preStatA.sumSquares + preStatB.sumSquares;
    const preSum = preStatA.sum + preStatB.sum;

    const xtx: number[][] = [
      [n, nB, preSum],
      [nB, nB, preStatB.sum],
      [preSum, preStatB.sum, preSumSquares],
    ];

    // Invert XTX
    const xtxInv = invertSymmetric3x3(xtx);
    if (xtxInv === null) {
      return CreateStrataResult.defaultOutput("XTX matrix inversion failed");
    }

    // Build XTY vector
    const postSumA = statA.postStatistic.sum;
    const postSumB = statB.postStatistic.sum;
    const sumOfProducts =
      statA.postPreSumOfProducts + statB.postPreSumOfProducts;
    const xty = [postSumA + postSumB, postSumB, sumOfProducts];

    // Compute regression coefficients: gamma = XTX^{-1} @ XTY
    const gamma = matVec3(xtxInv, xty);

    // Compute sigma (residual variance) - scalar for count metrics
    const postStatA = statA.postStatistic as SampleMeanStatistic;
    const postStatB = statB.postStatistic as SampleMeanStatistic;
    const postSumSquares = postStatA.sumSquares + postStatB.sumSquares;
    const residsP1 = postSumSquares;
    const residsP2 = -dot3(xty, matVec3(xtxInv, xty));
    const sigma = (residsP1 + residsP2) / (n - 3);

    // Coefficient covariance = sigma * XTX^{-1}
    const coefCov = xtxInv.map((row) => row.map((v) => sigma * v));

    // Baseline mean and variance
    const baselineMean = preSum / n;
    const baselineVariance = (preSumSquares - (preSum * preSum) / n) / (n - 1);

    // Contrast matrix: [[1, 0, baseline_mean], [0, 1, 0]]
    // mean[0] = control_mean = gamma[0] + baseline_mean * gamma[2]
    // mean[1] = effect = gamma[1]
    const controlMean = gamma[0] + baselineMean * gamma[2];
    const effect = gamma[1];

    // Compute adjusted covariance using the formula from Python
    const covariance = CreateStrataResultRegressionAdjusted.covarianceAdjusted(
      n,
      coefCov,
      baselineMean,
      gamma,
      baselineVariance,
    );

    return {
      n,
      effect,
      controlMean,
      effectCov: covariance[1][1],
      controlMeanCov: covariance[0][0],
      effectControlMeanCov: covariance[0][1],
      errorMessage: null,
    };
  }

  /**
   * Compute adjusted covariance matrix for regression coefficients.
   * Accounts for uncertainty in baseline mean estimation.
   */
  static covarianceAdjusted(
    n: number,
    coefCov: number[][],
    baselineMean: number,
    gamma: number[],
    baselineVariance: number,
  ): number[][] {
    // contrast_matrix = [[1, 0, baseline_mean], [0, 1, 0]]
    // We need to compute the variance of contrast_matrix @ gamma
    // accounting for the fact that baseline_mean is estimated.

    // The second moment matrices for (i, j) indices:
    // contrast_matrix_estimated_mean(i) = row i of contrast matrix as column vector
    // contrast_matrix_covariance(i, j) adds baseline_variance/n to element (2,2) if i=j=0

    // For simplicity, we compute the covariance matrix directly:
    // V[0,0] = variance of gamma[0] + baseline_mean * gamma[2]
    // V[1,1] = variance of gamma[1]
    // V[0,1] = covariance

    // V[0,0] = coefCov[0,0] + 2*baseline_mean*coefCov[0,2] + baseline_mean^2*coefCov[2,2]
    //        + gamma[2]^2 * baseline_variance / n
    const v00 =
      coefCov[0][0] +
      2 * baselineMean * coefCov[0][2] +
      baselineMean * baselineMean * coefCov[2][2] +
      (gamma[2] * gamma[2] * baselineVariance) / n;

    // V[1,1] = coefCov[1,1]
    const v11 = coefCov[1][1];

    // V[0,1] = coefCov[0,1] + baseline_mean * coefCov[1,2]
    const v01 = coefCov[0][1] + baselineMean * coefCov[1][2];

    // Scale by n for the strata result format
    return [
      [n * v00, n * v01],
      [n * v01, n * v11],
    ];
  }
}

/**
 * Helper: Invert a symmetric 3x3 matrix.
 * Returns null if matrix is singular.
 */
function invertSymmetric3x3(m: number[][]): number[][] | null {
  const a = m[0][0],
    b = m[0][1],
    c = m[0][2];
  const d = m[1][1],
    e = m[1][2];
  const f = m[2][2];

  // Compute determinant
  const det = a * (d * f - e * e) - b * (b * f - c * e) + c * (b * e - c * d);
  if (Math.abs(det) < 1e-15) {
    return null;
  }

  // Compute adjugate and divide by determinant
  const invDet = 1 / det;
  return [
    [
      (d * f - e * e) * invDet,
      (c * e - b * f) * invDet,
      (b * e - c * d) * invDet,
    ],
    [
      (c * e - b * f) * invDet,
      (a * f - c * c) * invDet,
      (b * c - a * e) * invDet,
    ],
    [
      (b * e - c * d) * invDet,
      (b * c - a * e) * invDet,
      (a * d - b * b) * invDet,
    ],
  ];
}

/**
 * Helper: Matrix-vector multiply for 3x3 matrix and 3-vector.
 */
function matVec3(m: number[][], v: number[]): number[] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/**
 * Helper: Dot product of 3-vectors.
 */
function dot3(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Create strata result for ratio metrics.
 */
export class CreateStrataResultRatio {
  static computeResult(
    statA: RatioStatistic,
    statB: RatioStatistic,
  ): StrataResultRatio {
    const n = statA.n + statB.n;

    if (n <= 1 || statA.dStatistic.mean === 0 || statB.dStatistic.mean === 0) {
      return this.defaultOutput(ZERO_NEGATIVE_VARIANCE_MESSAGE);
    }

    // Lambda matrices (2x2 covariance matrices)
    const lambdaA = [
      [statA.mStatistic.variance, statA.covariance],
      [statA.covariance, statA.dStatistic.variance],
    ];
    const lambdaB = [
      [statB.mStatistic.variance, statB.covariance],
      [statB.covariance, statB.dStatistic.variance],
    ];

    // Regression coefficients (means)
    const numeratorEffect = statB.mStatistic.mean - statA.mStatistic.mean;
    const numeratorControlMean = statA.mStatistic.mean;
    const denominatorEffect = statB.dStatistic.mean - statA.dStatistic.mean;
    const denominatorControlMean = statA.dStatistic.mean;

    // Compute V matrix (covariance of regression coefficients)
    // V = [ lambda_b * n/n_b,  0               ]
    //     [ 0,                 lambda_a * n/n_a ]
    const scaledLambdaA = lambdaA.map((row) =>
      row.map((x) => (x * n) / statA.n),
    );
    const scaledLambdaB = lambdaB.map((row) =>
      row.map((x) => (x * n) / statB.n),
    );

    // Contrast matrix: [[0,0,1,0], [1,0,-1,0], [0,0,0,1], [0,1,0,-1]]
    // After applying contrast, we get covariances for numerator and denominator effects/control means
    const numeratorEffectCov = scaledLambdaB[0][0] + scaledLambdaA[0][0];
    const numeratorControlMeanCov = scaledLambdaA[0][0];
    const denominatorEffectCov = scaledLambdaB[1][1] + scaledLambdaA[1][1];
    const denominatorControlMeanCov = scaledLambdaA[1][1];

    const numeratorEffectNumeratorControlMeanCov = -scaledLambdaA[0][0];
    const numeratorEffectDenominatorEffectCov =
      scaledLambdaB[0][1] + scaledLambdaA[0][1];
    const numeratorEffectDenominatorControlMeanCov = -scaledLambdaA[0][1];
    const numeratorControlMeanDenominatorEffectCov = -scaledLambdaA[0][1];
    const numeratorControlMeanDenominatorControlMeanCov = scaledLambdaA[0][1];
    const denominatorEffectDenominatorControlMeanCov = -scaledLambdaA[1][1];

    return {
      n,
      numeratorEffect,
      numeratorControlMean,
      denominatorEffect,
      denominatorControlMean,
      numeratorEffectCov,
      numeratorControlMeanCov,
      denominatorEffectCov,
      denominatorControlMeanCov,
      numeratorEffectNumeratorControlMeanCov,
      numeratorEffectDenominatorEffectCov,
      numeratorEffectDenominatorControlMeanCov,
      numeratorControlMeanDenominatorEffectCov,
      numeratorControlMeanDenominatorControlMeanCov,
      denominatorEffectDenominatorControlMeanCov,
      errorMessage: null,
    };
  }

  static defaultOutput(errorMessage: string | null = null): StrataResultRatio {
    return {
      n: 0,
      numeratorEffect: 0,
      numeratorControlMean: 0,
      denominatorEffect: 0,
      denominatorControlMean: 0,
      numeratorEffectCov: 0,
      numeratorControlMeanCov: 0,
      denominatorEffectCov: 0,
      denominatorControlMeanCov: 0,
      numeratorEffectNumeratorControlMeanCov: 0,
      numeratorEffectDenominatorEffectCov: 0,
      numeratorEffectDenominatorControlMeanCov: 0,
      numeratorControlMeanDenominatorEffectCov: 0,
      numeratorControlMeanDenominatorControlMeanCov: 0,
      denominatorEffectDenominatorControlMeanCov: 0,
      errorMessage,
    };
  }
}

/**
 * Create strata result for regression adjusted ratio metrics.
 * Uses full OLS approach from Python gbstats Algorithm 2 (RA ratio version).
 */
export class CreateStrataResultRegressionAdjustedRatio {
  private statA: RegressionAdjustedRatioStatistic;
  private statB: RegressionAdjustedRatioStatistic;
  private nA: number;
  private nB: number;
  private n: number;

  constructor(
    statA: RegressionAdjustedRatioStatistic,
    statB: RegressionAdjustedRatioStatistic,
  ) {
    this.statA = statA;
    this.statB = statB;
    this.nA = statA.n;
    this.nB = statB.n;
    this.n = this.nA + this.nB;
  }

  static computeResult(
    statA: RegressionAdjustedRatioStatistic,
    statB: RegressionAdjustedRatioStatistic,
  ): StrataResultRatio {
    return new CreateStrataResultRegressionAdjustedRatio(
      statA,
      statB,
    ).computeResult();
  }

  /**
   * Check if baseline covariance is zero (pre-period variance).
   */
  private baselineCovarianceZero(): boolean {
    return (
      this.statA.mStatisticPre.variance <= 0 ||
      this.statB.mStatisticPre.variance <= 0 ||
      this.statA.dStatisticPre.variance <= 0 ||
      this.statB.dStatisticPre.variance <= 0
    );
  }

  /**
   * Check if any variance is zero.
   */
  private hasZeroVariance(): boolean {
    return this.statA.hasZeroVariance || this.statB.hasZeroVariance;
  }

  /**
   * Build the 4x4 X'X information matrix.
   */
  private get xtx(): number[][] {
    const xtx: number[][] = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    xtx[0][0] = this.nA + this.nB;
    xtx[1][1] = this.nB;
    xtx[2][2] =
      this.statA.mStatisticPre.sumSquares + this.statB.mStatisticPre.sumSquares;
    xtx[3][3] =
      this.statA.dStatisticPre.sumSquares + this.statB.dStatisticPre.sumSquares;
    xtx[0][1] = xtx[1][0] = this.nB;
    xtx[0][2] = xtx[2][0] =
      this.statA.mStatisticPre.sum + this.statB.mStatisticPre.sum;
    xtx[0][3] = xtx[3][0] =
      this.statA.dStatisticPre.sum + this.statB.dStatisticPre.sum;
    xtx[1][2] = xtx[2][1] = this.statB.mStatisticPre.sum;
    xtx[1][3] = xtx[3][1] = this.statB.dStatisticPre.sum;
    xtx[2][3] = xtx[3][2] =
      this.statA.mPreDPreSumOfProducts + this.statB.mPreDPreSumOfProducts;
    return xtx;
  }

  /**
   * Build the X'Y vector for the numerator.
   */
  private get xtyNumerator(): number[] {
    return [
      this.statA.mStatisticPost.sum + this.statB.mStatisticPost.sum,
      this.statB.mStatisticPost.sum,
      this.statA.mPostMPreSumOfProducts + this.statB.mPostMPreSumOfProducts,
      this.statA.mPostDPreSumOfProducts + this.statB.mPostDPreSumOfProducts,
    ];
  }

  /**
   * Build the X'Y vector for the denominator.
   */
  private get xtyDenominator(): number[] {
    return [
      this.statA.dStatisticPost.sum + this.statB.dStatisticPost.sum,
      this.statB.dStatisticPost.sum,
      this.statA.mPreDPostSumOfProducts + this.statB.mPreDPostSumOfProducts,
      this.statA.dPostDPreSumOfProducts + this.statB.dPostDPreSumOfProducts,
    ];
  }

  /**
   * Baseline mean for numerator pre-period.
   */
  private get baselineMeanNumerator(): number {
    return (
      (this.statA.mStatisticPre.sum + this.statB.mStatisticPre.sum) / this.n
    );
  }

  /**
   * Baseline mean for denominator pre-period.
   */
  private get baselineMeanDenominator(): number {
    return (
      (this.statA.dStatisticPre.sum + this.statB.dStatisticPre.sum) / this.n
    );
  }

  /**
   * Baseline variance for numerator pre-period.
   */
  private get baselineVarianceNumerator(): number {
    const sumSquares =
      this.statA.mStatisticPre.sumSquares + this.statB.mStatisticPre.sumSquares;
    const sum = this.statA.mStatisticPre.sum + this.statB.mStatisticPre.sum;
    return (sumSquares - (sum * sum) / this.n) / (this.n - 1);
  }

  /**
   * Baseline variance for denominator pre-period.
   */
  private get baselineVarianceDenominator(): number {
    const sumSquares =
      this.statA.dStatisticPre.sumSquares + this.statB.dStatisticPre.sumSquares;
    const sum = this.statA.dStatisticPre.sum + this.statB.dStatisticPre.sum;
    return (sumSquares - (sum * sum) / this.n) / (this.n - 1);
  }

  /**
   * Baseline covariance between numerator and denominator pre-period.
   */
  private get baselineCovariance(): number {
    const sumOfProducts =
      this.statA.mPreDPreSumOfProducts + this.statB.mPreDPreSumOfProducts;
    const sumM = this.statA.mStatisticPre.sum + this.statB.mStatisticPre.sum;
    const sumD = this.statA.dStatisticPre.sum + this.statB.dStatisticPre.sum;
    return (sumOfProducts - (sumM * sumD) / this.n) / (this.n - 1);
  }

  /**
   * Build the 4x8 contrast matrix.
   * Rows: numerator_control_mean, numerator_effect, denominator_control_mean, denominator_effect
   */
  private get contrastMatrix(): number[][] {
    return [
      [
        1,
        0,
        this.baselineMeanNumerator,
        this.baselineMeanDenominator,
        0,
        0,
        0,
        0,
      ],
      [0, 1, 0, 0, 0, 0, 0, 0],
      [
        0,
        0,
        0,
        0,
        1,
        0,
        this.baselineMeanNumerator,
        this.baselineMeanDenominator,
      ],
      [0, 0, 0, 0, 0, 1, 0, 0],
    ];
  }

  /**
   * Compute the 2x2 sigma error covariance matrix.
   */
  private computeSigma(
    xtyNumerator: number[],
    xtyDenominator: number[],
    xtx: number[][],
    xtxInv: number[][],
  ): number[][] {
    const gammahatNumerator = matVec4(xtxInv, xtyNumerator);
    const gammahatDenominator = matVec4(xtxInv, xtyDenominator);

    // sigma[0,0]: residual variance for numerator
    const residsP1Num =
      this.statA.mStatisticPost.sumSquares +
      this.statB.mStatisticPost.sumSquares;
    const xtyXtxInvXty1 = dot4(xtyNumerator, matVec4(xtxInv, xtyNumerator));
    const sigma11 = (residsP1Num - xtyXtxInvXty1) / (this.n - 6);

    // sigma[1,1]: residual variance for denominator
    const residsP1Den =
      this.statA.dStatisticPost.sumSquares +
      this.statB.dStatisticPost.sumSquares;
    const xtyXtxInvXty2 = dot4(xtyDenominator, matVec4(xtxInv, xtyDenominator));
    const sigma22 = (residsP1Den - xtyXtxInvXty2) / (this.n - 6);

    // sigma[0,1]: residual covariance
    const residsP1Cov =
      this.statA.mPostDPostSumOfProducts + this.statB.mPostDPostSumOfProducts;
    const residsP2Cov = -dot4(xtyNumerator, gammahatDenominator);
    const residsP3Cov = -dot4(xtyDenominator, gammahatNumerator);
    const residsP4Cov = dot4(
      gammahatNumerator,
      matVec4(xtx, gammahatDenominator),
    );
    const sigma12 =
      (residsP1Cov + residsP2Cov + residsP3Cov + residsP4Cov) / (this.n - 6);

    return [
      [sigma11, sigma12],
      [sigma12, sigma22],
    ];
  }

  /**
   * Compute the 8x8 coefficient covariance via Kronecker product.
   * coef_covariance = kron(sigma, xtx_inv)
   */
  private static createCoefCovariance(
    sigma: number[][],
    xtxInv: number[][],
  ): number[][] {
    // Kronecker product of 2x2 sigma with 4x4 xtxInv gives 8x8 matrix
    const result: number[][] = Array(8)
      .fill(null)
      .map(() => Array(8).fill(0));

    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        for (let k = 0; k < 4; k++) {
          for (let l = 0; l < 4; l++) {
            result[i * 4 + k][j * 4 + l] = sigma[i][j] * xtxInv[k][l];
          }
        }
      }
    }
    return result;
  }

  /**
   * Contrast matrix covariance for indices (i, j).
   * This accounts for uncertainty in baseline mean estimation.
   */
  private contrastMatrixCovariance(i: number, j: number): number[][] {
    const v: number[][] = Array(8)
      .fill(null)
      .map(() => Array(8).fill(0));

    if (i === 0 && j === 0) {
      v[2][2] = this.baselineVarianceNumerator / this.n;
      v[3][3] = this.baselineVarianceDenominator / this.n;
      v[2][3] = v[3][2] = this.baselineCovariance / this.n;
    }

    if (i === 2 && j === 2) {
      v[6][6] = this.baselineVarianceNumerator / this.n;
      v[7][7] = this.baselineVarianceDenominator / this.n;
      v[6][7] = v[7][6] = this.baselineCovariance / this.n;
    }

    if (i === 0 && j === 2) {
      v[2][6] = this.baselineVarianceNumerator / this.n;
      v[3][7] = this.baselineVarianceDenominator / this.n;
      v[2][7] = v[3][6] = this.baselineCovariance / this.n;
    }

    if (i === 2 && j === 0) {
      v[6][2] = this.baselineVarianceNumerator / this.n;
      v[7][3] = this.baselineVarianceDenominator / this.n;
      v[7][2] = v[6][3] = this.baselineCovariance / this.n;
    }

    return v;
  }

  /**
   * Contrast matrix second moment for indices (i, j).
   */
  private contrastMatrixSecondMoment(
    contrastMatrix: number[][],
    i: number,
    j: number,
  ): number[][] {
    const m_i = contrastMatrix[i]; // row i as 1x8 vector
    const m_j = contrastMatrix[j]; // row j as 1x8 vector
    const cov = this.contrastMatrixCovariance(i, j);

    // m_i.T @ m_j + cov[i,j]
    const result: number[][] = Array(8)
      .fill(null)
      .map(() => Array(8).fill(0));

    for (let k = 0; k < 8; k++) {
      for (let l = 0; l < 8; l++) {
        result[k][l] = m_i[k] * m_j[l] + cov[k][l];
      }
    }
    return result;
  }

  /**
   * Compute the final 4x4 covariance matrix for the strata result.
   */
  private computeCovariance(
    regressionCoefs: number[],
    coefCovariance: number[][],
  ): number[][] {
    const contrastMatrix = this.contrastMatrix;
    const lenAlpha = 4;
    const vAlpha: number[][] = Array(4)
      .fill(null)
      .map(() => Array(4).fill(0));

    for (let i = 0; i < lenAlpha; i++) {
      for (let j = 0; j <= i; j++) {
        // sum_1 = trace(coef_covariance @ contrast_matrix_second_moment[i,j])
        const secondMoment = this.contrastMatrixSecondMoment(
          contrastMatrix,
          i,
          j,
        );
        const product1 = matMul8x8(coefCovariance, secondMoment);
        const sum1 = trace8(product1);

        // sum_2 = trace(gamma @ gamma.T @ contrast_matrix_covariance[i,j])
        // gamma @ gamma.T is 8x8 outer product of regressionCoefs
        const gammaOuter: number[][] = Array(8)
          .fill(null)
          .map(() => Array(8).fill(0));
        for (let k = 0; k < 8; k++) {
          for (let l = 0; l < 8; l++) {
            gammaOuter[k][l] = regressionCoefs[k] * regressionCoefs[l];
          }
        }
        const cmCov = this.contrastMatrixCovariance(i, j);
        const product2 = matMul8x8(gammaOuter, cmCov);
        const sum2 = trace8(product2);

        vAlpha[i][j] = sum1 + sum2;
        vAlpha[j][i] = vAlpha[i][j];
      }
    }

    // Scale by n
    return vAlpha.map((row) => row.map((v) => this.n * v));
  }

  /**
   * Compute the mean vector from contrast matrix and regression coefficients.
   */
  private static computeMean(
    contrastMatrix: number[][],
    regressionCoefs: number[],
  ): number[] {
    // contrast_matrix @ regression_coefs
    return contrastMatrix.map((row) =>
      row.reduce((sum, val, idx) => sum + val * regressionCoefs[idx], 0),
    );
  }

  computeResult(): StrataResultRatio {
    // Check for zero variance
    if (this.hasZeroVariance()) {
      return CreateStrataResultRatio.defaultOutput(
        ZERO_NEGATIVE_VARIANCE_MESSAGE,
      );
    }

    // Check for baseline covariance zero
    if (this.baselineCovarianceZero()) {
      // Fallback to non-RA ratio result
      const ratioA = new RatioStatistic({
        n: this.statA.n,
        m_statistic: this.statA.mStatisticPost,
        d_statistic: this.statA.dStatisticPost,
        m_d_sum_of_products: this.statA.mPostDPostSumOfProducts,
      });
      const ratioB = new RatioStatistic({
        n: this.statB.n,
        m_statistic: this.statB.mStatisticPost,
        d_statistic: this.statB.dStatisticPost,
        m_d_sum_of_products: this.statB.mPostDPostSumOfProducts,
      });
      return CreateStrataResultRatio.computeResult(ratioA, ratioB);
    }

    // Invert X'X matrix
    const xtx = this.xtx;
    const xtxInv = invertSymmetric4x4(xtx);
    if (xtxInv === null) {
      return CreateStrataResultRatio.defaultOutput(
        "XTX matrix inversion failed",
      );
    }

    // Get X'Y vectors
    const xtyNumerator = this.xtyNumerator;
    const xtyDenominator = this.xtyDenominator;

    // Compute regression coefficients: gamma = XTX^{-1} @ XTY
    const gammaNumerator = matVec4(xtxInv, xtyNumerator);
    const gammaDenominator = matVec4(xtxInv, xtyDenominator);
    const regressionCoefs = [...gammaNumerator, ...gammaDenominator];

    // Compute sigma (2x2 error covariance)
    const sigma = this.computeSigma(xtyNumerator, xtyDenominator, xtx, xtxInv);

    // Compute coefficient covariance (8x8) via Kronecker product
    const coefCovariance =
      CreateStrataResultRegressionAdjustedRatio.createCoefCovariance(
        sigma,
        xtxInv,
      );

    // Compute mean (4-vector)
    const contrastMatrix = this.contrastMatrix;
    const mean = CreateStrataResultRegressionAdjustedRatio.computeMean(
      contrastMatrix,
      regressionCoefs,
    );

    // Compute covariance (4x4 matrix)
    const covariance = this.computeCovariance(regressionCoefs, coefCovariance);

    // Extract results
    // mean order: [numeratorControlMean, numeratorEffect, denominatorControlMean, denominatorEffect]
    return {
      n: this.n,
      numeratorEffect: mean[1],
      numeratorControlMean: mean[0],
      denominatorEffect: mean[3],
      denominatorControlMean: mean[2],
      numeratorEffectCov: covariance[1][1],
      numeratorControlMeanCov: covariance[0][0],
      denominatorEffectCov: covariance[3][3],
      denominatorControlMeanCov: covariance[2][2],
      numeratorEffectNumeratorControlMeanCov: covariance[1][0],
      numeratorEffectDenominatorEffectCov: covariance[1][3],
      numeratorEffectDenominatorControlMeanCov: covariance[1][2],
      numeratorControlMeanDenominatorEffectCov: covariance[0][3],
      numeratorControlMeanDenominatorControlMeanCov: covariance[0][2],
      denominatorEffectDenominatorControlMeanCov: covariance[3][2],
      errorMessage: null,
    };
  }
}

/**
 * Helper: Invert a symmetric 4x4 matrix.
 * Returns null if matrix is singular.
 */
function invertSymmetric4x4(m: number[][]): number[][] | null {
  // Use Gauss-Jordan elimination for 4x4 matrix inversion
  const n = 4;
  const aug: number[][] = [];
  for (let i = 0; i < n; i++) {
    aug[i] = [
      ...m[i],
      ...(i === 0
        ? [1, 0, 0, 0]
        : i === 1
          ? [0, 1, 0, 0]
          : i === 2
            ? [0, 0, 1, 0]
            : [0, 0, 0, 1]),
    ];
  }

  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
        maxRow = row;
      }
    }

    // Swap rows
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    // Check for singular matrix
    if (Math.abs(aug[col][col]) < 1e-15) {
      return null;
    }

    // Scale pivot row
    const pivot = aug[col][col];
    for (let j = 0; j < 2 * n; j++) {
      aug[col][j] /= pivot;
    }

    // Eliminate column
    for (let row = 0; row < n; row++) {
      if (row !== col) {
        const factor = aug[row][col];
        for (let j = 0; j < 2 * n; j++) {
          aug[row][j] -= factor * aug[col][j];
        }
      }
    }
  }

  // Extract inverse
  return aug.map((row) => row.slice(n));
}

/**
 * Helper: Matrix-vector multiply for 4x4 matrix and 4-vector.
 */
function matVec4(m: number[][], v: number[]): number[] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2] + m[0][3] * v[3],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2] + m[1][3] * v[3],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2] + m[2][3] * v[3],
    m[3][0] * v[0] + m[3][1] * v[1] + m[3][2] * v[2] + m[3][3] * v[3],
  ];
}

/**
 * Helper: Dot product of 4-vectors.
 */
function dot4(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

/**
 * Helper: 8x8 matrix multiplication.
 */
function matMul8x8(a: number[][], b: number[][]): number[][] {
  const result: number[][] = Array(8)
    .fill(null)
    .map(() => Array(8).fill(0));

  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      for (let k = 0; k < 8; k++) {
        result[i][j] += a[i][k] * b[k][j];
      }
    }
  }
  return result;
}

/**
 * Helper: Trace of 8x8 matrix.
 */
function trace8(m: number[][]): number {
  return (
    m[0][0] +
    m[1][1] +
    m[2][2] +
    m[3][3] +
    m[4][4] +
    m[5][5] +
    m[6][6] +
    m[7][7]
  );
}
