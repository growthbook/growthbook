import { armSseDirect } from "../src/contextualBanditWeights";
import { SampleMeanStatistic, ProportionStatistic } from "../src/statistics";

/**
 * The quantity `armSseDirect` computes inline is, by construction, exactly the
 * `(n - 1) * variance` that `sumOfSquaredErrorsFromArms` sums via the canonical
 * statistic classes. These tests pin that equivalence so the inline arithmetic
 * stays tied to `SampleMeanStatistic` / `ProportionStatistic` as the source of
 * truth.
 */

/** Reference value using the real statistic class (the path armSseDirect replaces). */
function referenceSse(
  n: number,
  sum: number,
  sumSquares: number,
  isBinomial: boolean,
): number {
  const stat = isBinomial
    ? new ProportionStatistic({ n, sum })
    : new SampleMeanStatistic({ n, sum, sumSquares });
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
          armSseDirect(n, sum, sumSquares, false),
          referenceSse(n, sum, sumSquares, false),
        );
      },
    );

    it("returns exactly 0 when n <= 1 (no degrees of freedom)", () => {
      expect(armSseDirect(0, 0, 0, false)).toBe(0);
      expect(armSseDirect(1, 7, 49, false)).toBe(0);
    });
  });

  describe("binomial / proportion metrics", () => {
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
      "matches (n-1)*ProportionStatistic.variance for n=$n, sum=$sum",
      ({ n, sum }) => {
        // sumSquares is unused for binomial; pass a garbage value to prove it.
        expectClose(
          armSseDirect(n, sum, 123456, true),
          referenceSse(n, sum, 0, true),
        );
      },
    );

    it("ignores sumSquares entirely", () => {
      expect(armSseDirect(100, 30, 0, true)).toBe(
        armSseDirect(100, 30, 999999, true),
      );
    });
  });

  it("matches the statistic-class path across a randomized sweep", () => {
    let seed = 12345;
    const rand = (): number => {
      // Deterministic LCG so the sweep is reproducible.
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let t = 0; t < 5000; t++) {
      const isBinomial = rand() < 0.5;
      const n = Math.floor(rand() * 5000);
      if (isBinomial) {
        const sum = Math.floor(rand() * (n + 1)); // 0 <= successes <= n
        expectClose(
          armSseDirect(n, sum, 0, true),
          referenceSse(n, sum, 0, true),
        );
      } else {
        const mean = rand() * 100;
        const sum = mean * n;
        const variance = rand() * 50;
        const sumSquares = mean * mean * n + Math.max(0, n - 1) * variance;
        expectClose(
          armSseDirect(n, sum, sumSquares, false),
          referenceSse(n, sum, sumSquares, false),
        );
      }
    }
  });
});
