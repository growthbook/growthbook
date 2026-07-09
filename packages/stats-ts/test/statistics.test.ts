import {
  ProportionStatistic,
  QuantileClusteredStatistic,
  QuantileStatistic,
  RatioStatistic,
  RegressionAdjustedRatioStatistic,
  RegressionAdjustedStatistic,
  SampleMeanStatistic,
  computeCovariance,
  computeTheta,
  computeThetaRegressionAdjustedRatio,
  createJointStatistic,
  createThetaAdjustedStatistics,
} from "../src/statistics";
import { varianceOfRatios } from "../src/utils";

const N = 4;
const METRIC_1 = [0.3, 0.5, 0.9, 22];
const METRIC_2 = [1, 1, 1];
const METRIC_3 = [2, 1, 5, 3];

const sumOf = (a: number[]) => a.reduce((s, x) => s + x, 0);
const sumSq = (a: number[]) => a.reduce((s, x) => s + x * x, 0);
const sumProd = (a: number[], b: number[]) =>
  a.reduce((s, _, i) => s + a[i] * b[i], 0);

const sampleMean = (a: number[], n: number = a.length) =>
  new SampleMeanStatistic({ n, sum: sumOf(a), sumSquares: sumSq(a) });

describe("SampleMeanStatistic", () => {
  it("matches np.mean / np.var(ddof=1)", () => {
    const stat = sampleMean(METRIC_1, N);
    expect(stat.mean).toBeCloseTo(5.925, 9);
    expect(stat.variance).toBeCloseTo(114.90916666666667, 9);
    expect(stat.unadjustedMean).toBe(stat.mean);
    expect(stat.unadjustedVariance).toBe(stat.variance);
  });

  it("has zero variance and zero mean at the degenerate sizes", () => {
    expect(sampleMean(METRIC_1, 1).variance).toBe(0);
    expect(new SampleMeanStatistic({ n: 0, sum: 0, sumSquares: 0 }).mean).toBe(
      0,
    );
  });

  it("stddev is sqrt(variance), or 0 when variance <= 0", () => {
    const stat = sampleMean(METRIC_3, N);
    expect(stat.stddev).toBeCloseTo(Math.sqrt(stat.variance), 12);
    expect(sampleMean(METRIC_3, 1).stddev).toBe(0);
  });

  it("adds field-wise", () => {
    const a = new SampleMeanStatistic({ n: 4, sum: 10, sumSquares: 75 });
    const b = new SampleMeanStatistic({ n: 6, sum: 4, sumSquares: 7 });
    const sum = a.add(b);
    expect(sum.n).toBe(10);
    expect(sum.sum).toBe(14);
    expect(sum.sumSquares).toBe(82);
  });
});

describe("ProportionStatistic", () => {
  it("treats sumSquares as sum and uses p*(1-p) variance", () => {
    const stat = new ProportionStatistic({ n: N, sum: sumOf(METRIC_2) });
    const p = sumOf(METRIC_2) / N;
    expect(stat.sumSquares).toBe(stat.sum);
    expect(stat.mean).toBeCloseTo(p, 12);
    expect(stat.variance).toBeCloseTo(p * (1 - p), 12);
    expect(stat.unadjustedMean).toBe(stat.mean);
  });

  it("has zero mean when n is 0", () => {
    expect(new ProportionStatistic({ n: 0, sum: 0 }).mean).toBe(0);
  });

  it("adds into a SampleMeanStatistic with sumSquares == summed sums", () => {
    const a = new ProportionStatistic({ n: 4, sum: 3 });
    const b = new ProportionStatistic({ n: 2, sum: 1 });
    const sum = a.add(b);
    expect(sum).toBeInstanceOf(SampleMeanStatistic);
    expect(sum.n).toBe(6);
    expect(sum.sum).toBe(4);
    expect(sum.sumSquares).toBe(4);
  });
});

