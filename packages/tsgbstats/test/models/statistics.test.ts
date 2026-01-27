/**
 * Tests for statistic classes.
 * These tests verify the basic statistical calculations match Python gbstats.
 */

import {
  loadStatisticsFixtures,
  getTestCase,
  FixtureFile,
} from "../helpers/fixtureLoader";
import { round, approxEqual } from "../helpers/testUtils";
import {
  SampleMeanStatistic,
  ProportionStatistic,
  RatioStatistic,
  RegressionAdjustedStatistic,
  QuantileStatistic,
  computeTheta,
  computeCovariance,
  sumStats,
} from "../../src/models/statistics";
import { EffectMoments } from "../../src/frequentist/postStratification";

// Helper to create statistic from fixture input
function createStatisticFromInput(input: Record<string, unknown>) {
  const type = input.type as string;
  switch (type) {
    case "SampleMeanStatistic":
      return new SampleMeanStatistic({
        n: input.n as number,
        sum: input.sum as number,
        sum_squares: input.sum_squares as number,
      });
    case "ProportionStatistic":
      return new ProportionStatistic({
        n: input.n as number,
        sum: input.sum as number,
      });
    case "QuantileStatistic":
      return new QuantileStatistic({
        n: input.n as number,
        n_star: input.n_star as number,
        nu: input.nu as number,
        quantile_hat: input.quantile_hat as number,
        quantile_lower: input.quantile_lower as number,
        quantile_upper: input.quantile_upper as number,
      });
    case "RegressionAdjustedStatistic": {
      const postStat = createStatisticFromInput(
        input.post_statistic as Record<string, unknown>,
      );
      const preStat = createStatisticFromInput(
        input.pre_statistic as Record<string, unknown>,
      );
      return new RegressionAdjustedStatistic({
        n: input.n as number,
        post_statistic: postStat as SampleMeanStatistic | ProportionStatistic,
        pre_statistic: preStat as SampleMeanStatistic | ProportionStatistic,
        post_pre_sum_of_products: input.post_pre_sum_of_products as number,
        theta: input.theta as number | null,
      });
    }
    default:
      throw new Error(`Unknown statistic type: ${type}`);
  }
}

describe("SampleMeanStatistic", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadStatisticsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute mean and variance correctly", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "SampleMeanStatistic",
      "test_sample_mean_statistic",
    );
    const inputs = testCase.inputs;

    const stat = new SampleMeanStatistic({
      n: inputs.n as number,
      sum: inputs.sum as number,
      sum_squares: inputs.sum_squares as number,
    });

    const expected = testCase.expected;
    expect(approxEqual(stat.mean, expected.mean as number)).toBe(true);
    expect(approxEqual(stat.variance, expected.variance as number)).toBe(true);
    expect(stat.mean).toBe(stat.unadjustedMean);
  });

  it("should return 0 variance for n=1", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "SampleMeanStatistic",
      "test_sample_mean_statistic_low_n",
    );
    const inputs = testCase.inputs;

    const stat = new SampleMeanStatistic({
      n: inputs.n as number,
      sum: inputs.sum as number,
      sum_squares: inputs.sum_squares as number,
    });

    expect(stat.variance).toBe(0);
  });

  it("should add statistics correctly", () => {
    const stat1 = new SampleMeanStatistic({
      n: 100,
      sum: 50,
      sum_squares: 100,
    });
    const stat2 = new SampleMeanStatistic({
      n: 100,
      sum: 60,
      sum_squares: 120,
    });
    const result = stat1.add(stat2);

    expect(result.n).toBe(200);
    expect(result.sum).toBe(110);
    expect(result.sumSquares).toBe(220);
  });
});

describe("ProportionStatistic", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadStatisticsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute mean and variance correctly", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "ProportionStatistic",
      "test_proportion_statistic",
    );
    const inputs = testCase.inputs;

    const stat = new ProportionStatistic({
      n: inputs.n as number,
      sum: inputs.sum as number,
    });

    const expected = testCase.expected;
    expect(approxEqual(stat.mean, expected.mean as number)).toBe(true);
    expect(approxEqual(stat.variance, expected.variance as number)).toBe(true);
    expect(stat.sum).toBe(stat.sumSquares); // sum_squares equals sum for proportion
  });

  it("should add to SampleMeanStatistic", () => {
    const prop = new ProportionStatistic({ n: 100, sum: 50 });
    const mean = new SampleMeanStatistic({ n: 100, sum: 60, sum_squares: 120 });
    const result = prop.add(mean);

    expect(result.n).toBe(200);
    expect(result.sum).toBe(110);
    expect(result.sumSquares).toBe(170); // 50 + 120
  });
});

