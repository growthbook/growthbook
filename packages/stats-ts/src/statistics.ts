import { normPpf, varianceOfRatios } from "./utils";

function quadForm(v: number[], m: number[][]): number {
  let total = 0;
  for (let i = 0; i < v.length; i++) {
    for (let j = 0; j < v.length; j++) {
      total += v[i] * m[i][j] * v[j];
    }
  }
  return total;
}

function bilinearForm(u: number[], m: number[][], v: number[]): number {
  let total = 0;
  for (let i = 0; i < u.length; i++) {
    for (let j = 0; j < v.length; j++) {
      total += u[i] * m[i][j] * v[j];
    }
  }
  return total;
}

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

  /** Mean with no regression adjustments; overridden by adjusted statistics. */
  get unadjustedMean(): number {
    return this.mean;
  }

  get unadjustedVariance(): number {
    return this.variance;
  }

  get hasZeroVariance(): boolean {
    return this.variance <= 0.0;
  }
}

export class SampleMeanStatistic extends Statistic {
  readonly sum: number;
  readonly sumSquares: number;

  constructor(args: { n: number; sum: number; sumSquares: number }) {
    super(args.n);
    this.sum = args.sum;
    this.sumSquares = args.sumSquares;
  }

  get variance(): number {
    if (this.n <= 1) return 0;
    return (this.sumSquares - this.sum ** 2 / this.n) / (this.n - 1);
  }

  get mean(): number {
    if (this.n === 0) return 0;
    return this.sum / this.n;
  }

  add(other: ProportionStatistic | SampleMeanStatistic): SampleMeanStatistic {
    return new SampleMeanStatistic({
      n: this.n + other.n,
      sum: this.sum + other.sum,
      sumSquares: this.sumSquares + other.sumSquares,
    });
  }
}

export class ProportionStatistic extends Statistic {
  readonly sum: number;

  constructor(args: { n: number; sum: number }) {
    super(args.n);
    this.sum = args.sum;
  }

  get sumSquares(): number {
    return this.sum;
  }

  get variance(): number {
    return this.mean * (1 - this.mean);
  }

  get mean(): number {
    if (this.n === 0) return 0;
    return this.sum / this.n;
  }

  add(other: ProportionStatistic | SampleMeanStatistic): SampleMeanStatistic {
    return new SampleMeanStatistic({
      n: this.n + other.n,
      sum: this.sum + other.sum,
      sumSquares: this.sumSquares + other.sumSquares,
    });
  }
}

export class RatioStatistic extends Statistic {
  readonly mStatistic: SampleMeanStatistic | ProportionStatistic;
  readonly dStatistic: SampleMeanStatistic | ProportionStatistic;
  readonly mDSumOfProducts: number;

  constructor(args: {
    n: number;
    mStatistic: SampleMeanStatistic | ProportionStatistic;
    dStatistic: SampleMeanStatistic | ProportionStatistic;
    mDSumOfProducts: number;
  }) {
    super(args.n);
    this.mStatistic = args.mStatistic;
    this.dStatistic = args.dStatistic;
    this.mDSumOfProducts = args.mDSumOfProducts;
  }

  get mean(): number {
    if (this.dStatistic.sum === 0) return 0;
    return this.mStatistic.sum / this.dStatistic.sum;
  }

  get variance(): number {
    if (this.dStatistic.mean === 0 || this.n <= 1) return 0;
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
      mStatistic: this.mStatistic.add(other.mStatistic),
      dStatistic: this.dStatistic.add(other.dStatistic),
      mDSumOfProducts: this.mDSumOfProducts + other.mDSumOfProducts,
    });
  }
}

export class RegressionAdjustedStatistic extends Statistic {
  readonly postStatistic: SampleMeanStatistic | ProportionStatistic;
  readonly preStatistic: SampleMeanStatistic | ProportionStatistic;
  readonly postPreSumOfProducts: number;
  readonly theta: number | null;

  constructor(args: {
    n: number;
    postStatistic: SampleMeanStatistic | ProportionStatistic;
    preStatistic: SampleMeanStatistic | ProportionStatistic;
    postPreSumOfProducts: number;
    theta: number | null;
  }) {
    super(args.n);
    if (args.postStatistic.constructor !== args.preStatistic.constructor) {
      throw new TypeError(
        "postStatistic and preStatistic must be of the same type",
      );
    }
    this.postStatistic = args.postStatistic;
    this.preStatistic = args.preStatistic;
    this.postPreSumOfProducts = args.postPreSumOfProducts;
    this.theta = args.theta;
  }

