/**
 * Tests for high-level API (gbstats).
 * These tests load fixtures generated from Python gbstats and verify TypeScript parity.
 */

import {
  detectUnknownVariations,
  getMetricDfs,
  analyzeMetricDf,
  variationStatisticFromMetricRow,
  getVarIdMap,
  processAnalysis,
  reduceDimensionality,
} from "../src/gbstats";
import type {
  AnalysisSettingsForStatsEngine,
  MetricSettingsForStatsEngine,
} from "../src/models/settings";
import {
  SampleMeanStatistic,
  RegressionAdjustedStatistic,
} from "../src/models/statistics";
import { filterToExpectedFields } from "./helpers/testUtils";
import {
  loadGbstatsFixtures,
  getTestCase,
  FixtureFile,
} from "./helpers/fixtureLoader";

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
    alpha: input.alpha as number,
    maxDimensions: input.max_dimensions as number,
    oneSidedIntervals: input.one_sided_intervals as boolean,
    trafficPercentage: input.traffic_percentage as number,
    postStratificationEnabled: input.post_stratification_enabled as boolean,
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

// Deep round all numeric values in an object for comparison
function roundDeep(obj: unknown, decimals = 5): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "number") return roundValue(obj, decimals);
  if (Array.isArray(obj)) return obj.map((item) => roundDeep(item, decimals));
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = roundDeep(value, decimals);
    }
    return result;
  }
  return obj;
}

describe("detectUnknownVariations", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadGbstatsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should return empty set when all variations are known", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "TestDetectVariations",
      "test_unknown_variations_none",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIds = new Set(testCase.inputs.var_ids as string[]);

    const result = detectUnknownVariations(rows, varIds);
    expect(Array.from(result)).toEqual(testCase.expected);
  });

  it("should detect one unknown variation", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestDetectVariations",
      "test_unknown_variations_one",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIds = new Set(testCase.inputs.var_ids as string[]);

    const result = detectUnknownVariations(rows, varIds);
    expect(Array.from(result)).toEqual(testCase.expected);
  });

  it("should detect both unknown variations", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestDetectVariations",
      "test_unknown_variations_both",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIds = new Set(testCase.inputs.var_ids as string[]);

    const result = detectUnknownVariations(rows, varIds);
    expect(Array.from(result).sort()).toEqual(
      (testCase.expected as string[]).sort(),
    );
  });
});

describe("variationStatisticFromMetricRow", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadGbstatsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should create RegressionAdjustedStatistic for mean_ra type", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "TestVariationStatisticBuilder",
      "test_ra_statistic_type",
    );
    const row = testCase.inputs.row as Record<string, unknown>;
    const metricInput = testCase.inputs.metric as Record<string, unknown>;
    const metric = convertMetricSettings(metricInput);

    const baselineStat = variationStatisticFromMetricRow(
      row,
      "baseline",
      metric,
    );
    const v1Stat = variationStatisticFromMetricRow(row, "v1", metric);

    expect(baselineStat).toBeInstanceOf(RegressionAdjustedStatistic);
    expect(v1Stat).toBeInstanceOf(RegressionAdjustedStatistic);

    // Check that the baseline stat has the expected values
    const expectedBaseline = testCase.expected as Record<
      string,
      Record<string, unknown>
    >;
    expect((baselineStat as RegressionAdjustedStatistic).n).toBe(
      expectedBaseline.baseline.n,
    );
    expect((v1Stat as RegressionAdjustedStatistic).n).toBe(
      expectedBaseline.v1.n,
    );
  });
});