describe("RatioStatistic", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadStatisticsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute covariance correctly", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "RatioStatistic",
      "test_ratio_statistic_covariance",
    );
    const inputs = testCase.inputs;

    const mStatInput = inputs.m_statistic as Record<string, unknown>;
    const dStatInput = inputs.d_statistic as Record<string, unknown>;

    const mStat = new SampleMeanStatistic({
      n: mStatInput.n as number,
      sum: mStatInput.sum as number,
      sum_squares: mStatInput.sum_squares as number,
    });
    const dStat = new SampleMeanStatistic({
      n: dStatInput.n as number,
      sum: dStatInput.sum as number,
      sum_squares: dStatInput.sum_squares as number,
    });

    const stat = new RatioStatistic({
      n: inputs.n as number,
      m_statistic: mStat,
      d_statistic: dStat,
      m_d_sum_of_products: inputs.m_d_sum_of_products as number,
    });

    const expected = testCase.expected;
    expect(approxEqual(stat.covariance, expected.covariance as number)).toBe(
      true,
    );
    expect(stat.mean).toBe(stat.unadjustedMean);
  });

  it("should return 0 variance when denominator is 0", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "RatioStatistic",
      "test_ratio_denom_zero",
    );
    const inputs = testCase.inputs;

    const mStatInput = inputs.m_statistic as Record<string, unknown>;
    const dStatInput = inputs.d_statistic as Record<string, unknown>;

    const mStat = new SampleMeanStatistic({
      n: mStatInput.n as number,
      sum: mStatInput.sum as number,
      sum_squares: mStatInput.sum_squares as number,
    });
    const dStat = new SampleMeanStatistic({
      n: dStatInput.n as number,
      sum: dStatInput.sum as number,
      sum_squares: dStatInput.sum_squares as number,
    });

    const stat = new RatioStatistic({
      n: inputs.n as number,
      m_statistic: mStat,
      d_statistic: dStat,
      m_d_sum_of_products: inputs.m_d_sum_of_products as number,
    });

    expect(stat.variance).toBe(0);
  });
});

describe("RegressionAdjustedStatistic", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadStatisticsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute mean and variance correctly with theta=0", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "RegressionAdjustedStatistic",
      "test_theta_zero",
    );
    const inputs = testCase.inputs;

    const postStatInput = inputs.post_statistic as Record<string, unknown>;
    const preStatInput = inputs.pre_statistic as Record<string, unknown>;

    const postStat = new SampleMeanStatistic({
      n: postStatInput.n as number,
      sum: postStatInput.sum as number,
      sum_squares: postStatInput.sum_squares as number,
    });
    const preStat = new SampleMeanStatistic({
      n: preStatInput.n as number,
      sum: preStatInput.sum as number,
      sum_squares: preStatInput.sum_squares as number,
    });

    const stat = new RegressionAdjustedStatistic({
      n: inputs.n as number,
      post_statistic: postStat,
      pre_statistic: preStat,
      post_pre_sum_of_products: inputs.post_pre_sum_of_products as number,
      theta: inputs.theta as number,
    });

    const expected = testCase.expected;
    expect(approxEqual(stat.mean, expected.mean as number)).toBe(true);
    expect(approxEqual(stat.variance, expected.variance as number)).toBe(true);
  });

  it("should return 0 variance for small n", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "RegressionAdjustedStatistic",
      "test_regression_adjusted_small_n",
    );
    const inputs = testCase.inputs;

    const postStatInput = inputs.post_statistic as Record<string, unknown>;
    const preStatInput = inputs.pre_statistic as Record<string, unknown>;

    const postStat = new SampleMeanStatistic({
      n: postStatInput.n as number,
      sum: postStatInput.sum as number,
      sum_squares: postStatInput.sum_squares as number,
    });
    const preStat = new SampleMeanStatistic({
      n: preStatInput.n as number,
      sum: preStatInput.sum as number,
      sum_squares: preStatInput.sum_squares as number,
    });

    const stat = new RegressionAdjustedStatistic({
      n: inputs.n as number,
      post_statistic: postStat,
      pre_statistic: preStat,
      post_pre_sum_of_products: inputs.post_pre_sum_of_products as number,
      theta: inputs.theta as number,
    });

    expect(stat.variance).toBe(0);
  });

  it("should return different mean and variance when theta != 0", () => {
    const postStat = new SampleMeanStatistic({
      n: 4,
      sum: 11,
      sum_squares: 39,
    });
    const preStat = new SampleMeanStatistic({
      n: 4,
      sum: 23.7,
      sum_squares: 489.55,
    });

    const statZero = new RegressionAdjustedStatistic({
      n: 4,
      post_statistic: postStat,
      pre_statistic: preStat,
      post_pre_sum_of_products: 100,
      theta: 0,
    });

    const statNonZero = new RegressionAdjustedStatistic({
      n: 4,
      post_statistic: postStat,
      pre_statistic: preStat,
      post_pre_sum_of_products: 100,
      theta: 0.23,
    });

    expect(statZero.mean).not.toBe(statNonZero.mean);
    expect(statZero.variance).not.toBe(statNonZero.variance);
    expect(statNonZero.unadjustedMean).toBe(statZero.mean);
  });
});