  add(other: RegressionAdjustedStatistic): RegressionAdjustedStatistic {
    return new RegressionAdjustedStatistic({
      n: this.n + other.n,
      postStatistic: this.postStatistic.add(other.postStatistic),
      preStatistic: this.preStatistic.add(other.preStatistic),
      postPreSumOfProducts:
        this.postPreSumOfProducts + other.postPreSumOfProducts,
      theta: null,
    });
  }

  withTheta(theta: number): RegressionAdjustedStatistic {
    return new RegressionAdjustedStatistic({
      n: this.n,
      postStatistic: this.postStatistic,
      preStatistic: this.preStatistic,
      postPreSumOfProducts: this.postPreSumOfProducts,
      theta,
    });
  }

  get mean(): number {
    const theta = this.theta ?? 0;
    return this.postStatistic.mean - theta * this.preStatistic.mean;
  }

  get unadjustedMean(): number {
    return this.postStatistic.mean;
  }

  get unadjustedVariance(): number {
    return this.postStatistic.variance;
  }

  get variance(): number {
    if (this.n <= 1) return 0;
    const theta = this.theta ?? 0;
    return (
      this.postStatistic.variance +
      theta ** 2 * this.preStatistic.variance -
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
}

export function computeCovariance(
  n: number,
  statA: SampleMeanStatistic | ProportionStatistic,
  statB: SampleMeanStatistic | ProportionStatistic,
  sumOfProducts: number,
): number {
  if (n <= 1) return 0;
  if (
    statA instanceof ProportionStatistic &&
    statB instanceof ProportionStatistic
  ) {
    return sumOfProducts / n - (statA.sum * statB.sum) / n ** 2;
  }
  return (sumOfProducts - (statA.sum * statB.sum) / n) / (n - 1);
}

export function createJointStatistic(
  a: ProportionStatistic | SampleMeanStatistic,
  b: ProportionStatistic | SampleMeanStatistic,
  n: number,
): ProportionStatistic | SampleMeanStatistic {
  if (a instanceof ProportionStatistic && b instanceof ProportionStatistic) {
    return new ProportionStatistic({ n, sum: a.sum + b.sum });
  }
  if (a instanceof SampleMeanStatistic && b instanceof SampleMeanStatistic) {
    return new SampleMeanStatistic({
      n,
      sum: a.sum + b.sum,
      sumSquares: a.sumSquares + b.sumSquares,
    });
  }
  throw new Error(
    "Statistic types for a metric must not be different types across variations.",
  );
}

export function computeTheta(
  a: RegressionAdjustedStatistic,
  b: RegressionAdjustedStatistic,
): number {
  const n = a.n + b.n;
  const jointPostStatistic = createJointStatistic(
    a.postStatistic,
    b.postStatistic,
    n,
  );
  const jointPreStatistic = createJointStatistic(
    a.preStatistic,
    b.preStatistic,
    n,
  );
  if (jointPreStatistic.variance === 0 || jointPostStatistic.variance === 0) {
    return 0;
  }

  const joint = new RegressionAdjustedStatistic({
    n,
    postStatistic: jointPostStatistic,
    preStatistic: jointPreStatistic,
    postPreSumOfProducts: a.postPreSumOfProducts + b.postPreSumOfProducts,
    theta: 0,
  });
  return joint.covariance / joint.preStatistic.variance;
}

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

  constructor(args: {
    n: number;
    mStatisticPost: SampleMeanStatistic | ProportionStatistic;
    dStatisticPost: SampleMeanStatistic | ProportionStatistic;
    mStatisticPre: SampleMeanStatistic | ProportionStatistic;
    dStatisticPre: SampleMeanStatistic | ProportionStatistic;
    mPostMPreSumOfProducts: number;
    dPostDPreSumOfProducts: number;
    mPreDPreSumOfProducts: number;
    mPostDPostSumOfProducts: number;
    mPostDPreSumOfProducts: number;
    mPreDPostSumOfProducts: number;
    theta: number | null;
  }) {
    super(args.n);
    if (args.mStatisticPost.constructor !== args.mStatisticPre.constructor) {
      throw new TypeError(
        "mStatisticPost and mStatisticPre must be of the same type",
      );
    }
    if (args.dStatisticPost.constructor !== args.dStatisticPre.constructor) {
      throw new TypeError(
        "dStatisticPost and dStatisticPre must be of the same type",
      );
    }
    this.mStatisticPost = args.mStatisticPost;
    this.dStatisticPost = args.dStatisticPost;
    this.mStatisticPre = args.mStatisticPre;
    this.dStatisticPre = args.dStatisticPre;
    this.mPostMPreSumOfProducts = args.mPostMPreSumOfProducts;
    this.dPostDPreSumOfProducts = args.dPostDPreSumOfProducts;
    this.mPreDPreSumOfProducts = args.mPreDPreSumOfProducts;
    this.mPostDPostSumOfProducts = args.mPostDPostSumOfProducts;
    this.mPostDPreSumOfProducts = args.mPostDPreSumOfProducts;
    this.mPreDPostSumOfProducts = args.mPreDPostSumOfProducts;
    this.theta = args.theta;
  }

  add(
    other: RegressionAdjustedRatioStatistic,
  ): RegressionAdjustedRatioStatistic {
    return new RegressionAdjustedRatioStatistic({
      n: this.n + other.n,
      mStatisticPost: this.mStatisticPost.add(other.mStatisticPost),
      dStatisticPost: this.dStatisticPost.add(other.dStatisticPost),
      mStatisticPre: this.mStatisticPre.add(other.mStatisticPre),
      dStatisticPre: this.dStatisticPre.add(other.dStatisticPre),
      mPostMPreSumOfProducts:
        this.mPostMPreSumOfProducts + other.mPostMPreSumOfProducts,
      dPostDPreSumOfProducts:
        this.dPostDPreSumOfProducts + other.dPostDPreSumOfProducts,
      mPreDPreSumOfProducts:
        this.mPreDPreSumOfProducts + other.mPreDPreSumOfProducts,
      mPostDPostSumOfProducts:
        this.mPostDPostSumOfProducts + other.mPostDPostSumOfProducts,
      mPostDPreSumOfProducts:
        this.mPostDPreSumOfProducts + other.mPostDPreSumOfProducts,
      mPreDPostSumOfProducts:
        this.mPreDPostSumOfProducts + other.mPreDPostSumOfProducts,
      theta: null,
    });
  }

  withTheta(theta: number): RegressionAdjustedRatioStatistic {
    return new RegressionAdjustedRatioStatistic({
      n: this.n,
      mStatisticPost: this.mStatisticPost,
      dStatisticPost: this.dStatisticPost,
      mStatisticPre: this.mStatisticPre,
      dStatisticPre: this.dStatisticPre,
      mPostMPreSumOfProducts: this.mPostMPreSumOfProducts,
      dPostDPreSumOfProducts: this.dPostDPreSumOfProducts,
      mPreDPreSumOfProducts: this.mPreDPreSumOfProducts,
      mPostDPostSumOfProducts: this.mPostDPostSumOfProducts,
      mPostDPreSumOfProducts: this.mPostDPreSumOfProducts,
      mPreDPostSumOfProducts: this.mPreDPostSumOfProducts,
      theta,
    });
  }

  get meanPost(): number {
    if (this.dStatisticPost.sum === 0) return 0;
    return this.mStatisticPost.sum / this.dStatisticPost.sum;
  }

  get meanPre(): number {
    if (this.dStatisticPre.sum === 0) return 0;
    return this.mStatisticPre.sum / this.dStatisticPre.sum;
  }

  get mean(): number {
    if (this.dStatisticPost.sum === 0 || this.dStatisticPre.sum === 0) {
      return 0;
    }
    const theta = this.theta ?? 0;
    return this.meanPost - theta * this.meanPre;
  }

  get unadjustedMean(): number {
    return this.meanPost;
  }

  get variance(): number {
    return quadForm(this.nabla, this.lambdaMatrix);
  }

  get unadjustedVariance(): number {
    const nablaTop = this.nabla.slice(0, 2);
    const lambdaTopLeft = block(this.lambdaMatrix, 0, 2, 0, 2);
    return quadForm(nablaTop, lambdaTopLeft);
  }

  get varPre(): number {
    const nablaBottom = this.nabla.slice(2, 4);
    const lambdaBottomRight = block(this.lambdaMatrix, 2, 4, 2, 4);
    return quadForm(nablaBottom, lambdaBottomRight);
  }

  get covariance(): number {
    const nablaBottom = this.nabla.slice(2, 4);
    const nablaTop = this.nabla.slice(0, 2);
    const lambdaBottomLeft = block(this.lambdaMatrix, 2, 4, 0, 2);
    return bilinearForm(nablaBottom, lambdaBottomLeft, nablaTop);
  }

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

  get betahat(): number[] {
    return [this.meanMPost, this.meanDPost, this.meanMPre, this.meanDPre];
  }

  get lambdaMatrix(): number[][] {
    return [
      [this.varMPost, this.covMPostDPost, this.covMPostMPre, this.covMPostDPre],
      [this.covMPostDPost, this.varDPost, this.covDPostMPre, this.covDPostDPre],
      [this.covMPostMPre, this.covDPostMPre, this.varMPre, this.covMPreDPre],
      [this.covMPostDPre, this.covDPostDPre, this.covMPreDPre, this.varDPre],
    ];
  }

  /** Vector of partial derivatives for the absolute case. */
  get nabla(): number[] {
    const theta = this.theta ?? 0;
    const b = this.betahat;
    if (b[1] === 0 || b[3] === 0) {
      return [0, 0, 0, 0];
    }
    return [
      1 / b[1],
      -b[0] / b[1] ** 2,
      -theta / b[3],
      (theta * b[2]) / b[3] ** 2,
    ];
  }

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
}

function block(
  m: number[][],
  rowStart: number,
  rowEnd: number,
  colStart: number,
  colEnd: number,
): number[][] {
  const out: number[][] = [];
  for (let i = rowStart; i < rowEnd; i++) {
    out.push(m[i].slice(colStart, colEnd));
  }
  return out;
}

export function computeThetaRegressionAdjustedRatio(
  a: RegressionAdjustedRatioStatistic,
  b: RegressionAdjustedRatioStatistic,
): number {
  const aOne = a.withTheta(1);
  const bOne = b.withTheta(1);
  if (aOne.varPre + bOne.varPre === 0) return 0;
  return -(aOne.covariance + bOne.covariance) / (aOne.varPre + bOne.varPre);
}

const QUANTILE_MULTIPLIER = normPpf(1.0 - 0.5 * 0.05);

export class QuantileStatistic extends Statistic {
  readonly nStar: number;
  readonly nu: number;
  readonly quantileHat: number;
  readonly quantileLower: number;
  readonly quantileUpper: number;

