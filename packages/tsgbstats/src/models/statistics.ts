/**
 * Statistics classes for A/B test analysis.
 * TypeScript port of gbstats/models/statistics.py
 */

import { varianceOfRatios } from "../utils";

/**
 * Base abstract class for all statistics.
 */
export abstract class Statistic {
  readonly n: number;

  constructor(n: number) {
    this.n = n;
  }

  abstract get variance(): number;
  abstract get mean(): number;

  get stddev(): number {
    return this.variance <= 0 ? 0 : Math.sqrt(this.variance);
  }

  get unadjustedMean(): number {
    return this.mean;
  }

  get hasZeroVariance(): boolean {
    return this.variance <= 0;
  }
}

/**
 * Sample mean statistic with variance computed from sum and sum of squares.
 */
export class SampleMeanStatistic extends Statistic {
  readonly sum: number;
  readonly sumSquares: number;

  constructor(params: { n: number; sum: number; sum_squares: number }) {
    super(params.n);
    this.sum = params.sum;
    this.sumSquares = params.sum_squares;
  }

  get variance(): number {
    if (this.n <= 1) {
      return 0;
    }
    return (this.sumSquares - Math.pow(this.sum, 2) / this.n) / (this.n - 1);
  }

  get mean(): number {
    if (this.n === 0) {
      return 0;
    }
    return this.sum / this.n;
  }

  add(other: SampleMeanStatistic | ProportionStatistic): SampleMeanStatistic {
    return new SampleMeanStatistic({
      n: this.n + other.n,
      sum: this.sum + other.sum,
      sum_squares: this.sumSquares + other.sumSquares,
    });
  }
}

/**
 * Proportion statistic for binary outcomes.
 */
export class ProportionStatistic extends Statistic {
  readonly sum: number;

  constructor(params: { n: number; sum: number }) {
    super(params.n);
    this.sum = params.sum;
  }

  get sumSquares(): number {
    return this.sum;
  }

  get variance(): number {
    return this.mean * (1 - this.mean);
  }

  get mean(): number {
    if (this.n === 0) {
      return 0;
    }
    return this.sum / this.n;
  }

  add(other: SampleMeanStatistic | ProportionStatistic): SampleMeanStatistic {
    return new SampleMeanStatistic({
      n: this.n + other.n,
      sum: this.sum + other.sum,
      sum_squares: this.sumSquares + other.sumSquares,
    });
  }
}

/**
 * Ratio statistic for ratio metrics (M/D).
 */
export class RatioStatistic extends Statistic {
  readonly mStatistic: SampleMeanStatistic | ProportionStatistic;
  readonly dStatistic: SampleMeanStatistic | ProportionStatistic;
  readonly mDSumOfProducts: number;

  constructor(params: {
    n: number;
    m_statistic: SampleMeanStatistic | ProportionStatistic;
    d_statistic: SampleMeanStatistic | ProportionStatistic;
    m_d_sum_of_products: number;
  }) {
    super(params.n);
    this.mStatistic = params.m_statistic;
    this.dStatistic = params.d_statistic;
    this.mDSumOfProducts = params.m_d_sum_of_products;
  }

  get mean(): number {
    if (this.dStatistic.sum === 0) {
      return 0;
    }
    return this.mStatistic.sum / this.dStatistic.sum;
  }

  get variance(): number {
    if (this.dStatistic.mean === 0 || this.n <= 1) {
      return 0;
    }
    return varianceOfRatios(
      this.mStatistic.mean,
      this.mStatistic.variance,
      this.dStatistic.mean,
      this.dStatistic.variance,
      this.covariance,
    );
  }

  get covariance(): number {
    return computeCovariance(
      this.n,
      this.mStatistic,
      this.dStatistic,
      this.mDSumOfProducts,
    );
  }

  add(other: RatioStatistic): RatioStatistic {
    return new RatioStatistic({
      n: this.n + other.n,
      m_statistic: this.mStatistic.add(other.mStatistic),
      d_statistic: this.dStatistic.add(other.dStatistic),
      m_d_sum_of_products: this.mDSumOfProducts + other.mDSumOfProducts,
    });
  }
}