describe("computeTheta", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadStatisticsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute theta correctly", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "compute_theta",
      "test_returns_theta",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    ) as RegressionAdjustedStatistic;
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    ) as RegressionAdjustedStatistic;

    const theta = computeTheta(statA, statB);
    const expected = testCase.expected.theta as number;

    expect(round(theta)).toBe(expected);
  });

  it("should return 0 when pre-statistic has no variance", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "compute_theta",
      "test_returns_0_no_variance",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    ) as RegressionAdjustedStatistic;
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    ) as RegressionAdjustedStatistic;

    expect(computeTheta(statA, statB)).toBe(0);
  });
});

describe("computeCovariance", () => {
  it("should return 0 for n <= 1", () => {
    const statA = new SampleMeanStatistic({ n: 1, sum: 10, sum_squares: 100 });
    const statB = new SampleMeanStatistic({ n: 1, sum: 20, sum_squares: 400 });

    expect(computeCovariance(1, statA, statB, 200)).toBe(0);
  });

  it("should compute covariance correctly for SampleMeanStatistics", () => {
    // Test data from fixtures: METRIC_1 = [0.3, 0.5, 0.9, 22], METRIC_3 = [2, 1, 5, 3]
    // sum_METRIC_1 = 23.7, sum_squares_METRIC_1 = 485.15
    // sum_METRIC_3 = 11, sum_squares_METRIC_3 = 39
    // sum_of_products = 0.3*2 + 0.5*1 + 0.9*5 + 22*3 = 71.6
    const statA = new SampleMeanStatistic({
      n: 4,
      sum: 23.7,
      sum_squares: 485.15,
    });
    const statB = new SampleMeanStatistic({ n: 4, sum: 11, sum_squares: 39 });
    const sumOfProducts = 71.6;

    const cov = computeCovariance(4, statA, statB, sumOfProducts);
    // Expected from fixtures: 2.1416666666666666
    expect(approxEqual(cov, 2.1416667, 1e-4)).toBe(true);
  });
});

describe("sumStats", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadStatisticsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should sum statistics correctly", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(fixtures, "sum_stats", "test_sum_correct");
    const stats = (testCase.inputs.stats as Record<string, unknown>[][]).map(
      (pair) =>
        [
          createStatisticFromInput(pair[0]),
          createStatisticFromInput(pair[1]),
        ] as [SampleMeanStatistic, SampleMeanStatistic],
    );

    const [sumA, sumB] = sumStats(stats);

    const expectedA = testCase.expected.stat_a as Record<string, unknown>;
    const expectedB = testCase.expected.stat_b as Record<string, unknown>;

    expect(sumA.n).toBe(expectedA.n);
    expect(sumA.sum).toBe(expectedA.sum);
    expect(sumA.sumSquares).toBe(expectedA.sum_squares);

    expect(sumB.n).toBe(expectedB.n);
    expect(sumB.sum).toBe(expectedB.sum);
    expect(sumB.sumSquares).toBe(expectedB.sum_squares);
  });
});

describe("QuantileStatistic", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadStatisticsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should sum quantile statistics correctly (single element)", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "QuantileStatistic",
      "test_quantile_sum_single",
    );
    const stats = (testCase.inputs.stats as Record<string, unknown>[][]).map(
      (pair) =>
        [
          createStatisticFromInput(pair[0]),
          createStatisticFromInput(pair[1]),
        ] as [QuantileStatistic, QuantileStatistic],
    );

    const [sumA, sumB] = sumStats(stats);

    const expectedA = testCase.expected.stat_a as Record<string, unknown>;
    const expectedB = testCase.expected.stat_b as Record<string, unknown>;

    // Quantile stats just return themselves when summed (single element)
    expect(sumA.n).toBe(expectedA.n);
    expect(sumB.n).toBe(expectedB.n);
  });

  it("should throw error when summing multiple quantile statistics", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "QuantileStatistic",
      "test_quantile_sum_multiple_fails",
    );
    const stats = (testCase.inputs.stats as Record<string, unknown>[][]).map(
      (pair) =>
        [
          createStatisticFromInput(pair[0]),
          createStatisticFromInput(pair[1]),
        ] as [QuantileStatistic, QuantileStatistic],
    );

    // Should throw an error when summing multiple quantile stats
    expect(() => sumStats(stats)).toThrow();
  });
});

describe("EffectMomentsResult", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadStatisticsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should handle negative variance correctly", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "EffectMomentsResult",
      "test_negative_variance",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    ) as RegressionAdjustedStatistic;
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    ) as RegressionAdjustedStatistic;
    const expected = testCase.expected as Record<string, unknown>;

    // Verify fixture sanity check
    expect(expected.variance).toBeLessThan(0);
    expect(expected.error_message).toBe("ZERO_NEGATIVE_VARIANCE");

    // Create EffectMoments and compute result
    const config = testCase.inputs.config as
      | { difference_type: "relative" | "absolute" }
      | undefined;
    const moments = new EffectMoments([[statA, statB]], {
      differenceType: config?.difference_type || "relative",
    });

    const result = moments.computeResult();

    // Validate result matches expected - only check fields that exist in fixture
    expect(result.errorMessage).toBe(expected.error_message);
    // When there's an error, we return default values
    expect(result.pointEstimate).toBe(0);
    expect(result.standardError).toBe(0);
  });
});
