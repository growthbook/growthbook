import { ExperimentInterface, ExperimentPhase } from "shared/types/experiment";
import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import { FeatureDefinitionRule } from "shared/types/sdk";
import {
  applyQaOverrideToRule,
  qaOverrideCondition,
  qaOverrideWeights,
} from "../../src/util/features";

const experiment = {
  trackingKey: "checkout",
  variations: [
    { id: "v0", key: "0", name: "Control" },
    { id: "v1", key: "1", name: "One-page" },
    { id: "v2", key: "2", name: "Apple Pay" },
  ],
  phases: [{ variationWeights: [0.34, 0.33, 0.33] }],
} as unknown as ExperimentInterface;

const phase = {
  variationWeights: [0.34, 0.33, 0.33],
  coverage: 0.5,
  condition: '{"country":"US"}',
} as unknown as ExperimentPhase;

const baseOverride: ExperimentQaOverrideInterface = {
  id: "eqo_1",
  organization: "org",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  experiment: "exp_1",
  sdkConnection: "sdk_1",
  environment: "dev",
  assignment: { type: "forced", variationId: "v1" },
  applyExperimentTargeting: false,
  applyExperimentCoverage: false,
  additionalTargeting: null,
  createdBy: "u_1",
};

describe("qaOverrideWeights", () => {
  it("forces one variation with one-hot weights", () => {
    expect(qaOverrideWeights(baseOverride, experiment, phase)).toEqual([
      0, 1, 0,
    ]);
  });

  it("keeps the phase weights for random assignment", () => {
    expect(
      qaOverrideWeights(
        { ...baseOverride, assignment: { type: "random" } },
        experiment,
        phase,
      ),
    ).toEqual([0.34, 0.33, 0.33]);
  });

  it("falls back to the phase weights when the variation is missing", () => {
    expect(
      qaOverrideWeights(
        {
          ...baseOverride,
          assignment: { type: "forced", variationId: "nope" },
        },
        experiment,
        phase,
      ),
    ).toEqual([0.34, 0.33, 0.33]);
  });
});

describe("qaOverrideCondition", () => {
  const experimentCondition = { country: "US" };

  it("drops the experiment condition unless applyExperimentTargeting", () => {
    expect(
      qaOverrideCondition({ override: baseOverride, experimentCondition }),
    ).toBeUndefined();
    expect(
      qaOverrideCondition({
        override: { ...baseOverride, applyExperimentTargeting: true },
        experimentCondition,
      }),
    ).toEqual(experimentCondition);
  });

  it("compiles additional targeting to $in and ANDs it with the experiment condition", () => {
    const override: ExperimentQaOverrideInterface = {
      ...baseOverride,
      additionalTargeting: { attribute: "email", values: ["a@x.com"] },
    };
    expect(qaOverrideCondition({ override, experimentCondition })).toEqual({
      email: { $in: ["a@x.com"] },
    });
    expect(
      qaOverrideCondition({
        override: { ...override, applyExperimentTargeting: true },
        experimentCondition,
      }),
    ).toEqual({
      $and: [experimentCondition, { email: { $in: ["a@x.com"] } }],
    });
  });
});

describe("applyQaOverrideToRule", () => {
  const buildRule = (): FeatureDefinitionRule => ({
    key: "checkout",
    coverage: 0.5,
    weights: [0.34, 0.33, 0.33],
    variations: ["a", "b", "c"],
    condition: { country: "US" },
    parentConditions: [{ id: "parent", condition: { value: true } }],
    seed: "phase-seed",
  });

  it("rewrites the rule onto the QA tracking key with forced weights", () => {
    const rule = applyQaOverrideToRule(
      buildRule(),
      experiment,
      phase,
      baseOverride,
    );
    expect(rule.key).toBe("checkout__qa");
    expect(rule.seed).toBe("checkout__qa");
    expect(rule.weights).toEqual([0, 1, 0]);
    expect(rule.coverage).toBe(1);
    expect(rule.disableStickyBucketing).toBe(true);
    expect(rule.condition).toBeUndefined();
    expect(rule.parentConditions).toBeUndefined();
    expect(rule.variations).toEqual(["a", "b", "c"]);
  });

  it("keeps coverage, condition and prerequisites when asked to", () => {
    const rule = applyQaOverrideToRule(buildRule(), experiment, phase, {
      ...baseOverride,
      applyExperimentTargeting: true,
      applyExperimentCoverage: true,
    });
    expect(rule.coverage).toBe(0.5);
    expect(rule.condition).toEqual({ country: "US" });
    expect(rule.parentConditions).toHaveLength(1);
  });
});