describe("RatioStatistic", () => {
  const makeRatio = (dSum?: number) => {
    const mStat = sampleMean(METRIC_1, N);
    const dStat =
      dSum === undefined
        ? sampleMean(METRIC_3, N)
        : new SampleMeanStatistic({
            n: N,
            sum: dSum,
            sumSquares: sumSq(METRIC_3),
          });
    return new RatioStatistic({
      n: N,
      mStatistic: mStat,
      dStatistic: dStat,
      mDSumOfProducts: sumProd(METRIC_1, METRIC_3),
    });
  };

  it("covariance matches np.cov(METRIC_1, METRIC_3)[0, 1]", () => {
    expect(makeRatio().covariance).toBeCloseTo(2.1416666666666666, 9);
  });

  it("mean is sum_m / sum_d", () => {
    expect(makeRatio().mean).toBeCloseTo(23.7 / 11, 9);
    expect(makeRatio().mean).toBe(makeRatio().unadjustedMean);
  });

  it("variance delegates to varianceOfRatios with the ratio's moments", () => {
    const stat = makeRatio();
    const expected = varianceOfRatios(
      stat.mStatistic.mean,
      stat.mStatistic.variance,
      stat.dStatistic.mean,
      stat.dStatistic.variance,
      stat.covariance,
    );
    expect(stat.variance).toBeCloseTo(expected, 9);
    expect(stat.variance).toBeGreaterThan(0);
  });

  it("has zero variance and mean when the denominator sum is 0", () => {
    expect(makeRatio(0).variance).toBe(0);
    expect(makeRatio(0).mean).toBe(0);
  });

  it("adds field-wise across constituent statistics", () => {
    const sum = makeRatio().add(makeRatio());
    expect(sum.n).toBe(2 * N);
    expect(sum.mStatistic.sum).toBeCloseTo(2 * sumOf(METRIC_1), 9);
    expect(sum.dStatistic.sum).toBeCloseTo(2 * sumOf(METRIC_3), 9);
    expect(sum.mDSumOfProducts).toBeCloseTo(2 * sumProd(METRIC_1, METRIC_3), 9);
  });
});

describe("RegressionAdjustedStatistic", () => {
  const makeRA = (theta: number | null) =>
    new RegressionAdjustedStatistic({
      n: N,
      postStatistic: sampleMean(METRIC_3, N),
      preStatistic: sampleMean(METRIC_1, N),
      postPreSumOfProducts: sumProd(METRIC_1, METRIC_3),
      theta,
    });

  it("reduces to the post statistic when theta = 0", () => {
    const ra = makeRA(0);
    expect(ra.mean).toBeCloseTo(2.75, 9);
    expect(ra.variance).toBeCloseTo(ra.postStatistic.variance, 12);
  });

  it("adjusts the mean and variance when theta is non-zero", () => {
    const ra = makeRA(0.23);
    expect(ra.mean).toBeCloseTo(1.38725, 9);
    expect(ra.unadjustedMean).toBeCloseTo(2.75, 9);
    expect(ra.unadjustedVariance).toBeCloseTo(ra.postStatistic.variance, 12);
    expect(ra.variance).toBeCloseTo(8.0101949, 5);
    expect(ra.variance).not.toBeCloseTo(ra.postStatistic.variance, 5);
  });

  it("covariance matches computeCovariance over post/pre", () => {
    const ra = makeRA(0);
    expect(ra.covariance).toBeCloseTo(2.1416666666666666, 9);
  });

  it("has zero variance for n <= 1", () => {
    const ra = new RegressionAdjustedStatistic({
      n: 1,
      postStatistic: sampleMean(METRIC_3, 1),
      preStatistic: sampleMean(METRIC_1, 1),
      postPreSumOfProducts: sumProd(METRIC_1, METRIC_3),
      theta: 0.3,
    });
    expect(ra.variance).toBe(0);
  });

  it("withTheta returns a copy carrying the new theta", () => {
    const ra = makeRA(null).withTheta(0.5);
    expect(ra.theta).toBe(0.5);
    expect(ra.mean).toBeCloseTo(2.75 - 0.5 * 5.925, 9);
  });

  it("add sums constituents and clears theta", () => {
    const sum = makeRA(0.23).add(makeRA(0.23));
    expect(sum.n).toBe(2 * N);
    expect(sum.postStatistic.sum).toBeCloseTo(2 * sumOf(METRIC_3), 9);
    expect(sum.preStatistic.sum).toBeCloseTo(2 * sumOf(METRIC_1), 9);
    expect(sum.theta).toBeNull();
  });

  it("throws when post and pre statistics differ in type", () => {
    expect(
      () =>
        new RegressionAdjustedStatistic({
          n: N,
          postStatistic: sampleMean(METRIC_3, N),
          preStatistic: new ProportionStatistic({ n: N, sum: 2 }),
          postPreSumOfProducts: 0,
          theta: 0,
        }),
    ).toThrow(TypeError);
  });
});