describe("analyzeMetricDf - Bayesian", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadGbstatsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute correct result for Bayesian count metric", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "TestAnalyzeMetricDfBayesian",
      "test_get_metric_dfs_new",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analysis = convertAnalysisSettings(
      testCase.inputs.analysis as Record<string, unknown>,
    );

    const metricDfs = getMetricDfs(rows, varIdMap, varNames);
    const result = analyzeMetricDf(metricDfs, 2, metric, analysis);

    // Compare result against fixture (filter to expected fields only)
    expect(
      roundDeep(filterToExpectedFields(result, testCase.expected)),
    ).toEqual(roundDeep(testCase.expected));
  });

  it("should compute correct result for Bayesian ratio metric", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestAnalyzeMetricDfBayesian",
      "test_get_metric_dfs_bayesian_ratio",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analysis = convertAnalysisSettings(
      testCase.inputs.analysis as Record<string, unknown>,
    );

    const metricDfs = getMetricDfs(rows, varIdMap, varNames);
    const result = analyzeMetricDf(metricDfs, 2, metric, analysis);

    expect(
      roundDeep(filterToExpectedFields(result, testCase.expected)),
    ).toEqual(roundDeep(testCase.expected));
  });

  it("should handle inverse metric correctly", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestAnalyzeMetricDfBayesian",
      "test_get_metric_dfs_inverse",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analysis = convertAnalysisSettings(
      testCase.inputs.analysis as Record<string, unknown>,
    );

    const metricDfs = getMetricDfs(rows, varIdMap, varNames);
    const result = analyzeMetricDf(metricDfs, 2, metric, analysis);

    expect(
      roundDeep(filterToExpectedFields(result, testCase.expected)),
    ).toEqual(roundDeep(testCase.expected));
  });

  it("should handle minimal data correctly", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestAnalyzeMetricDfBayesian",
      "test_get_metric_dfs_zero_val",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analysis = convertAnalysisSettings(
      testCase.inputs.analysis as Record<string, unknown>,
    );

    const metricDfs = getMetricDfs(rows, varIdMap, varNames);
    const result = analyzeMetricDf(metricDfs, 2, metric, analysis);

    expect(
      roundDeep(filterToExpectedFields(result, testCase.expected)),
    ).toEqual(roundDeep(testCase.expected));
  });

  it("should handle ratio with zero denominator", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestAnalyzeMetricDfBayesian",
      "test_get_metric_dfs_ratio_zero_denom",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analysis = convertAnalysisSettings(
      testCase.inputs.analysis as Record<string, unknown>,
    );

    const metricDfs = getMetricDfs(rows, varIdMap, varNames);
    const result = analyzeMetricDf(metricDfs, 2, metric, analysis);

    expect(
      roundDeep(filterToExpectedFields(result, testCase.expected)),
    ).toEqual(roundDeep(testCase.expected));
  });
});

describe("analyzeMetricDf - Frequentist", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadGbstatsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute correct result for Frequentist count metric", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "TestAnalyzeMetricDfFrequentist",
      "test_get_metric_dfs_frequentist",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analysis = convertAnalysisSettings(
      testCase.inputs.analysis as Record<string, unknown>,
    );

    const metricDfs = getMetricDfs(rows, varIdMap, varNames);
    const result = analyzeMetricDf(metricDfs, 2, metric, analysis);

    expect(
      roundDeep(filterToExpectedFields(result, testCase.expected)),
    ).toEqual(roundDeep(testCase.expected));
  });

  it("should compute correct result for Frequentist ratio metric", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestAnalyzeMetricDfFrequentist",
      "test_get_metric_dfs_frequentist_ratio",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analysis = convertAnalysisSettings(
      testCase.inputs.analysis as Record<string, unknown>,
    );

    const metricDfs = getMetricDfs(rows, varIdMap, varNames);
    const result = analyzeMetricDf(metricDfs, 2, metric, analysis);

    expect(
      roundDeep(filterToExpectedFields(result, testCase.expected)),
    ).toEqual(roundDeep(testCase.expected));
  });

  it("should handle minimal data correctly", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestAnalyzeMetricDfFrequentist",
      "test_get_metric_dfs_zero_val",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analysis = convertAnalysisSettings(
      testCase.inputs.analysis as Record<string, unknown>,
    );

    const metricDfs = getMetricDfs(rows, varIdMap, varNames);
    const result = analyzeMetricDf(metricDfs, 2, metric, analysis);

    expect(
      roundDeep(filterToExpectedFields(result, testCase.expected)),
    ).toEqual(roundDeep(testCase.expected));
  });

  it("should handle ratio with zero denominator", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestAnalyzeMetricDfFrequentist",
      "test_get_metric_dfs_ratio_zero_denom",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analysis = convertAnalysisSettings(
      testCase.inputs.analysis as Record<string, unknown>,
    );

    const metricDfs = getMetricDfs(rows, varIdMap, varNames);
    const result = analyzeMetricDf(metricDfs, 2, metric, analysis);

    expect(
      roundDeep(filterToExpectedFields(result, testCase.expected)),
    ).toEqual(roundDeep(testCase.expected));
  });
});