  constructor(args: {
    n: number;
    nStar: number;
    nu: number;
    quantileHat: number;
    quantileLower: number;
    quantileUpper: number;
  }) {
    super(args.n);
    this.nStar = args.nStar;
    this.nu = args.nu;
    this.quantileHat = args.quantileHat;
    this.quantileLower = args.quantileLower;
    this.quantileUpper = args.quantileUpper;
  }

  get hasZeroVariance(): boolean {
    const multiplier = QUANTILE_MULTIPLIER;
    const quantileAboveOne =
      this.n <= (multiplier ** 2 * this.nu) / (1.0 - this.nu);
    const quantileBelowZero =
      this.n <= (multiplier ** 2 * (1.0 - this.nu)) / this.nu;
    if (quantileAboveOne || quantileBelowZero) {
      return true;
    }
    return this.varianceInit <= 0.0 && this.n < 1000;
  }

  get mean(): number {
    return this.quantileHat;
  }

  get unadjustedMean(): number {
    return this.mean;
  }

  get varianceInit(): number {
    if (this.n <= 1) return 0;
    const num = this.quantileUpper - this.quantileLower;
    const den = 2 * QUANTILE_MULTIPLIER;
    return (this.nStar / this.n) * (this.n - 1) * (num / den) ** 2;
  }

