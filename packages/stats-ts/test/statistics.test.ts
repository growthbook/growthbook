import { ProportionStatistic, SampleMeanStatistic } from "../src/statistics";

const N = 4;
const METRIC_1 = [0.3, 0.5, 0.9, 22];
const METRIC_2 = [1, 1, 1];
const METRIC_3 = [2, 1, 5, 3];

const sumOf = (a: number[]) => a.reduce((s, x) => s + x, 0);
const sumSq = (a: number[]) => a.reduce((s, x) => s + x * x, 0);

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