/**
 * Regression-adjusted (CUPED) statistic.
 */
export class RegressionAdjustedStatistic extends Statistic {
  readonly postStatistic: SampleMeanStatistic | ProportionStatistic;
  readonly preStatistic: SampleMeanStatistic | ProportionStatistic;
  readonly postPreSumOfProducts: number;
  readonly theta: number | null;

  constructor(params: {
    n: number;
    post_statistic: SampleMeanStatistic | ProportionStatistic;
    pre_statistic: SampleMeanStatistic | ProportionStatistic;
    post_pre_sum_of_products: number;
    theta: number | null;
  }) {
    super(params.n);
    this.postStatistic = params.post_statistic;
    this.preStatistic = params.pre_statistic;
    this.postPreSumOfProducts = params.post_pre_sum_of_products;
    this.theta = params.theta;
  }

  get mean(): number {
    const theta = this.theta ?? 0;
    return this.postStatistic.mean - theta * this.preStatistic.mean;
  }

  get unadjustedMean(): number {
    return this.postStatistic.mean;
  }

  get variance(): number {
    if (this.n <= 1) {
      return 0;
    }
    const theta = this.theta ?? 0;
    return (
      this.postStatistic.variance +
      Math.pow(theta, 2) * this.preStatistic.variance -
      2 * theta * this.covariance
    );
  }

  get covariance(): number {
    return computeCovariance(
      this.n,
      this.postStatistic,
      this.preStatistic,
      this.postPreSumOfProducts,
    );
  }

  add(other: RegressionAdjustedStatistic): RegressionAdjustedStatistic {
    return new RegressionAdjustedStatistic({
      n: this.n + other.n,
      post_statistic: this.postStatistic.add(other.postStatistic),
      pre_statistic: this.preStatistic.add(other.preStatistic),
      post_pre_sum_of_products:
        this.postPreSumOfProducts + other.postPreSumOfProducts,
      theta: null, // Reset theta after summation
    });
  }
}

/**
 * Regression-adjusted ratio statistic (CUPED for ratio metrics).
 */
export class RegressionAdjustedRatioStatistic extends Statistic {
  readonly mStatisticPost: SampleMeanStatistic | ProportionStatistic;
  readonly dStatisticPost: SampleMeanStatistic | ProportionStatistic;
  readonly mStatisticPre: SampleMeanStatistic | ProportionStatistic;
  readonly dStatisticPre: SampleMeanStatistic | ProportionStatistic;
  readonly mPostMPreSumOfProducts: number;
  readonly dPostDPreSumOfProducts: number;
  readonly mPreDPreSumOfProducts: number;
  readonly mPostDPostSumOfProducts: number;
  readonly mPostDPreSumOfProducts: number;
  readonly mPreDPostSumOfProducts: number;
  readonly theta: number | null;

  constructor(params: {
    n: number;
    m_statistic_post: SampleMeanStatistic | ProportionStatistic;
    d_statistic_post: SampleMeanStatistic | ProportionStatistic;
    m_statistic_pre: SampleMeanStatistic | ProportionStatistic;
    d_statistic_pre: SampleMeanStatistic | ProportionStatistic;
    m_post_m_pre_sum_of_products: number;
    d_post_d_pre_sum_of_products: number;
    m_pre_d_pre_sum_of_products: number;
    m_post_d_post_sum_of_products: number;
    m_post_d_pre_sum_of_products: number;
    m_pre_d_post_sum_of_products: number;
    theta: number | null;
  }) {
    super(params.n);
    this.mStatisticPost = params.m_statistic_post;
    this.dStatisticPost = params.d_statistic_post;
    this.mStatisticPre = params.m_statistic_pre;
    this.dStatisticPre = params.d_statistic_pre;
    this.mPostMPreSumOfProducts = params.m_post_m_pre_sum_of_products;
    this.dPostDPreSumOfProducts = params.d_post_d_pre_sum_of_products;
    this.mPreDPreSumOfProducts = params.m_pre_d_pre_sum_of_products;
    this.mPostDPostSumOfProducts = params.m_post_d_post_sum_of_products;
    this.mPostDPreSumOfProducts = params.m_post_d_pre_sum_of_products;
    this.mPreDPostSumOfProducts = params.m_pre_d_post_sum_of_products;
    this.theta = params.theta;
  }