  get variance(): number {
    if (this.n < 100) {
      return this.varianceInit;
    }
    return Math.max(this.varianceInit, 1e-5);
  }
}

export class QuantileClusteredStatistic extends QuantileStatistic {
  readonly mainSum: number;
  readonly mainSumSquares: number;
  readonly denominatorSum: number;
  readonly denominatorSumSquares: number;
  readonly mainDenominatorSumProduct: number;
  readonly nClusters: number;

  constructor(args: {
    n: number;
    nStar: number;
    nu: number;
    quantileHat: number;
    quantileLower: number;
    quantileUpper: number;
    mainSum: number;
    mainSumSquares: number;
    denominatorSum: number;
    denominatorSumSquares: number;
    mainDenominatorSumProduct: number;
    nClusters: number;
  }) {
    super(args);
    this.mainSum = args.mainSum;
    this.mainSumSquares = args.mainSumSquares;
    this.denominatorSum = args.denominatorSum;
    this.denominatorSumSquares = args.denominatorSumSquares;
    this.mainDenominatorSumProduct = args.mainDenominatorSumProduct;
    this.nClusters = args.nClusters;
  }

  get varianceInit(): number {
    if (
      this.n <= 1 ||
      this.nu === 0 ||
      this.nClusters <= 1 ||
      this.denominatorSum <= 0
    ) {
      return 0;
    }
    const vIid = super.varianceInit;
    const vNuIid = (this.nu * (1.0 - this.nu)) / this.n;
    const vNuCluster = this.clusterVariance;
    return (vIid * vNuCluster) / vNuIid;
  }

