/**
 * Tests for mid-experiment power analysis.
 * These tests load fixtures generated from Python gbstats and verify TypeScript parity.
 */

import {
  loadMidExperimentPowerFixtures,
  getTestCase,
  FixtureFile,
} from "../helpers/fixtureLoader";
import { SampleMeanStatistic } from "../../src/models/statistics";
import {
  TwoSidedTTest,
  SequentialTwoSidedTTest,
} from "../../src/frequentist/tests";
import { EffectBayesianABTest } from "../../src/bayesian/tests";
import {
  MidExperimentPower,
  MidExperimentPowerConfig,
} from "../../src/power/midexperimentpower";
import type { GaussianPrior } from "../../src/models/settings";

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
    default:
      throw new Error(`Unknown statistic type: ${type}`);
  }
}

describe("MidExperimentPower", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadMidExperimentPowerFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute correct scaling factor for frequentist test", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "MidExperimentPower",
      "test_frequentist",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );
    const alpha = testCase.inputs.alpha as number;

    const test = new TwoSidedTTest([[statA, statB]], { alpha });
    const result = test.computeResult();

    const powerConfig: MidExperimentPowerConfig = {
      targetPower: testCase.inputs.target_power as number,
      targetMde: testCase.inputs.target_mde as number,
      numGoalMetrics: 1,
      numVariations: 2,
      priorEffect: null,
    };

    const power = new MidExperimentPower(
      test.momentsResult,
      result,
      { alpha },
      powerConfig,
    );
    const powerResult = power.calculateScalingFactor();

    expect(powerResult.scalingFactor).toBe(testCase.expected.scaling_factor);
  });

  it("should compute correct scaling factor for sequential test", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "MidExperimentPower",
      "test_sequential",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );
    const alpha = testCase.inputs.alpha as number;

    const test = new SequentialTwoSidedTTest([[statA, statB]], { alpha });
    const result = test.computeResult();

    const powerConfig: MidExperimentPowerConfig = {
      targetPower: testCase.inputs.target_power as number,
      targetMde: testCase.inputs.target_mde as number,
      numGoalMetrics: 1,
      numVariations: 2,
      priorEffect: null,
      sequential: testCase.inputs.sequential as boolean,
      sequentialTuningParameter: testCase.inputs
        .sequential_tuning_parameter as number,
    };

    const power = new MidExperimentPower(
      test.momentsResult,
      result,
      { alpha },
      powerConfig,
    );
    const powerResult = power.calculateScalingFactor();

    expect(powerResult.scalingFactor).toBe(testCase.expected.scaling_factor);
  });

  it("should compute correct scaling factor for Bayesian test", () => {
    if (!fixtures) return;
    const testCase = getTestCase(
      fixtures,
      "MidExperimentPower",
      "test_bayesian",
    );
    const statA = createStatisticFromInput(
      testCase.inputs.stat_a as Record<string, unknown>,
    );
    const statB = createStatisticFromInput(
      testCase.inputs.stat_b as Record<string, unknown>,
    );
    const alpha = testCase.inputs.alpha as number;
    const priorEffectInput = testCase.inputs.prior_effect as Record<
      string,
      unknown
    >;

    const priorEffect: GaussianPrior = {
      mean: priorEffectInput.mean as number,
      variance: priorEffectInput.variance as number,
      proper: priorEffectInput.proper as boolean,
    };

    const test = new EffectBayesianABTest([[statA, statB]], {
      alpha,
      priorEffect,
    });
    const result = test.computeResult();

    const powerConfig: MidExperimentPowerConfig = {
      targetPower: testCase.inputs.target_power as number,
      targetMde: testCase.inputs.target_mde as number,
      numGoalMetrics: 1,
      numVariations: 2,
      priorEffect,
    };

    const power = new MidExperimentPower(
      test.momentsResult,
      result,
      { alpha },
      powerConfig,
    );
    const powerResult = power.calculateScalingFactor();

    expect(powerResult.scalingFactor).toBe(testCase.expected.scaling_factor);
  });
});