  get mean(): number {
    if (this.dStatisticPost.sum === 0 || this.dStatisticPre.sum === 0) {
      return 0;
    }
    const theta = this.theta ?? 0;
    return this.meanPost - theta * this.meanPre;
  }

  get meanPost(): number {
    if (this.dStatisticPost.sum === 0) {
      return 0;
    }
    return this.mStatisticPost.sum / this.dStatisticPost.sum;
  }

  get meanPre(): number {
    if (this.dStatisticPre.sum === 0) {
      return 0;
    }
    return this.mStatisticPre.sum / this.dStatisticPre.sum;
  }

  get unadjustedMean(): number {
    return this.meanPost;
  }

  // Mean helpers
  get meanMPost(): number {
    return this.mStatisticPost.mean;
  }

  get meanMPre(): number {
    return this.mStatisticPre.mean;
  }

  get meanDPost(): number {
    return this.dStatisticPost.mean;
  }

  get meanDPre(): number {
    return this.dStatisticPre.mean;
  }

  // Variance helpers
  get varMPost(): number {
    return this.mStatisticPost.variance;
  }

  get varMPre(): number {
    return this.mStatisticPre.variance;
  }

  get varDPost(): number {
    return this.dStatisticPost.variance;
  }

  get varDPre(): number {
    return this.dStatisticPre.variance;
  }

  // Covariance helpers
  get covMPreDPre(): number {
    return computeCovariance(
      this.n,
      this.mStatisticPre,
      this.dStatisticPre,
      this.mPreDPreSumOfProducts,
    );
  }

  get covMPostDPost(): number {
    return computeCovariance(
      this.n,
      this.mStatisticPost,
      this.dStatisticPost,
      this.mPostDPostSumOfProducts,
    );
  }

  get covMPostMPre(): number {
    return computeCovariance(
      this.n,
      this.mStatisticPost,
      this.mStatisticPre,
      this.mPostMPreSumOfProducts,
    );
  }

  get covDPostDPre(): number {
    return computeCovariance(
      this.n,
      this.dStatisticPost,
      this.dStatisticPre,
      this.dPostDPreSumOfProducts,
    );
  }

  get covMPostDPre(): number {
    return computeCovariance(
      this.n,
      this.mStatisticPost,
      this.dStatisticPre,
      this.mPostDPreSumOfProducts,
    );
  }

  get covDPostMPre(): number {
    return computeCovariance(
      this.n,
      this.dStatisticPost,
      this.mStatisticPre,
      this.mPreDPostSumOfProducts,
    );
  }

  /**
   * Vector of means: [meanMPost, meanDPost, meanMPre, meanDPre]
   */
  get betahat(): [number, number, number, number] {
    return [this.meanMPost, this.meanDPost, this.meanMPre, this.meanDPre];
  }

  /**
   * 4x4 covariance matrix (Lambda matrix)
   */
  get lambdaMatrix(): number[][] {
    return [
      [this.varMPost, this.covMPostDPost, this.covMPostMPre, this.covMPostDPre],
      [this.covMPostDPost, this.varDPost, this.covDPostMPre, this.covDPostDPre],
      [this.covMPostMPre, this.covDPostMPre, this.varMPre, this.covMPreDPre],
      [this.covMPostDPre, this.covDPostDPre, this.covMPreDPre, this.varDPre],
    ];
  }

  /**
   * Gradient vector of partial derivatives for the absolute case.
   */
  get nabla(): [number, number, number, number] {
    const theta = this.theta ?? 0;
    const beta = this.betahat;

    // Only check beta[1] (meanDPost) for full zero return
    if (beta[1] === 0) {
      return [0, 0, 0, 0];
    }

    // Handle beta[3] = 0 case for nabla[2] and nabla[3] only
    // These depend on pre-period means, and should be 0 when theta = 0 anyway
    let nabla2 = 0;
    let nabla3 = 0;
    if (beta[3] !== 0) {
      nabla2 = -theta / beta[3];
      nabla3 = (theta * beta[2]) / Math.pow(beta[3], 2);
    }

    return [1 / beta[1], -beta[0] / Math.pow(beta[1], 2), nabla2, nabla3];
  }