  get clusterVariance(): number {
    const muS = this.mainSum / this.nClusters;
    const muN = this.denominatorSum / this.nClusters;
    const sigma2S =
      ((this.mainSumSquares / this.nClusters - muS * muS) * this.nClusters) /
      (this.nClusters - 1);
    const sigma2N =
      ((this.denominatorSumSquares / this.nClusters - muN * muN) *
        this.nClusters) /
      (this.nClusters - 1);
    const sigmaSN =
      ((this.mainDenominatorSumProduct / this.nClusters - muS * muN) *
        this.nClusters) /
      (this.nClusters - 1);
    const num =
      sigma2S - (2 * muS * sigmaSN) / muN + (muS ** 2 * sigma2N) / muN ** 2;
    const den = this.nClusters * muN ** 2;
    return num / den;
  }
}

export type TestStatistic =
  | ProportionStatistic
  | SampleMeanStatistic
  | RegressionAdjustedStatistic
  | RatioStatistic
  | QuantileStatistic
  | QuantileClusteredStatistic
  | RegressionAdjustedRatioStatistic;

export type SummableStatistic =
  | ProportionStatistic
  | SampleMeanStatistic
  | RegressionAdjustedStatistic
  | RatioStatistic
  | RegressionAdjustedRatioStatistic;

export type BanditStatistic =
  | SampleMeanStatistic
  | RatioStatistic
  | RegressionAdjustedStatistic;

export type ScaledImpactStatistic =
  | ProportionStatistic
  | SampleMeanStatistic
  | RegressionAdjustedStatistic;

export type BanditPeriodDataSampleMean = {
  stats: SampleMeanStatistic[];
  weights: number[];
};

export type BanditPeriodDataRatio = {
  stats: RatioStatistic[];
  weights: number[];
};

export type BanditPeriodDataCuped = {
  stats: RegressionAdjustedStatistic[];
  weights: number[];
};

/** Apply a shared theta to two RA statistics; revert to non-RA when theta is ~0. */
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
      return [statA.postStatistic, statB.postStatistic];
    }
    return [statA.withTheta(theta), statB.withTheta(theta)];
  }

  if (
    statA instanceof RegressionAdjustedRatioStatistic &&
    statB instanceof RegressionAdjustedRatioStatistic &&
    (statA.theta === null || statB.theta === null)
  ) {
    const theta = computeThetaRegressionAdjustedRatio(statA, statB);
    if (Math.abs(theta) < 1e-8) {
      const revertedA = new RatioStatistic({
        n: statA.n,
        mStatistic: statA.mStatisticPost,
        dStatistic: statA.dStatisticPost,
        mDSumOfProducts: statA.mPostDPostSumOfProducts,
      });
      const revertedB = new RatioStatistic({
        n: statB.n,
        mStatistic: statB.mStatisticPost,
        dStatistic: statB.dStatisticPost,
        mDSumOfProducts: statB.mPostDPostSumOfProducts,
      });
      return [revertedA, revertedB];
    }
    return [statA.withTheta(theta), statB.withTheta(theta)];
  }

  return [statA, statB];
}
