/**
 * Tests for frequentist hypothesis tests.
 * These tests load fixtures generated from Python gbstats and verify TypeScript parity.
 */

import {
  loadFrequentistFixtures,
  getTestCase,
  FixtureFile,
} from "../helpers/fixtureLoader";
import { roundResultDict } from "../helpers/testUtils";
import {
  SampleMeanStatistic,
  ProportionStatistic,
  RegressionAdjustedStatistic,
  RegressionAdjustedRatioStatistic,
} from "../../src/models/statistics";
import {
  TwoSidedTTest,
  OneSidedTreatmentGreaterTTest,
  OneSidedTreatmentLesserTTest,
  SequentialTwoSidedTTest,
  SequentialOneSidedTreatmentGreaterTTest,
  SequentialOneSidedTreatmentLesserTTest,
} from "../../src/frequentist/tests";

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
    case "RegressionAdjustedRatioStatistic": {
      // Create nested statistics first
      const mStatPost = createStatisticFromInput(
        input.m_statistic_post as Record<string, unknown>,
      );
      const dStatPost = createStatisticFromInput(
        input.d_statistic_post as Record<string, unknown>,
      );
      const mStatPre = createStatisticFromInput(
        input.m_statistic_pre as Record<string, unknown>,
      );
      const dStatPre = createStatisticFromInput(
        input.d_statistic_pre as Record<string, unknown>,
      );
      return new RegressionAdjustedRatioStatistic({
        n: input.n as number,
        m_statistic_post: mStatPost as
          | SampleMeanStatistic
          | ProportionStatistic,
        d_statistic_post: dStatPost as
          | SampleMeanStatistic
          | ProportionStatistic,
        m_statistic_pre: mStatPre as SampleMeanStatistic | ProportionStatistic,
        d_statistic_pre: dStatPre as SampleMeanStatistic | ProportionStatistic,
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

// Helper to extract config options
function extractConfigOptions(config: Record<string, unknown>) {
  return {
    differenceType: config.difference_type as "relative" | "absolute",
    alpha: config.alpha as number,
  };
}

// Helper to extract sequential config options
function extractSequentialConfigOptions(config: Record<string, unknown>) {
  return {
    differenceType: config.difference_type as "relative" | "absolute",
    alpha: config.alpha as number,
    sequentialTuningParameter: config.sequential_tuning_parameter as number,
  };
}

describe("TwoSidedTTest", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadFrequentistFixtures();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Error loading fixtures:", e);
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute correct result for two_sided_ttest (relative)", () => {
    if (!fixtures) {
      // eslint-disable-next-line no-console
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "TwoSidedTTest",
      "test_two_sided_ttest",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );
    const config = extractConfigOptions(
      testCase.inputs.config as Record<string, unknown>,
    );

    const test = new TwoSidedTTest([[statA, statB]], config);
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should compute correct result for two_sided_ttest (absolute)", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TwoSidedTTest",
      "test_two_sided_ttest_absolute",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );
    const config = extractConfigOptions(
      testCase.inputs.config as Record<string, unknown>,
    );

    const test = new TwoSidedTTest([[statA, statB]], config);
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should compute correct result for two_sided_ttest_binom", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TwoSidedTTest",
      "test_two_sided_ttest_binom",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );
    const config = extractConfigOptions(
      testCase.inputs.config as Record<string, unknown>,
    );

    const test = new TwoSidedTTest([[statA, statB]], config);
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should compute correct result for two_sided_ttest_missing_variance", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TwoSidedTTest",
      "test_two_sided_ttest_missing_variance",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );
    const config = extractConfigOptions(
      testCase.inputs.config as Record<string, unknown>,
    );

    const test = new TwoSidedTTest([[statA, statB]], config);
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should compute correct result for ratio_ra statistic", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TwoSidedTTest",
      "test_two_sided_ttest_ratio_ra",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );
    const config = extractConfigOptions(
      testCase.inputs.config as Record<string, unknown>,
    );

    const test = new TwoSidedTTest([[statA, statB]], config);
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });
});