  /**
   * Variance of the pre-period ratio (for theta computation).
   */
  get varPre(): number {
    const nabla = this.nabla;
    const lambda = this.lambdaMatrix;

    // nabla[2:4].T.dot(lambda[2:4, 2:4]).dot(nabla[2:4])
    const n2 = nabla[2];
    const n3 = nabla[3];

    return (
      n2 * n2 * lambda[2][2] +
      n2 * n3 * lambda[2][3] +
      n3 * n2 * lambda[3][2] +
      n3 * n3 * lambda[3][3]
    );
  }

  /**
   * Covariance between post and pre periods (for theta computation).
   */
  get covariance(): number {
    const nabla = this.nabla;
    const lambda = this.lambdaMatrix;

    // nabla[2:4].T.dot(lambda[2:4, 0:2]).dot(nabla[0:2])
    const n0 = nabla[0];
    const n1 = nabla[1];
    const n2 = nabla[2];
    const n3 = nabla[3];

    return (
      n2 * lambda[2][0] * n0 +
      n2 * lambda[2][1] * n1 +
      n3 * lambda[3][0] * n0 +
      n3 * lambda[3][1] * n1
    );
  }

  get variance(): number {
    const nabla = this.nabla;
    const lambda = this.lambdaMatrix;

    // nabla.T.dot(lambda).dot(nabla) - manual 4x4 matrix multiplication
    // First compute lambda.dot(nabla) -> intermediate vector of size 4
    const intermediate: number[] = [];
    for (let i = 0; i < 4; i++) {
      let sum = 0;
      for (let j = 0; j < 4; j++) {
        sum += lambda[i][j] * nabla[j];
      }
      intermediate.push(sum);
    }

    // Then compute nabla.T.dot(intermediate) -> scalar
    let result = 0;
    for (let i = 0; i < 4; i++) {
      result += nabla[i] * intermediate[i];
    }

    return result;
  }

  /**
   * Check if any variance is zero or negative.
   * For RA ratio stats, we check the post-statistic variances.
   */
  override get hasZeroVariance(): boolean {
    return (
      this.mStatisticPost.variance <= 0 ||
      this.dStatisticPost.variance <= 0 ||
      this.n <= 1
    );
  }

  add(
    other: RegressionAdjustedRatioStatistic,
  ): RegressionAdjustedRatioStatistic {
    return new RegressionAdjustedRatioStatistic({
      n: this.n + other.n,
      m_statistic_post: this.mStatisticPost.add(other.mStatisticPost),
      d_statistic_post: this.dStatisticPost.add(other.dStatisticPost),
      m_statistic_pre: this.mStatisticPre.add(other.mStatisticPre),
      d_statistic_pre: this.dStatisticPre.add(other.dStatisticPre),
      m_post_m_pre_sum_of_products:
        this.mPostMPreSumOfProducts + other.mPostMPreSumOfProducts,
      d_post_d_pre_sum_of_products:
        this.dPostDPreSumOfProducts + other.dPostDPreSumOfProducts,
      m_pre_d_pre_sum_of_products:
        this.mPreDPreSumOfProducts + other.mPreDPreSumOfProducts,
      m_post_d_post_sum_of_products:
        this.mPostDPostSumOfProducts + other.mPostDPostSumOfProducts,
      m_post_d_pre_sum_of_products:
        this.mPostDPreSumOfProducts + other.mPostDPreSumOfProducts,
      m_pre_d_post_sum_of_products:
        this.mPreDPostSumOfProducts + other.mPreDPostSumOfProducts,
      theta: null, // Reset theta after summation
    });
  }
}

/**
 * Quantile statistic for quantile-based metrics.
 */
export class QuantileStatistic extends Statistic {
  readonly nStar: number;
  readonly nu: number;
  readonly quantileHat: number;
  readonly quantileLower: number;
  readonly quantileUpper: number;