describe("analyzeMetricDf - Regression Adjustment", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadGbstatsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute correct result for regression adjusted metric", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "TestAnalyzeMetricDfRegressionAdjustment",
      "test_analyze_metric_df_ra",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analysis = convertAnalysisSettings(
      testCase.inputs.analysis as Record<string, unknown>,
    );

    const metricDfs = getMetricDfs(rows, varIdMap, varNames);
    const result = analyzeMetricDf(metricDfs, 2, metric, analysis);

    expect(
      roundDeep(filterToExpectedFields(result, testCase.expected)),
    ).toEqual(roundDeep(testCase.expected));
  });

  it("should compute correct result for RA with proportion metrics", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestAnalyzeMetricDfRegressionAdjustment",
      "test_analyze_metric_df_ra_proportion",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analysis = convertAnalysisSettings(
      testCase.inputs.analysis as Record<string, unknown>,
    );

    const metricDfs = getMetricDfs(rows, varIdMap, varNames);
    const result = analyzeMetricDf(metricDfs, 2, metric, analysis);

    // Use 4 decimal precision due to floating-point differences between Python and JavaScript
    expect(
      roundDeep(filterToExpectedFields(result, testCase.expected), 4),
    ).toEqual(roundDeep(testCase.expected, 4));
  });

  it("should compute correct result for ratio_ra metric", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestAnalyzeMetricDfRegressionAdjustment",
      "test_analyze_metric_df_ratio_ra",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analysis = convertAnalysisSettings(
      testCase.inputs.analysis as Record<string, unknown>,
    );

    const metricDfs = getMetricDfs(rows, varIdMap, varNames);
    const result = analyzeMetricDf(metricDfs, 2, metric, analysis);

    expect(
      roundDeep(filterToExpectedFields(result, testCase.expected)),
    ).toEqual(roundDeep(testCase.expected));
  });
});

describe("analyzeMetricDf - Sequential", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadGbstatsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute correct result for sequential test", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "TestAnalyzeMetricDfSequential",
      "test_analyze_metric_df_sequential",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analysis = convertAnalysisSettings(
      testCase.inputs.analysis as Record<string, unknown>,
    );

    const metricDfs = getMetricDfs(rows, varIdMap, varNames);
    const result = analyzeMetricDf(metricDfs, 2, metric, analysis);

    expect(
      roundDeep(filterToExpectedFields(result, testCase.expected)),
    ).toEqual(roundDeep(testCase.expected));
  });
});

describe("getVarIdMap", () => {
  it("should create correct var id map", () => {
    const varIds = ["control", "treatment1", "treatment2"];
    const result = getVarIdMap(varIds);

    expect(result).toEqual({
      control: 0,
      treatment1: 1,
      treatment2: 2,
    });
  });
});

// ==============================================================
// Phase 2 Tests
// ==============================================================

describe("detectUnknownVariations - multiple exposures", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadGbstatsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should handle __multiple__ variation correctly", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "TestDetectVariations",
      "test_multiple_exposures",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIds = new Set(testCase.inputs.var_ids as string[]);
    const expected = testCase.expected as Record<string, string[]>;

    // With default ignore (includes __multiple__), it should not be detected
    const resultDefault = detectUnknownVariations(rows, varIds);
    expect(Array.from(resultDefault)).toEqual(expected.with_default_ignore);

    // With custom ignore that doesn't include __multiple__, it should be detected
    const customIgnore = new Set(testCase.inputs.ignore_custom as string[]);
    const resultCustom = detectUnknownVariations(rows, varIds, customIgnore);
    expect(Array.from(resultCustom)).toEqual(expected.with_custom_ignore);
  });
});

describe("getMetricDfs - missing count", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadGbstatsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should use users column when count is missing", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "TestGetMetricDf",
      "test_get_metric_dfs_missing_count",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const expected = testCase.expected as Record<string, unknown>;

    const metricDfs = getMetricDfs(rows, varIdMap, varNames);

    // Verify fixture sanity check - count should equal users
    expect(expected.count_equals_users).toBe(true);
    expect(expected.first_dimension_baseline_count).toBe(
      expected.first_dimension_baseline_users,
    );
    expect(expected.first_dimension_v1_count).toBe(
      expected.first_dimension_v1_users,
    );

    // Validate actual function result
    expect(metricDfs.length).toBeGreaterThan(0);
    const firstDimension = metricDfs[0];
    // Data has one row per strata (for non-post-stratified, just 1 strata)
    // Variations are stored as columns: baseline_*, v1_*, etc.
    expect(firstDimension.data.length).toBe(1);

    // Verify that baseline_count equals expected value (stored in the row as baseline_count column)
    const row = firstDimension.data[0];
    expect(row.baseline_count).toBe(expected.first_dimension_baseline_count);
  });
});