describe("computeCovariance", () => {
  it("uses the sample-mean form for non-proportion statistics", () => {
    const a = sampleMean(METRIC_1, N);
    const b = sampleMean(METRIC_3, N);
    const cov = computeCovariance(N, a, b, sumProd(METRIC_1, METRIC_3));
    expect(cov).toBeCloseTo(2.1416666666666666, 9);
  });

  it("uses the proportion-specific form for two proportions", () => {
    const a = new ProportionStatistic({ n: 4, sum: 2 });
    const b = new ProportionStatistic({ n: 4, sum: 3 });
    expect(computeCovariance(4, a, b, 2)).toBeCloseTo(0.125, 12);
  });

  it("is zero for n <= 1", () => {
    const a = sampleMean(METRIC_1, 1);
    const b = sampleMean(METRIC_3, 1);
    expect(computeCovariance(1, a, b, 10)).toBe(0);
  });
});

describe("createJointStatistic", () => {
  it("joins two proportions into a proportion", () => {
    const joint = createJointStatistic(
      new ProportionStatistic({ n: 4, sum: 1 }),
      new ProportionStatistic({ n: 4, sum: 3 }),
      8,
    );
    expect(joint).toBeInstanceOf(ProportionStatistic);
    expect(joint.n).toBe(8);
    expect(joint.sum).toBe(4);
  });

  it("joins two sample means into a sample mean", () => {
    const joint = createJointStatistic(
      sampleMean(METRIC_1, N),
      sampleMean(METRIC_3, N),
      8,
    );
    expect(joint).toBeInstanceOf(SampleMeanStatistic);
    expect(joint.sum).toBeCloseTo(sumOf(METRIC_1) + sumOf(METRIC_3), 9);
    expect(joint.sumSquares).toBeCloseTo(sumSq(METRIC_1) + sumSq(METRIC_3), 9);
  });

  it("throws when the statistic types differ", () => {
    expect(() =>
      createJointStatistic(
        sampleMean(METRIC_1, N),
        new ProportionStatistic({ n: N, sum: 2 }),
        8,
      ),
    ).toThrow();
  });
});

describe("computeTheta", () => {
  const makeRA = () =>
    new RegressionAdjustedStatistic({
      n: N,
      postStatistic: sampleMean(METRIC_3, N),
      preStatistic: sampleMean(METRIC_1, N),
      postPreSumOfProducts: sumProd(METRIC_1, METRIC_3),
      theta: 999,
    });

  it("matches the Python reference value 0.01864", () => {
    expect(computeTheta(makeRA(), makeRA())).toBeCloseTo(0.01864, 5);
  });

  it("returns 0 when a joint statistic has no variance", () => {
    const zeroPre = new RegressionAdjustedStatistic({
      n: N,
      postStatistic: sampleMean(METRIC_3, N),
      preStatistic: new SampleMeanStatistic({ n: N, sum: 0, sumSquares: 0 }),
      postPreSumOfProducts: 0,
      theta: 999,
    });
    expect(computeTheta(zeroPre, zeroPre)).toBe(0);
  });
});

const makeRARatio = (theta: number | null = null) =>
  new RegressionAdjustedRatioStatistic({
    n: 100,
    mStatisticPost: new SampleMeanStatistic({
      n: 100,
      sum: 485.112236689623,
      sumSquares: 2715.484666118136,
    }),
    dStatisticPost: new SampleMeanStatistic({
      n: 100,
      sum: 679.9093275844917,
      sumSquares: 4939.424001640236,
    }),
    mStatisticPre: new SampleMeanStatistic({
      n: 100,
      sum: 192.59138069991536,
      sumSquares: 460.076026390857,
    }),
    dStatisticPre: new SampleMeanStatistic({
      n: 100,
      sum: 290.1398399750233,
      sumSquares: 920.9461385038898,
    }),
    mPostMPreSumOfProducts: 1113.6215759318352,
    dPostDPreSumOfProducts: 2130.9404074446747,
    mPreDPreSumOfProducts: 634.239482353647,
    mPostDPostSumOfProducts: 3602.146836776702,
    mPostDPreSumOfProducts: 1559.2878434944676,
    mPreDPostSumOfProducts: 1460.3181079276983,
    theta,
  });

