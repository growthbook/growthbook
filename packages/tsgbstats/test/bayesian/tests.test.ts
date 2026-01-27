/**
 * Tests for Bayesian hypothesis tests.
 * These tests load fixtures generated from Python gbstats and verify TypeScript parity.
 */

import {
  loadBayesianFixtures,
  getTestCase,
  FixtureFile,
} from "../helpers/fixtureLoader";
import { roundResultDict, keysToSnake } from "../helpers/testUtils";
import {
  SampleMeanStatistic,
  ProportionStatistic,
  QuantileStatistic,
} from "../../src/models/statistics";
import { EffectBayesianABTest } from "../../src/bayesian/tests";

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
    default:
      throw new Error(`Unknown statistic type: ${type}`);
  }
}

// Helper to extract config options
function extractConfigOptions(config: Record<string, unknown>) {
  const priorEffect = config.prior_effect as
    | Record<string, unknown>
    | undefined;
  return {
    differenceType: config.difference_type as "relative" | "absolute",
    alpha: config.alpha as number,
    priorEffect: priorEffect
      ? {
          mean: priorEffect.mean as number,
          variance: priorEffect.variance as number,
          proper: priorEffect.proper as boolean,
        }
      : undefined,
  };
}

describe("EffectBayesianABTest - Binomial", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadBayesianFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute correct result for bayesian binomial test", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "TestBinom",
      "test_bayesian_binomial_ab_test",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );

    const test = new EffectBayesianABTest([[statA, statB]]);
    const result = test.computeResult();
    const roundedResult = keysToSnake(
      roundResultDict(result as unknown as Record<string, unknown>),
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should handle missing data correctly", () => {
    if (!fixtures) return;
    const testCase = getTestCase(fixtures, "TestBinom", "test_missing_data");
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );

    const test = new EffectBayesianABTest([[statA, statB]]);
    const result = test.computeResult();

    // Check specific fields for missing data case
    expect(result.chanceToWin).toBe(0.5);
    expect(result.expected).toBe(0);
  });
});

describe("EffectBayesianABTest - Gaussian", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadBayesianFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute correct result for bayesian gaussian test", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestNorm",
      "test_bayesian_gaussian_ab_test",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );

    const test = new EffectBayesianABTest([[statA, statB]]);
    const result = test.computeResult();
    const roundedResult = keysToSnake(
      roundResultDict(result as unknown as Record<string, unknown>),
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should compute correct result with informative prior", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestNorm",
      "test_bayesian_gaussian_ab_test_informative",
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

    const test = new EffectBayesianABTest([[statA, statB]], config);
    const result = test.computeResult();
    const roundedResult = keysToSnake(
      roundResultDict(result as unknown as Record<string, unknown>),
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should handle missing data correctly", () => {
    if (!fixtures) return;
    const testCase = getTestCase(fixtures, "TestNorm", "test_missing_data");
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );

    const test = new EffectBayesianABTest([[statA, statB]]);
    const result = test.computeResult();

    expect(result.chanceToWin).toBe(0.5);
    expect(result.expected).toBe(0);
  });
});

describe("EffectBayesianABTest - Quantile", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadBayesianFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute correct result for quantile with improper flat prior", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestEffectBayesianABTest",
      "test_quantile_improper_flat",
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

    const test = new EffectBayesianABTest([[statA, statB]], config);
    const result = test.computeResult();
    const roundedResult = keysToSnake(
      roundResultDict(result as unknown as Record<string, unknown>),
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should compute correct result for quantile absolute with flat prior", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestEffectBayesianABTest",
      "test_quantile_absolute_flat",
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

    const test = new EffectBayesianABTest([[statA, statB]], config);
    const result = test.computeResult();
    const roundedResult = keysToSnake(
      roundResultDict(result as unknown as Record<string, unknown>),
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should compute correct result for quantile relative with flat prior", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestEffectBayesianABTest",
      "test_quantile_relative_flat",
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

    const test = new EffectBayesianABTest([[statA, statB]], config);
    const result = test.computeResult();
    const roundedResult = keysToSnake(
      roundResultDict(result as unknown as Record<string, unknown>),
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should compute correct result for quantile absolute with informative prior", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestEffectBayesianABTest",
      "test_quantile_absolute_informative",
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

    const test = new EffectBayesianABTest([[statA, statB]], config);
    const result = test.computeResult();
    const roundedResult = keysToSnake(
      roundResultDict(result as unknown as Record<string, unknown>),
    );

    expect(roundedResult).toEqual(testCase.expected);
  });

  it("should compute correct result for quantile relative with informative prior", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestEffectBayesianABTest",
      "test_quantile_relative_informative",
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

    const test = new EffectBayesianABTest([[statA, statB]], config);
    const result = test.computeResult();
    const roundedResult = keysToSnake(
      roundResultDict(result as unknown as Record<string, unknown>),
    );

    expect(roundedResult).toEqual(testCase.expected);
  });
});

describe("EffectBayesianABTest - Relative vs Absolute Priors", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadBayesianFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should keep CTW similar for rescaled relative and absolute priors", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "TestGaussianEffectRelativeAbsolutePriors",
      "test_bayesian_effect_relative_effect",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );
    const configAbs = extractConfigOptions(
      testCase.inputs.config_absolute as Record<string, unknown>,
    );
    const configRel = extractConfigOptions(
      testCase.inputs.config_relative as Record<string, unknown>,
    );

    const testAbs = new EffectBayesianABTest([[statA, statB]], configAbs);
    const testRel = new EffectBayesianABTest([[statA, statB]], configRel);
    const resultAbs = testAbs.computeResult();
    const resultRel = testRel.computeResult();

    // CTW should be approximately equal (within 2 decimal places)
    expect(
      Math.abs(resultAbs.chanceToWin - resultRel.chanceToWin),
    ).toBeLessThan(0.01);
  });
});

describe("EffectBayesianABTest - Risk", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadBayesianFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute risk correctly with modified quantile bounds", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "TestEffectBayesianABTest",
      "test_quantile_risk_calculation",
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

    const test = new EffectBayesianABTest([[statA, statB]], config);
    const result = test.computeResult();
    const roundedResult = keysToSnake(
      roundResultDict(result as unknown as Record<string, unknown>),
    );

    expect(roundedResult).toEqual(testCase.expected);

    // Also validate specific risk values
    const validation = testCase.validation as Record<string, number>;
    expect(roundedResult.risk).toEqual([validation.risk_0, validation.risk_1]);
  });
});