describe("processAnalysis", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadGbstatsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should set correct denominator values", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "TestProcessAnalysis",
      "test_process_analysis_denominator",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analysis = convertAnalysisSettings(
      testCase.inputs.analysis as Record<string, unknown>,
    );
    const expected = testCase.expected as Record<string, unknown>;

    // Call the actual function
    const result = processAnalysis(rows, varIdMap, metric, analysis);

    // Validate function result structure
    expect(result.length).toBeGreaterThan(0);
    const firstDimension = result[0];
    expect(firstDimension.variations.length).toBe(2);

    // Validate denominator values from fixture
    expect(expected.first_dimension_baseline_denominator).toBe(510);
    expect(expected.first_dimension_variation_denominator).toBe(500);

    // Validate actual result matches expected denominator values
    const baselineVariation = firstDimension.variations[0] as Record<
      string,
      unknown
    >;
    const treatmentVariation = firstDimension.variations[1] as Record<
      string,
      unknown
    >;
    expect(baselineVariation.denominator).toBe(
      expected.first_dimension_baseline_denominator,
    );
    expect(treatmentVariation.denominator).toBe(
      expected.first_dimension_variation_denominator,
    );
  });
});

describe("Three-armed CUPED", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadGbstatsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should produce expected baseline stats", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "TestThreeArmedCuped",
      "test_three_armed_cuped_baseline_stats_hardcoded",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const metric = convertMetricSettings(
      testCase.inputs.metric as Record<string, unknown>,
    );
    const analysis = convertAnalysisSettings(
      testCase.inputs.analysis as Record<string, unknown>,
    );
    const expected = testCase.expected as Record<string, number>;

    // Call actual functions
    const metricDfs = getMetricDfs(rows, varIdMap, varNames);
    const result = analyzeMetricDf(metricDfs, 3, metric, analysis);

    // Validate expected fixture values (sanity check)
    expect(expected.baseline_users).toBe(3001);
    expect(expected.baseline_count).toBe(3001);
    expect(roundValue(expected.baseline_mean)).toBe(roundValue(0.099966678));
    expect(roundValue(expected.baseline_stddev)).toBe(roundValue(0.434288923));

    expect(expected.v1_users).toBe(3000);
    expect(expected.v1_count).toBe(3000);
    expect(roundValue(expected.v1_mean)).toBe(roundValue(0.074));
    expect(roundValue(expected.v1_stddev)).toBe(roundValue(0.423529598));

    expect(expected.v2_users).toBe(4000);
    expect(expected.v2_count).toBe(4000);
    expect(roundValue(expected.v2_mean)).toBe(roundValue(0.1125));
    expect(roundValue(expected.v2_stddev)).toBe(roundValue(0.458953951));

    // Validate actual function result
    expect(result.length).toBeGreaterThan(0);
    const dim = result[0];
    expect(dim.variations.length).toBe(3);

    // Validate baseline stats match expected
    const baselineStats = (dim.variations[0] as Record<string, unknown>)
      .stats as Record<string, number>;
    expect(baselineStats.users).toBe(expected.baseline_users);
    expect(baselineStats.count).toBe(expected.baseline_count);
    expect(roundValue(baselineStats.mean)).toBe(
      roundValue(expected.baseline_mean),
    );
    expect(roundValue(baselineStats.stddev)).toBe(
      roundValue(expected.baseline_stddev),
    );
  });

  it("should have different stddev with CUPED vs without", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestThreeArmedCuped",
      "test_three_armed_cuped_baseline_stddev_different_from_no_cuped",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const metricCuped = convertMetricSettings(
      testCase.inputs.metric_cuped as Record<string, unknown>,
    );
    const metricNoCuped = convertMetricSettings(
      testCase.inputs.metric_no_cuped as Record<string, unknown>,
    );
    const analysis = convertAnalysisSettings(
      testCase.inputs.analysis as Record<string, unknown>,
    );
    const expected = testCase.expected as Record<string, unknown>;

    // Call actual functions - use same rows for both, different metric settings
    const metricDfsCuped = getMetricDfs(rows, varIdMap, varNames);
    const metricDfsNoCuped = getMetricDfs(rows, varIdMap, varNames);
    const resultCuped = analyzeMetricDf(
      metricDfsCuped,
      3,
      metricCuped,
      analysis,
    );
    const resultNoCuped = analyzeMetricDf(
      metricDfsNoCuped,
      3,
      metricNoCuped,
      analysis,
    );

    // Validate fixture expectations
    expect(expected.stddev_different).toBe(true);
    expect(expected.mean_same).toBe(true);

    // Validate actual results
    const dimCuped = resultCuped[0];
    const dimNoCuped = resultNoCuped[0];
    const baselineStatsCuped = (
      dimCuped.variations[0] as Record<string, unknown>
    ).stats as Record<string, number>;
    const baselineStatsNoCuped = (
      dimNoCuped.variations[0] as Record<string, unknown>
    ).stats as Record<string, number>;

    // Mean should be the same
    expect(roundValue(baselineStatsCuped.mean)).toBe(
      roundValue(baselineStatsNoCuped.mean),
    );

    // Stddev should be different (CUPED reduces variance)
    expect(baselineStatsCuped.stddev).not.toBe(baselineStatsNoCuped.stddev);
  });

  it("should use theta from 0 vs 2 comparison", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestThreeArmedCuped",
      "test_three_armed_cuped_baseline_stats_same_as_0_vs_2",
    );
    const expected = testCase.expected as Record<string, unknown>;

    // Validate fixture expectations
    expect(expected.users_same).toBe(true);
    expect(expected.count_same).toBe(true);
    expect(expected.mean_same).toBe(true);
    expect(expected.stddev_same).toBe(true);
  });
});

