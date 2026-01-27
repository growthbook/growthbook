/**
 * Tests for post-stratification.
 * These tests load fixtures generated from Python gbstats and verify TypeScript parity.
 */

import {
  loadPostStratificationFixtures,
  getTestCase,
  FixtureFile,
} from "../helpers/fixtureLoader";
import {
  SampleMeanStatistic,
  RatioStatistic,
  RegressionAdjustedStatistic,
  RegressionAdjustedRatioStatistic,
  ProportionStatistic,
} from "../../src/models/statistics";
import {
  EffectMomentsPostStratification,
  ZERO_NEGATIVE_VARIANCE_MESSAGE,
  BASELINE_VARIATION_ZERO_MESSAGE,
} from "../../src/frequentist/postStratification";

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
    case "RatioStatistic": {
      const mStatInput = input.m_statistic as Record<string, unknown>;
      const dStatInput = input.d_statistic as Record<string, unknown>;
      return new RatioStatistic({
        n: input.n as number,
        m_statistic: createStatisticFromInput(
          mStatInput,
        ) as SampleMeanStatistic,
        d_statistic: createStatisticFromInput(
          dStatInput,
        ) as SampleMeanStatistic,
        m_d_sum_of_products: input.m_d_sum_of_products as number,
      });
    }
    case "RegressionAdjustedStatistic": {
      const postStatInput = input.post_statistic as Record<string, unknown>;
      const preStatInput = input.pre_statistic as Record<string, unknown>;
      return new RegressionAdjustedStatistic({
        n: input.n as number,
        post_statistic: createStatisticFromInput(postStatInput) as
          | SampleMeanStatistic
          | ProportionStatistic,
        pre_statistic: createStatisticFromInput(preStatInput) as
          | SampleMeanStatistic
          | ProportionStatistic,
        post_pre_sum_of_products: input.post_pre_sum_of_products as number,
        theta: input.theta as number | null,
      });
    }
    case "RegressionAdjustedRatioStatistic": {
      const mStatPostInput = input.m_statistic_post as Record<string, unknown>;
      const dStatPostInput = input.d_statistic_post as Record<string, unknown>;
      const mStatPreInput = input.m_statistic_pre as Record<string, unknown>;
      const dStatPreInput = input.d_statistic_pre as Record<string, unknown>;
      return new RegressionAdjustedRatioStatistic({
        n: input.n as number,
        m_statistic_post: createStatisticFromInput(
          mStatPostInput,
        ) as SampleMeanStatistic,
        d_statistic_post: createStatisticFromInput(
          dStatPostInput,
        ) as SampleMeanStatistic,
        m_statistic_pre: createStatisticFromInput(
          mStatPreInput,
        ) as SampleMeanStatistic,
        d_statistic_pre: createStatisticFromInput(
          dStatPreInput,
        ) as SampleMeanStatistic,
        m_post_m_pre_sum_of_products:
          input.m_post_m_pre_sum_of_products as number,
        d_post_d_pre_sum_of_products:
          input.d_post_d_pre_sum_of_products as number,
        m_pre_d_pre_sum_of_products:
          input.m_pre_d_pre_sum_of_products as number,
        m_post_d_post_sum_of_products:
          input.m_post_d_post_sum_of_products as number,
        m_post_d_pre_sum_of_products:
          input.m_post_d_pre_sum_of_products as number,
        m_pre_d_post_sum_of_products:
          input.m_pre_d_post_sum_of_products as number,
        theta: input.theta as number | null,
      });
    }
    default:
      throw new Error(`Unknown statistic type: ${type}`);
  }
}

type StatisticType =
  | SampleMeanStatistic
  | RatioStatistic
  | RegressionAdjustedStatistic
  | RegressionAdjustedRatioStatistic
  | ProportionStatistic;

// Helper to create stats list from fixture input
function createStatsListFromInput(statsInput: unknown[][]) {
  return statsInput.map((pair) => [
    createStatisticFromInput(pair[0] as Record<string, unknown>),
    createStatisticFromInput(pair[1] as Record<string, unknown>),
  ]) as Array<[StatisticType, StatisticType]>;
}

// Helper to round result for comparison
function roundEffectMomentsResult(
  result: Record<string, unknown>,
  decimals = 5,
) {
  const factor = Math.pow(10, decimals);
  return {
    point_estimate:
      typeof result.pointEstimate === "number"
        ? Math.round(result.pointEstimate * factor) / factor
        : result.pointEstimate,
    standard_error:
      typeof result.standardError === "number"
        ? Math.round(result.standardError * factor) / factor
        : result.standardError,
    pairwise_sample_size: result.pairwiseSampleSize,
    error_message: result.errorMessage,
    post_stratification_applied: result.postStratificationApplied,
  };
}