describe("RegressionAdjustedRatioStatistic", () => {
  it("betahat is [meanMPost, meanDPost, meanMPre, meanDPre]", () => {
    const stat = makeRARatio();
    expect(stat.betahat).toEqual([
      stat.meanMPost,
      stat.meanDPost,
      stat.meanMPre,
      stat.meanDPre,
    ]);
    expect(stat.meanMPost).toBeCloseTo(4.85112236689623, 9);
    expect(stat.meanDPost).toBeCloseTo(6.799093275844917, 9);
  });

  it("mean reduces to meanPost when theta is null (treated as 0)", () => {
    const stat = makeRARatio(null);
    expect(stat.mean).toBe(stat.meanPost);
    expect(stat.unadjustedMean).toBe(stat.meanPost);
    expect(stat.meanPost).toBeCloseTo(0.7135, 4);
  });

  it("mean subtracts theta * meanPre when theta is set", () => {
    const stat = makeRARatio(0.5);
    expect(stat.mean).toBeCloseTo(stat.meanPost - 0.5 * stat.meanPre, 12);
  });

  it("returns zero means when a denominator sum is 0", () => {
    const stat = new RegressionAdjustedRatioStatistic({
      ...extractArgs(makeRARatio()),
      dStatisticPost: new SampleMeanStatistic({
        n: 100,
        sum: 0,
        sumSquares: 1,
      }),
    });
    expect(stat.meanPost).toBe(0);
    expect(stat.mean).toBe(0);
  });

  it("covariance getters delegate to computeCovariance with the right products", () => {
    const stat = makeRARatio();
    expect(stat.covMPostDPost).toBeCloseTo(
      computeCovariance(
        stat.n,
        stat.mStatisticPost,
        stat.dStatisticPost,
        stat.mPostDPostSumOfProducts,
      ),
      12,
    );
    expect(stat.covMPostDPre).toBeCloseTo(
      computeCovariance(
        stat.n,
        stat.mStatisticPost,
        stat.dStatisticPre,
        stat.mPostDPreSumOfProducts,
      ),
      12,
    );
    expect(stat.covDPostMPre).toBeCloseTo(
      computeCovariance(
        stat.n,
        stat.dStatisticPost,
        stat.mStatisticPre,
        stat.mPreDPostSumOfProducts,
      ),
      12,
    );
  });

  it("nabla follows the documented partial-derivative formula", () => {
    const stat = makeRARatio().withTheta(1);
    const [b0, b1, b2, b3] = stat.betahat;
    expect(stat.nabla).toEqual([
      1 / b1,
      -b0 / b1 ** 2,
      -1 / b3,
      (1 * b2) / b3 ** 2,
    ]);
  });

  it("nabla is all zeros when a denominator mean is 0", () => {
    const stat = new RegressionAdjustedRatioStatistic({
      ...extractArgs(makeRARatio(1)),
      dStatisticPost: new SampleMeanStatistic({
        n: 100,
        sum: 0,
        sumSquares: 1,
      }),
    });
    expect(stat.nabla).toEqual([0, 0, 0, 0]);
  });

  it("variance is a positive finite number and changes with theta", () => {
    const unadjusted = makeRARatio(null);
    const adjusted = makeRARatio(1);
    expect(unadjusted.variance).toBeGreaterThan(0);
    expect(Number.isFinite(unadjusted.variance)).toBe(true);
    expect(unadjusted.unadjustedVariance).toBeGreaterThan(0);
    expect(adjusted.variance).not.toBeCloseTo(unadjusted.variance, 9);
  });

  it("withTheta and add behave like the other statistics", () => {
    expect(makeRARatio().withTheta(0.4).theta).toBe(0.4);
    const sum = makeRARatio().add(makeRARatio());
    expect(sum.n).toBe(200);
    expect(sum.mPostDPostSumOfProducts).toBeCloseTo(2 * 3602.146836776702, 6);
    expect(sum.theta).toBeNull();
  });

  it("throws when post/pre types differ for numerator or denominator", () => {
    expect(
      () =>
        new RegressionAdjustedRatioStatistic({
          ...extractArgs(makeRARatio()),
          mStatisticPre: new ProportionStatistic({ n: 100, sum: 1 }),
        }),
    ).toThrow(TypeError);
  });
});