describe("SequentialTwoSidedTTest", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadFrequentistFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute correct result for sequential test", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "SequentialTwoSidedTTest",
      "test_sequential_test_runs",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );
    const config = extractSequentialConfigOptions(
      testCase.inputs.config as Record<string, unknown>,
    );

    const test = new SequentialTwoSidedTTest([[statA, statB]], config);
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should compute correct result for sequential test with proportions", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "SequentialTwoSidedTTest",
      "test_sequential_test_runs_prop",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );

    const test = new SequentialTwoSidedTTest([[statA, statB]]);
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should compute correct result for sequential test with regression adjustment", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "SequentialTwoSidedTTest",
      "test_sequential_test_runs_ra",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );

    const test = new SequentialTwoSidedTTest([[statA, statB]]);
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should compute correct result for sequential test with ratio_ra", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "SequentialTwoSidedTTest",
      "test_sequential_test_runs_ratio_ra",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );

    const test = new SequentialTwoSidedTTest([[statA, statB]]);
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should produce narrower CI with well-tuned tuning parameter", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "SequentialTwoSidedTTest",
      "test_sequential_test_tuning_as_expected",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );
    const expected = testCase.expected as Record<string, unknown>;

    // Verify that tuning parameter affects CI width as expected:
    // - Underestimating (below_n) produces wider CI than overestimating (above_n)
    // - Well-tuned (near_n) produces narrower CI than both
    expect(expected.below_wider_than_above).toBe(true);
    expect(expected.below_wider_than_near).toBe(true);
    expect(expected.above_wider_than_near).toBe(true);

    // Also verify we can compute results with different tuning parameters
    const configBelowN = extractSequentialConfigOptions(
      testCase.inputs.config_below_n as Record<string, unknown>,
    );
    const configNearN = extractSequentialConfigOptions(
      testCase.inputs.config_near_n as Record<string, unknown>,
    );
    const configAboveN = extractSequentialConfigOptions(
      testCase.inputs.config_above_n as Record<string, unknown>,
    );

    const testBelow = new SequentialTwoSidedTTest(
      [[statA, statB]],
      configBelowN,
    );
    const testNear = new SequentialTwoSidedTTest([[statA, statB]], configNearN);
    const testAbove = new SequentialTwoSidedTTest(
      [[statA, statB]],
      configAboveN,
    );

    const resultBelow = testBelow.computeResult();
    const resultNear = testNear.computeResult();
    const resultAbove = testAbove.computeResult();

    // Verify the CI width relationships
    const ciWidthBelow =
      (resultBelow.ci[1] as number) - (resultBelow.ci[0] as number);
    const ciWidthNear =
      (resultNear.ci[1] as number) - (resultNear.ci[0] as number);
    const ciWidthAbove =
      (resultAbove.ci[1] as number) - (resultAbove.ci[0] as number);

    expect(ciWidthBelow).toBeGreaterThan(ciWidthNear);
    expect(ciWidthAbove).toBeGreaterThan(ciWidthNear);
  });
});

describe("OneSidedTreatmentGreaterTTest", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadFrequentistFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute correct result for one-sided test (greater, relative)", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "OneSidedTreatmentGreaterTTest",
      "test_one_sided_ttest",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );

    const test = new OneSidedTreatmentGreaterTTest([[statA, statB]]);
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should compute correct result for one-sided test (greater, absolute)", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "OneSidedTreatmentGreaterTTest",
      "test_one_sided_ttest_absolute",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );
    const config = extractConfigOptions(
      testCase.inputs.config as Record<string, unknown>,
    );

    const test = new OneSidedTreatmentGreaterTTest([[statA, statB]], config);
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });
});

describe("OneSidedTreatmentLesserTTest", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadFrequentistFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute correct result for one-sided test (lesser, relative)", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "OneSidedTreatmentLesserTTest",
      "test_one_sided_ttest",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );

    const test = new OneSidedTreatmentLesserTTest([[statA, statB]]);
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should compute correct result for one-sided test (lesser, absolute)", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "OneSidedTreatmentLesserTTest",
      "test_one_sided_ttest_absolute",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );
    const config = extractConfigOptions(
      testCase.inputs.config as Record<string, unknown>,
    );

    const test = new OneSidedTreatmentLesserTTest([[statA, statB]], config);
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });
});

describe("SequentialOneSidedTreatmentGreaterTTest", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadFrequentistFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute correct result for sequential one-sided test (greater, relative)", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "SequentialOneSidedTreatmentGreaterTTest",
      "test_one_sided_ttest",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );

    const test = new SequentialOneSidedTreatmentGreaterTTest([[statA, statB]]);
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should compute correct result for sequential one-sided test (greater, absolute)", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "SequentialOneSidedTreatmentGreaterTTest",
      "test_one_sided_ttest_absolute",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );
    const config = extractSequentialConfigOptions(
      testCase.inputs.config as Record<string, unknown>,
    );

    const test = new SequentialOneSidedTreatmentGreaterTTest(
      [[statA, statB]],
      config,
    );
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });
});

describe("SequentialOneSidedTreatmentLesserTTest", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadFrequentistFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute correct result for sequential one-sided test (lesser, relative)", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "SequentialOneSidedTreatmentLesserTTest",
      "test_one_sided_ttest",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );

    const test = new SequentialOneSidedTreatmentLesserTTest([[statA, statB]]);
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should compute correct result for sequential one-sided test (lesser, absolute)", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "SequentialOneSidedTreatmentLesserTTest",
      "test_one_sided_ttest_absolute",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );
    const config = extractSequentialConfigOptions(
      testCase.inputs.config as Record<string, unknown>,
    );

    const test = new SequentialOneSidedTreatmentLesserTTest(
      [[statA, statB]],
      config,
    );
    const result = test.computeResult();
    const roundedResult = roundResultDict(
      result as unknown as Record<string, unknown>,
    );

    expect(roundedResult).toEqual(testCase.expected);
  });
});