  constructor(params: {
    n: number;
    n_star: number;
    nu: number;
    quantile_hat: number;
    quantile_lower: number;
    quantile_upper: number;
  }) {
    super(params.n);
    this.nStar = params.n_star;
    this.nu = params.nu;
    this.quantileHat = params.quantile_hat;
    this.quantileLower = params.quantile_lower;
    this.quantileUpper = params.quantile_upper;
  }

  get mean(): number {
    return this.quantileHat;
  }

  get varianceInit(): number {
    if (this.n <= 1) {
      return 0;
    }
    // z-score for 97.5% quantile (alpha=0.05)
    const z = 1.959963984540054; // norm.ppf(0.975)
    const num = this.quantileUpper - this.quantileLower;
    const den = 2 * z;
    return (this.nStar / this.n) * (this.n - 1) * Math.pow(num / den, 2);
  }

  get variance(): number {
    if (this.n < 100) {
      return this.varianceInit;
    }
    return Math.max(this.varianceInit, 1e-5);
  }
}

/**
 * Compute covariance between two statistics.
 */
export function computeCovariance(
  n: number,
  statA: SampleMeanStatistic | ProportionStatistic,
  statB: SampleMeanStatistic | ProportionStatistic,
  sumOfProducts: number,
): number {
  if (n <= 1) {
    return 0;
  }

  if (
    statA instanceof ProportionStatistic &&
    statB instanceof ProportionStatistic
  ) {
    return sumOfProducts / n - (statA.sum * statB.sum) / Math.pow(n, 2);
  } else {
    return (sumOfProducts - (statA.sum * statB.sum) / n) / (n - 1);
  }
}

/**
 * Compute theta coefficient for regression adjustment.
 */
export function computeTheta(
  a: RegressionAdjustedStatistic,
  b: RegressionAdjustedStatistic,
): number {
  const n = a.n + b.n;

  // Create joint statistics
  const jointPreSum = a.preStatistic.sum + b.preStatistic.sum;
  const jointPostSum = a.postStatistic.sum + b.postStatistic.sum;

  let jointPreVariance: number;
  let jointPostVariance: number;

  if (
    a.preStatistic instanceof ProportionStatistic &&
    b.preStatistic instanceof ProportionStatistic
  ) {
    const jointPreMean = jointPreSum / n;
    jointPreVariance = jointPreMean * (1 - jointPreMean);
  } else if (
    a.preStatistic instanceof SampleMeanStatistic &&
    b.preStatistic instanceof SampleMeanStatistic
  ) {
    const jointPreSumSquares =
      a.preStatistic.sumSquares + b.preStatistic.sumSquares;
    jointPreVariance =
      (jointPreSumSquares - Math.pow(jointPreSum, 2) / n) / (n - 1);
  } else {
    throw new Error("Mismatched statistic types");
  }

  if (
    a.postStatistic instanceof ProportionStatistic &&
    b.postStatistic instanceof ProportionStatistic
  ) {
    const jointPostMean = jointPostSum / n;
    jointPostVariance = jointPostMean * (1 - jointPostMean);
  } else if (
    a.postStatistic instanceof SampleMeanStatistic &&
    b.postStatistic instanceof SampleMeanStatistic
  ) {
    const jointPostSumSquares =
      a.postStatistic.sumSquares + b.postStatistic.sumSquares;
    jointPostVariance =
      (jointPostSumSquares - Math.pow(jointPostSum, 2) / n) / (n - 1);
  } else {
    throw new Error("Mismatched statistic types");
  }

  if (jointPreVariance === 0 || jointPostVariance === 0) {
    return 0;
  }

  // Compute joint covariance
  const jointSumOfProducts = a.postPreSumOfProducts + b.postPreSumOfProducts;
  const jointCovariance =
    (jointSumOfProducts - (jointPostSum * jointPreSum) / n) / (n - 1);

  return jointCovariance / jointPreVariance;
}

/**
 * Compute theta coefficient for regression-adjusted ratio statistics.
 * Uses theta=1 temporarily to compute covariances, then computes optimal theta.
 */