describe("computeThetaRegressionAdjustedRatio", () => {
  it("returns a finite value for the reference pair", () => {
    const theta = computeThetaRegressionAdjustedRatio(
      makeRARatio(),
      makeRARatio(),
    );
    expect(Number.isFinite(theta)).toBe(true);
  });

  it("returns 0 when the pre-period variance is 0", () => {
    const zeroPre = makeZeroPreVarianceRatio();
    expect(computeThetaRegressionAdjustedRatio(zeroPre, zeroPre)).toBe(0);
  });
});

describe("QuantileStatistic", () => {
  const makeQuantile = (overrides: Partial<QuantileArgs> = {}) =>
    new QuantileStatistic({
      n: 11054,
      nStar: 11054,
      nu: 0.9,
      quantileHat: 7.157987489967789,
      quantileLower: 7.098780136176828,
      quantileUpper: 7.217194843758751,
      ...overrides,
    });

  it("mean equals the quantile point estimate", () => {
    const stat = makeQuantile();
    expect(stat.mean).toBe(7.157987489967789);
    expect(stat.unadjustedMean).toBe(stat.mean);
  });

  it("computes varianceInit from the confidence-interval width", () => {
    expect(makeQuantile().varianceInit).toBeCloseTo(10.0864, 2);
  });

  it("variance equals varianceInit for n < 100", () => {
    const stat = makeQuantile({ n: 50 });
    expect(stat.variance).toBe(stat.varianceInit);
  });

  it("floors variance at 1e-5 for n >= 100", () => {
    const stat = makeQuantile({
      quantileLower: 7.15,
      quantileUpper: 7.15,
    });
    expect(stat.varianceInit).toBe(0);
    expect(stat.variance).toBe(1e-5);
  });

  it("varianceInit is 0 for n <= 1", () => {
    expect(makeQuantile({ n: 1 }).varianceInit).toBe(0);
  });

  it("hasZeroVariance is true for small n below the quantile-bound threshold", () => {
    expect(makeQuantile({ n: 30 }).hasZeroVariance).toBe(true);
    expect(makeQuantile().hasZeroVariance).toBe(false);
  });
});

describe("QuantileClusteredStatistic", () => {
  const makeClustered = (overrides: Partial<ClusteredArgs> = {}) =>
    new QuantileClusteredStatistic({
      n: 11054,
      nStar: 11054,
      nu: 0.9,
      quantileHat: 7.157987489967789,
      quantileLower: 7.098780136176828,
      quantileUpper: 7.217194843758751,
      mainSum: 10,
      mainSumSquares: 52,
      denominatorSum: 4,
      denominatorSumSquares: 10,
      mainDenominatorSumProduct: 22,
      nClusters: 2,
      ...overrides,
    });

  it("computes the cluster variance from cluster aggregates", () => {
    expect(makeClustered().clusterVariance).toBeCloseTo(0.5625, 12);
  });

  it("varianceInit is 0 under the documented degenerate conditions", () => {
    expect(makeClustered({ n: 1 }).varianceInit).toBe(0);
    expect(makeClustered({ nu: 0 }).varianceInit).toBe(0);
    expect(makeClustered({ nClusters: 1 }).varianceInit).toBe(0);
    expect(makeClustered({ denominatorSum: 0 }).varianceInit).toBe(0);
  });

  it("varianceInit is finite for a valid configuration", () => {
    const v = makeClustered({ nClusters: 500 }).varianceInit;
    expect(Number.isFinite(v)).toBe(true);
  });
});

