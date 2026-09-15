import { armSseDirect } from "../src/contextualBanditWeights";
import { SampleMeanStatistic } from "../src/statistics";

/**
 * `armSseDirect(n, sum, sumSquares)` is the `(n - 1) * variance` that
 * `sumOfSquaredErrorsFromArms` sums via `SampleMeanStatistic`, computed inline
 * without allocating a statistic. These tests pin that equivalence.
 *
 * The function takes no metric-type flag: binomial metrics are handled by the
 * pipeline recasting them to a sample mean with `sumSquares = sum` (valid
 * because `x^2 = x` for 0/1 data), so the same call reproduces the binomial
 * path in `armMomentStatForBandit`.
 */

/** Reference value using the real statistic class (the path armSseDirect replaces). */
function referenceSse(n: number, sum: number, sumSquares: number): number {
  const stat = new SampleMeanStatistic({ n, sum, sumSquares });
  return (stat.n - 1) * stat.variance;
}

/** Relative closeness: armSseDirect matches the reference up to fp rounding. */
function expectClose(actual: number, expected: number): void {
  const tol = 1e-9 * Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

describe("armSseDirect", () => {
  describe("count / sample-mean metrics", () => {
    const cases: Array<{ n: number; sum: number; sumSquares: number }> = [
      { n: 0, sum: 0, sumSquares: 0 },
      { n: 1, sum: 5, sumSquares: 25 },
      { n: 2, sum: 3, sumSquares: 5 },
      { n: 10, sum: 20, sumSquares: 60 },
      { n: 4, sum: 8, sumSquares: 16 }, // zero within-group variance
      { n: 1000, sum: 2500, sumSquares: 8000 },
      { n: 1_000_000, sum: 500_000, sumSquares: 400_000 },
    ];

    it.each(cases)(
      "matches (n-1)*SampleMeanStatistic.variance for n=$n",
      ({ n, sum, sumSquares }) => {
        expectClose(
          armSseDirect(n, sum, sumSquares),
          referenceSse(n, sum, sumSquares),
        );
      },
    );

    it("returns exactly 0 when n <= 1 (no degrees of freedom)", () => {
      expect(armSseDirect(0, 0, 0)).toBe(0);
      expect(armSseDirect(1, 7, 49)).toBe(0);
    });
  });

  describe("binomial / proportion metrics (sumSquares = sum)", () => {
    // For 0/1 data the pipeline stores `sum` in the sumSquares slot, so the
    // generic formula reproduces the SampleMean recast used for the weights.
    const cases: Array<{ n: number; sum: number }> = [
      { n: 0, sum: 0 },
      { n: 1, sum: 1 },
      { n: 5, sum: 0 }, // p = 0
      { n: 5, sum: 5 }, // p = 1
      { n: 100, sum: 30 },
      { n: 2, sum: 1 },
      { n: 1000, sum: 725 },
    ];

    it.each(cases)(
      "matches the SampleMean recast for n=$n, sum=$sum",
      ({ n, sum }) => {
        expectClose(armSseDirect(n, sum, sum), referenceSse(n, sum, sum));
      },
    );
  });

  it("matches the statistic-class path across a randomized sweep", () => {
    let seed = 12345;
    const rand = (): number => {
      // Deterministic LCG so the sweep is reproducible.
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let t = 0; t < 5000; t++) {
      const binomial = rand() < 0.5;
      const n = Math.floor(rand() * 5000);
      if (binomial) {
        const sum = Math.floor(rand() * (n + 1)); // 0 <= successes <= n
        // Binomial arms carry sumSquares = sum.
        expectClose(armSseDirect(n, sum, sum), referenceSse(n, sum, sum));
      } else {
        const mean = rand() * 100;
        const sum = mean * n;
        const variance = rand() * 50;
        const sumSquares = mean * mean * n + Math.max(0, n - 1) * variance;
        expectClose(
          armSseDirect(n, sum, sumSquares),
          referenceSse(n, sum, sumSquares),
        );
      }
    }
  });
});
