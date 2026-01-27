/**
 * Tests for devtools/simulation - integration tests for the full pipeline.
 * These tests verify that processSingleMetric produces the same results as direct statistical tests.
 * Fixtures are generated from Python gbstats tests/test_devtools.py
 */

import {
  loadDevtoolsFixtures,
  getTestCase,
  FixtureFile,
} from "../helpers/fixtureLoader";
import { processSingleMetric } from "../../src/gbstats";
import type {
  AnalysisSettingsForStatsEngine,
  MetricSettingsForStatsEngine,
} from "../../src/models/settings";

// Helper to convert snake_case inputs to camelCase for TypeScript
function convertAnalysisSettings(
  input: Record<string, unknown>,
): AnalysisSettingsForStatsEngine {
  return {
    varNames: input.var_names as string[],
    varIds: input.var_ids as string[],
    weights: input.weights as number[],
    baselineIndex: input.baseline_index as number,
    dimension: input.dimension as string,
    statsEngine: input.stats_engine as "bayesian" | "frequentist",
    sequentialTestingEnabled: input.sequential_testing_enabled as boolean,
    sequentialTuningParameter: input.sequential_tuning_parameter as number,
    differenceType: input.difference_type as "relative" | "absolute",
    phaseLengthDays: input.phase_length_days as number,
  };
}

function convertMetricSettings(
  input: Record<string, unknown>,
): MetricSettingsForStatsEngine {
  return {
    id: input.id as string,
    name: input.name as string,
    inverse: input.inverse as boolean,
    statisticType: input.statistic_type as
      | "mean"
      | "mean_ra"
      | "ratio"
      | "ratio_ra",
    mainMetricType: input.main_metric_type as "count" | "binomial",
    denominatorMetricType: input.denominator_metric_type as
      | "count"
      | "binomial"
      | undefined,
    covariateMetricType: input.covariate_metric_type as
      | "count"
      | "binomial"
      | undefined,
  };
}

// Helper to round values for comparison
function roundValue(value: unknown, decimals = 5): unknown {
  if (
    typeof value === "number" &&
    !Number.isNaN(value) &&
    Number.isFinite(value)
  ) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }
  return value;
}

describe("TestCreateRows", () => {
  let fixtures: FixtureFile | undefined;

  beforeAll(() => {
    try {
      fixtures = loadDevtoolsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should produce same CI for count metric via pipeline as direct TwoSidedTTest", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "TestCreateRows",
      "test_count_metric",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analyses = (
      testCase.inputs.analyses as Record<string, unknown>[]
    ).map(convertAnalysisSettings);
    const expected = testCase.expected as {
      ci: number[];
      gbstats_ci: number[];
    };

    // Run through processSingleMetric
    const result = processSingleMetric(rows, metric, analyses);

    // Get CI from the result
    const resultCi = result.analyses[0].dimensions[0].variations[1].ci;

    // Verify CI matches expected
    expect(roundValue(resultCi[0])).toBe(roundValue(expected.ci[0]));
    expect(roundValue(resultCi[1])).toBe(roundValue(expected.ci[1]));

    // Also verify it matches the gbstats_ci from Python
    expect(roundValue(resultCi[0])).toBe(roundValue(expected.gbstats_ci[0]));
    expect(roundValue(resultCi[1])).toBe(roundValue(expected.gbstats_ci[1]));
  });

  it("should produce same CI for ratio_ra metric via pipeline as direct TwoSidedTTest", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "TestCreateRows",
      "test_ratio_adjusted_regression_metric",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analyses = (
      testCase.inputs.analyses as Record<string, unknown>[]
    ).map(convertAnalysisSettings);
    const expected = testCase.expected as {
      ci: number[];
      gbstats_ci: number[];
    };

    // Run through processSingleMetric
    const result = processSingleMetric(rows, metric, analyses);

    // Get CI from the result
    const resultCi = result.analyses[0].dimensions[0].variations[1].ci;

    // Verify CI matches expected
    expect(roundValue(resultCi[0])).toBe(roundValue(expected.ci[0]));
    expect(roundValue(resultCi[1])).toBe(roundValue(expected.ci[1]));

    // Also verify it matches the gbstats_ci from Python
    expect(roundValue(resultCi[0])).toBe(roundValue(expected.gbstats_ci[0]));
    expect(roundValue(resultCi[1])).toBe(roundValue(expected.gbstats_ci[1]));
  });
});