describe("createThetaAdjustedStatistics", () => {
  const makeRA = (theta: number | null) =>
    new RegressionAdjustedStatistic({
      n: N,
      postStatistic: sampleMean(METRIC_3, N),
      preStatistic: sampleMean(METRIC_1, N),
      postPreSumOfProducts: sumProd(METRIC_1, METRIC_3),
      theta,
    });

  it("applies the shared theta to two regression-adjusted statistics", () => {
    const [a, b] = createThetaAdjustedStatistics(makeRA(null), makeRA(null));
    expect(a).toBeInstanceOf(RegressionAdjustedStatistic);
    expect(b).toBeInstanceOf(RegressionAdjustedStatistic);
    expect((a as RegressionAdjustedStatistic).theta).toBeCloseTo(0.01864, 5);
  });

  it("reverts to the post statistics when theta is 0", () => {
    const zeroPre = new RegressionAdjustedStatistic({
      n: N,
      postStatistic: sampleMean(METRIC_3, N),
      preStatistic: new SampleMeanStatistic({ n: N, sum: 0, sumSquares: 0 }),
      postPreSumOfProducts: 0,
      theta: null,
    });
    const [a, b] = createThetaAdjustedStatistics(zeroPre, zeroPre);
    expect(a).toBe(zeroPre.postStatistic);
    expect(b).toBe(zeroPre.postStatistic);
  });

  it("applies theta to two regression-adjusted ratio statistics", () => {
    const [a] = createThetaAdjustedStatistics(makeRARatio(), makeRARatio());
    expect(a).toBeInstanceOf(RegressionAdjustedRatioStatistic);
    expect((a as RegressionAdjustedRatioStatistic).theta).not.toBeNull();
  });

  it("reverts ratio statistics to RatioStatistic when theta is ~0", () => {
    const zeroPre = makeZeroPreVarianceRatio();
    const [a, b] = createThetaAdjustedStatistics(zeroPre, zeroPre);
    expect(a).toBeInstanceOf(RatioStatistic);
    expect(b).toBeInstanceOf(RatioStatistic);
  });

  it("returns non-regression-adjusted statistics unchanged", () => {
    const a = sampleMean(METRIC_1, N);
    const b = sampleMean(METRIC_3, N);
    const [outA, outB] = createThetaAdjustedStatistics(a, b);
    expect(outA).toBe(a);
    expect(outB).toBe(b);
  });
});

type QuantileArgs = ConstructorParameters<typeof QuantileStatistic>[0];
type ClusteredArgs = ConstructorParameters<
  typeof QuantileClusteredStatistic
>[0];
type RARatioArgs = ConstructorParameters<
  typeof RegressionAdjustedRatioStatistic
>[0];

function extractArgs(stat: RegressionAdjustedRatioStatistic): RARatioArgs {
  return {
    n: stat.n,
    mStatisticPost: stat.mStatisticPost,
    dStatisticPost: stat.dStatisticPost,
    mStatisticPre: stat.mStatisticPre,
    dStatisticPre: stat.dStatisticPre,
    mPostMPreSumOfProducts: stat.mPostMPreSumOfProducts,
    dPostDPreSumOfProducts: stat.dPostDPreSumOfProducts,
    mPreDPreSumOfProducts: stat.mPreDPreSumOfProducts,
    mPostDPostSumOfProducts: stat.mPostDPostSumOfProducts,
    mPostDPreSumOfProducts: stat.mPostDPreSumOfProducts,
    mPreDPostSumOfProducts: stat.mPreDPostSumOfProducts,
    theta: stat.theta,
  };
}

function makeZeroPreVarianceRatio(): RegressionAdjustedRatioStatistic {
  const constantPreM = new SampleMeanStatistic({
    n: 100,
    sum: 100,
    sumSquares: 100,
  });
  const constantPreD = new SampleMeanStatistic({
    n: 100,
    sum: 200,
    sumSquares: 400,
  });
  return new RegressionAdjustedRatioStatistic({
    n: 100,
    mStatisticPost: new SampleMeanStatistic({
      n: 100,
      sum: 485.112236689623,
      sumSquares: 2715.484666118136,
    }),
    dStatisticPost: new SampleMeanStatistic({
      n: 100,
      sum: 679.9093275844917,
      sumSquares: 4939.424001640236,
    }),
    mStatisticPre: constantPreM,
    dStatisticPre: constantPreD,
    mPostMPreSumOfProducts: 0,
    dPostDPreSumOfProducts: 0,
    mPreDPreSumOfProducts: 200,
    mPostDPostSumOfProducts: 3602.146836776702,
    mPostDPreSumOfProducts: 0,
    mPreDPostSumOfProducts: 0,
    theta: null,
  });
}