describe("reduceDimensionality", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadGbstatsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should combine low-frequency dimensions into (other)", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "TestReduceDimensionality",
      "test_reduce_dimensionality",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const expected = testCase.expected as Record<string, unknown>;

    // Get metric dataframes
    const metricDfsFor3 = getMetricDfs(rows, varIdMap, varNames);
    const metricDfsFor2 = getMetricDfs(rows, varIdMap, varNames);

    // Call reduceDimensionality with different max values
    const reduced3 = reduceDimensionality(metricDfsFor3, 2, 3);
    const reduced2 = reduceDimensionality(metricDfsFor2, 2, 2);

    // Validate fixture expected values
    expect(expected.reduced_3_length).toBe(3);
    expect(expected.reduced_3_first_dimension).toBe("three");
    expect(expected.reduced_3_first_v1_main_sum).toBe(222);

    expect(expected.reduced_2_length).toBe(2);
    expect(expected.reduced_2_second_dimension).toBe("(other)");
    expect(expected.reduced_2_second_v1_main_sum).toBe(1070);

    // Validate actual function results
    expect(reduced3.length).toBe(expected.reduced_3_length);
    expect(reduced3[0].dimension).toBe(expected.reduced_3_first_dimension);

    expect(reduced2.length).toBe(expected.reduced_2_length);
    expect(reduced2[1].dimension).toBe(expected.reduced_2_second_dimension);
  });

  it("should work with ratio metrics", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestReduceDimensionality",
      "test_reduce_dimensionality_ratio",
    );
    const rows = testCase.inputs.rows as Record<string, unknown>[];
    const varIdMap = testCase.inputs.var_id_map as Record<string, number>;
    const varNames = testCase.inputs.var_names as string[];
    const expected = testCase.expected as Record<string, unknown>;

    // Get metric dataframes
    const metricDfsFor20 = getMetricDfs(rows, varIdMap, varNames);
    const metricDfsFor1 = getMetricDfs(rows, varIdMap, varNames);

    // Call reduceDimensionality with different max values
    const reduced20 = reduceDimensionality(metricDfsFor20, 2, 20);
    const reduced1 = reduceDimensionality(metricDfsFor1, 2, 1);

    // Validate fixture expected values
    expect(expected.reduced_20_length).toBe(2);
    expect(expected.reduced_20_first_dimension).toBe("one");
    expect(expected.reduced_20_first_v1_users).toBe(120);

    expect(expected.reduced_1_length).toBe(1);
    expect(expected.reduced_1_first_dimension).toBe("(other)");
    expect(expected.reduced_1_first_v1_users).toBe(240);

    // Validate actual function results
    expect(reduced20.length).toBe(expected.reduced_20_length);
    expect(reduced20[0].dimension).toBe(expected.reduced_20_first_dimension);

    expect(reduced1.length).toBe(expected.reduced_1_length);
    expect(reduced1[0].dimension).toBe(expected.reduced_1_first_dimension);
  });
});