export function computeThetaRegressionAdjustedRatio(
  a: RegressionAdjustedRatioStatistic,
  b: RegressionAdjustedRatioStatistic,
): number {
  // Create copies with theta=1 to compute covariances
  const aOne = new RegressionAdjustedRatioStatistic({
    n: a.n,
    m_statistic_post: a.mStatisticPost,
    d_statistic_post: a.dStatisticPost,
    m_statistic_pre: a.mStatisticPre,
    d_statistic_pre: a.dStatisticPre,
    m_post_m_pre_sum_of_products: a.mPostMPreSumOfProducts,
    d_post_d_pre_sum_of_products: a.dPostDPreSumOfProducts,
    m_pre_d_pre_sum_of_products: a.mPreDPreSumOfProducts,
    m_post_d_post_sum_of_products: a.mPostDPostSumOfProducts,
    m_post_d_pre_sum_of_products: a.mPostDPreSumOfProducts,
    m_pre_d_post_sum_of_products: a.mPreDPostSumOfProducts,
    theta: 1,
  });

  const bOne = new RegressionAdjustedRatioStatistic({
    n: b.n,
    m_statistic_post: b.mStatisticPost,
    d_statistic_post: b.dStatisticPost,
    m_statistic_pre: b.mStatisticPre,
    d_statistic_pre: b.dStatisticPre,
    m_post_m_pre_sum_of_products: b.mPostMPreSumOfProducts,
    d_post_d_pre_sum_of_products: b.dPostDPreSumOfProducts,
    m_pre_d_pre_sum_of_products: b.mPreDPreSumOfProducts,
    m_post_d_post_sum_of_products: b.mPostDPostSumOfProducts,
    m_post_d_pre_sum_of_products: b.mPostDPreSumOfProducts,
    m_pre_d_post_sum_of_products: b.mPreDPostSumOfProducts,
    theta: 1,
  });

  const varPreSum = aOne.varPre + bOne.varPre;
  if (varPreSum === 0) {
    return 0;
  }

  return -(aOne.covariance + bOne.covariance) / varPreSum;
}

/**
 * Adjust statistics with computed theta coefficient.
 * For RegressionAdjustedStatistic and RegressionAdjustedRatioStatistic,
 * computes the optimal theta if not already set.
 */
export function createThetaAdjustedStatistics(
  statA: TestStatistic,
  statB: TestStatistic,
): [TestStatistic, TestStatistic] {
  if (
    statA instanceof RegressionAdjustedStatistic &&
    statB instanceof RegressionAdjustedStatistic &&
    (statA.theta === null || statB.theta === null)
  ) {
    const theta = computeTheta(statA, statB);
    if (theta === 0) {
      // Revert to non-RA if no variance in time period
      return [statA.postStatistic, statB.postStatistic];
    }
    // Create new statistics with theta set
    return [
      new RegressionAdjustedStatistic({
        n: statA.n,
        post_statistic: statA.postStatistic,
        pre_statistic: statA.preStatistic,
        post_pre_sum_of_products: statA.postPreSumOfProducts,
        theta,
      }),
      new RegressionAdjustedStatistic({
        n: statB.n,
        post_statistic: statB.postStatistic,
        pre_statistic: statB.preStatistic,
        post_pre_sum_of_products: statB.postPreSumOfProducts,
        theta,
      }),
    ];
  } else if (
    statA instanceof RegressionAdjustedRatioStatistic &&
    statB instanceof RegressionAdjustedRatioStatistic &&
    (statA.theta === null || statB.theta === null)
  ) {
    const theta = computeThetaRegressionAdjustedRatio(statA, statB);
    if (Math.abs(theta) < 1e-8) {
      // Revert to non-RA if no variance in time period
      return [
        new RatioStatistic({
          n: statA.n,
          m_statistic: statA.mStatisticPost,
          d_statistic: statA.dStatisticPost,
          m_d_sum_of_products: statA.mPostDPostSumOfProducts,
        }),
        new RatioStatistic({
          n: statB.n,
          m_statistic: statB.mStatisticPost,
          d_statistic: statB.dStatisticPost,
          m_d_sum_of_products: statB.mPostDPostSumOfProducts,
        }),
      ];
    }
    // Create new statistics with theta set
    return [
      new RegressionAdjustedRatioStatistic({
        n: statA.n,
        m_statistic_post: statA.mStatisticPost,
        d_statistic_post: statA.dStatisticPost,
        m_statistic_pre: statA.mStatisticPre,
        d_statistic_pre: statA.dStatisticPre,
        m_post_m_pre_sum_of_products: statA.mPostMPreSumOfProducts,
        d_post_d_pre_sum_of_products: statA.dPostDPreSumOfProducts,
        m_pre_d_pre_sum_of_products: statA.mPreDPreSumOfProducts,
        m_post_d_post_sum_of_products: statA.mPostDPostSumOfProducts,
        m_post_d_pre_sum_of_products: statA.mPostDPreSumOfProducts,
        m_pre_d_post_sum_of_products: statA.mPreDPostSumOfProducts,
        theta,
      }),
      new RegressionAdjustedRatioStatistic({
        n: statB.n,
        m_statistic_post: statB.mStatisticPost,
        d_statistic_post: statB.dStatisticPost,
        m_statistic_pre: statB.mStatisticPre,
        d_statistic_pre: statB.dStatisticPre,
        m_post_m_pre_sum_of_products: statB.mPostMPreSumOfProducts,
        d_post_d_pre_sum_of_products: statB.dPostDPreSumOfProducts,
        m_pre_d_pre_sum_of_products: statB.mPreDPreSumOfProducts,
        m_post_d_post_sum_of_products: statB.mPostDPostSumOfProducts,
        m_post_d_pre_sum_of_products: statB.mPostDPreSumOfProducts,
        m_pre_d_post_sum_of_products: statB.mPreDPostSumOfProducts,
        theta,
      }),
    ];
  }

  return [statA, statB];
}