describe("EffectMomentsPostStratification", () => {
  let fixtures: FixtureFile | undefined;

  beforeAll(() => {
    try {
      fixtures = loadPostStratificationFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  const testCases = [
    // Error condition tests
    [
      "test_zero_negative_variance",
      "should return default output for zero/negative variance",
    ],
    [
      "test_baseline_variation_zero",
      "should return default output for baseline variation zero",
    ],
    [
      "test_baseline_variation_adjusted_zero",
      "should return default output for baseline variation adjusted zero",
    ],
    // Missing variation data test
    [
      "test_missing_variation_data",
      "should handle missing variation data correctly",
    ],
    // Count metric tests
    [
      "test_post_strat_count_effect_moments_relative",
      "should compute correct result for count post-stratification (relative)",
    ],
    [
      "test_post_strat_count_effect_moments_absolute",
      "should compute correct result for count post-stratification (absolute)",
    ],
    // Ratio metric tests
    [
      "test_post_strat_ratio_effect_moments_relative",
      "should compute correct result for ratio post-stratification (relative)",
    ],
    [
      "test_post_strat_ratio_effect_moments_absolute",
      "should compute correct result for ratio post-stratification (absolute)",
    ],
    // Regression adjusted count tests
    [
      "test_post_strat_count_reg_effect_moments_relative",
      "should compute correct result for count regression adjusted (relative)",
    ],
    [
      "test_post_strat_count_reg_effect_moments_absolute",
      "should compute correct result for count regression adjusted (absolute)",
    ],
    // Regression adjusted ratio tests
    [
      "test_post_strat_ratio_reg_effect_moments_relative",
      "should compute correct result for ratio regression adjusted (relative)",
    ],
    [
      "test_post_strat_ratio_reg_effect_moments_absolute",
      "should compute correct result for ratio regression adjusted (absolute)",
    ],
    // Fallback tests (RA with zero pre-period variance)
    [
      "test_post_strat_count_effect_moments_fallback_relative",
      "should fallback for count RA with zero pre-variance (relative)",
    ],
    [
      "test_post_strat_count_effect_moments_fallback_absolute",
      "should fallback for count RA with zero pre-variance (absolute)",
    ],
    [
      "test_post_strat_ratio_effect_moments_fallback_relative",
      "should fallback for ratio RA with zero pre-variance (relative)",
    ],
    [
      "test_post_strat_ratio_effect_moments_fallback_absolute",
      "should fallback for ratio RA with zero pre-variance (absolute)",
    ],
    // Single cell tests
    ["test_single_cell_count", "should work for single cell count"],
    [
      "test_post_strat_count_reg_effect_moments_single_cell_relative",
      "should work for single cell count RA (relative)",
    ],
    [
      "test_post_strat_count_reg_effect_moments_single_cell_absolute",
      "should work for single cell count RA (absolute)",
    ],
    [
      "test_post_strat_ratio_reg_effect_moments_single_cell_relative",
      "should work for single cell ratio RA (relative)",
    ],
    [
      "test_post_strat_ratio_reg_effect_moments_single_cell_absolute",
      "should work for single cell ratio RA (absolute)",
    ],
  ];

  testCases.forEach(([testName, testDescription]) => {
    it(testDescription, () => {
      if (!fixtures) {
        console.log("Fixtures not found, run pnpm fixtures:generate first");
        return;
      }
      const testCase = getTestCase(
        fixtures,
        "EffectMomentsPostStratification",
        testName,
      );
      const stats = createStatsListFromInput(
        testCase.inputs.stats as unknown[][],
      );
      const config = testCase.inputs.config as {
        difference_type: "relative" | "absolute";
      };

      const test = new EffectMomentsPostStratification(stats, {
        differenceType: config.difference_type,
      });
      const result = test.computeResult();
      const roundedResult = roundEffectMomentsResult(
        result as unknown as Record<string, unknown>,
      );

      expect(roundedResult).toEqual(testCase.expected);
    });
  });
});

describe("EffectMomentsPostStratification - Missing Variation Data Validation", () => {
  let fixtures: FixtureFile | undefined;

  beforeAll(() => {
    try {
      fixtures = loadPostStratificationFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should produce same result as original when cell has missing variation data", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "EffectMomentsPostStratification",
      "test_missing_variation_data",
    );
    const validation = testCase.validation as {
      should_equal_original: boolean;
      original_result: Record<string, unknown>;
    };

    // Verify that the expected result equals the original result
    expect(validation.should_equal_original).toBe(true);
    expect(testCase.expected).toEqual(validation.original_result);
  });
});

describe("Post-stratification error messages", () => {
  it("should have correct error message constants", () => {
    // Error messages match Python gbstats format
    expect(ZERO_NEGATIVE_VARIANCE_MESSAGE).toBe("ZERO_NEGATIVE_VARIANCE");
    expect(BASELINE_VARIATION_ZERO_MESSAGE).toBe(
      "ZERO_NEGATIVE_BASELINE_VARIATION",
    );
  });
});