// Type aliases
export type TestStatistic =
  | SampleMeanStatistic
  | ProportionStatistic
  | RatioStatistic
  | RegressionAdjustedStatistic
  | RegressionAdjustedRatioStatistic
  | QuantileStatistic;

/**
 * Sum a list of statistic pairs across dimensions.
 * Returns the combined statistics for control and treatment.
 */
export function sumStats<T extends Statistic>(stats: [T, T][]): [T, T] {
  if (stats.length === 0) {
    throw new Error("Cannot sum empty list of statistics");
  }

  if (stats.length === 1) {
    return stats[0];
  }

  let sumA = stats[0][0];
  let sumB = stats[0][1];

  for (let i = 1; i < stats.length; i++) {
    const [a, b] = stats[i];
    sumA = addStatistics(sumA, a) as T;
    sumB = addStatistics(sumB, b) as T;
  }

  return [sumA, sumB];
}

/**
 * Add two statistics of the same type.
 */
function addStatistics(sumStat: Statistic, newStat: Statistic): Statistic {
  if (
    sumStat instanceof SampleMeanStatistic &&
    newStat instanceof SampleMeanStatistic
  ) {
    return sumStat.add(newStat);
  } else if (
    sumStat instanceof ProportionStatistic &&
    newStat instanceof ProportionStatistic
  ) {
    return new ProportionStatistic({
      n: sumStat.n + newStat.n,
      sum: sumStat.sum + newStat.sum,
    });
  } else if (
    sumStat instanceof RatioStatistic &&
    newStat instanceof RatioStatistic
  ) {
    return sumStat.add(newStat);
  } else if (
    sumStat instanceof RegressionAdjustedStatistic &&
    newStat instanceof RegressionAdjustedStatistic
  ) {
    return sumStat.add(newStat);
  } else if (
    sumStat instanceof RegressionAdjustedRatioStatistic &&
    newStat instanceof RegressionAdjustedRatioStatistic
  ) {
    return sumStat.add(newStat);
  } else if (
    sumStat instanceof QuantileStatistic ||
    newStat instanceof QuantileStatistic
  ) {
    throw new Error("Cannot sum QuantileStatistics - use single dimension");
  } else {
    throw new Error("Mismatched or unsupported statistic types for summation");
  }
}
