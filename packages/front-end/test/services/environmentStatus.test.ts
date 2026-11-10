import { FeatureRule } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { SafeRolloutInterface } from "shared/validators";
import {
  getEnvironmentStatus,
  holdoutTrafficStep,
  resolveRuleValue,
  ruleTrafficStep,
  TrafficStep,
} from "@/services/environmentStatus";

const force = (value: string, condition = ""): FeatureRule =>
  ({ id: "f", type: "force", value, condition, enabled: true }) as FeatureRule;
const rollout = (value: string, coverage: number): FeatureRule =>
  ({
    id: "r",
    type: "rollout",
    value,
    coverage,
    hashAttribute: "id",
    enabled: true,
  }) as FeatureRule;
const experimentRule = {
  id: "e",
  type: "experiment-ref",
  experimentId: "exp_1",
  variations: [
    { variationId: "v0", value: "false" },
    { variationId: "v1", value: "true" },
  ],
} as FeatureRule;
const experiment = (
  overrides: Partial<ExperimentInterfaceStringDates> = {},
  phase: Record<string, unknown> = {},
) =>
  ({
    id: "exp_1",
    name: "checkout",
    type: "standard",
    status: "running",
    variations: [{ id: "v0" }, { id: "v1" }],
    phases: [{ coverage: 1, variationWeights: [0.5, 0.5], ...phase }],
    ...overrides,
  }) as ExperimentInterfaceStringDates;

const status = (
  steps: TrafficStep[],
  overrides: Partial<Parameters<typeof getEnvironmentStatus>[0]> = {},
) =>
  getEnvironmentStatus({
    enabled: true,
    prerequisites: [],
    steps,
    defaultValue: "false",
    isBoolean: true,
    ...overrides,
  });

describe("getEnvironmentStatus", () => {
  it("serves null from a disabled environment, reaching nothing else", () => {
    expect(
      status([ruleTrafficStep(force("true"))], { enabled: false }),
    ).toMatchObject({
      value: { kind: "value", value: null },
      reason: { kind: "disabled" },
      environment: "off",
      rules: "skipped",
      defaultValue: "skipped",
    });
  });

  it.each([
    ["no rules", [], "false", { kind: "value", value: "false" }],
    [
      "a force rule",
      [force("true")],
      "false",
      { kind: "value", value: "true" },
    ],
    [
      "a full rollout",
      [rollout("true", 1)],
      "false",
      { kind: "value", value: "true" },
    ],
    [
      "a partial rollout over the default",
      [rollout("true", 0.5)],
      "false",
      { kind: "partial", value: "true", percent: 0.5 },
    ],
    [
      "a partial rollout of false over a true default",
      [rollout("false", 0.3)],
      "true",
      { kind: "partial", value: "true", percent: 0.7 },
    ],
    [
      "a partial rollout of the default value",
      [rollout("false", 0.5)],
      "false",
      { kind: "value", value: "false" },
    ],
    [
      // Their hashes may or may not overlap.
      "two partial rollouts",
      [rollout("true", 0.1), rollout("true", 0.5)],
      "false",
      { kind: "partial", value: "true", percent: null },
    ],
    [
      "a partial rollout ahead of a force rule",
      [rollout("true", 0.3), force("false")],
      "false",
      { kind: "partial", value: "true", percent: 0.3 },
    ],
    [
      "a targeted rule",
      [force("true", '{"country":"US"}')],
      "false",
      { kind: "varies" },
    ],
  ])("serves %s", (_, rules, defaultValue, value) => {
    const result = status(
      (rules as FeatureRule[]).map((r) => ruleTrafficStep(r)),
      {
        defaultValue,
      },
    );
    expect(result.value).toEqual(value);
  });

  it("names a run of the same kind of step once", () => {
    expect(
      status(
        [rollout("true", 0.5), rollout("true", 0.5)].map((r) =>
          ruleTrafficStep(r),
        ),
      ).reason,
    ).toEqual({ kind: "traffic", labels: ["Rollout"] });
  });

  it("stops at the first rule that serves everyone", () => {
    const result = status(
      [force("true"), force("false")].map((r) => ruleTrafficStep(r)),
    );
    expect(result.reason).toEqual({ kind: "traffic", labels: ["Force rule"] });
    expect(result.steps).toHaveLength(1);
    expect(result.defaultValue).toBe("skipped");
  });

  it("splits by an untargeted experiment's coverage, namespace and weights", () => {
    const result = status([
      ruleTrafficStep(experimentRule, {
        experiment: experiment(
          {},
          {
            coverage: 0.8,
            namespace: { enabled: true, name: "ns", range: [0, 0.5] },
          },
        ),
      }),
    ]);
    // 80% × 50% of the namespace take part; half of them get true.
    expect(result.value).toEqual({
      kind: "partial",
      value: "true",
      percent: 0.2,
    });
    expect(result.reason).toEqual({
      kind: "traffic",
      labels: ["Experiment"],
    });
  });

  it.each([
    ["is a bandit", experiment({ type: "multi-armed-bandit" })],
    ["targets", experiment({}, { condition: '{"country":"US"}' })],
    ["is missing", undefined],
  ])("varies by user when the experiment %s", (_, exp) => {
    expect(
      status([ruleTrafficStep(experimentRule, { experiment: exp })]),
    ).toMatchObject({
      value: { kind: "varies" },
      reason: { kind: "traffic" },
      rules: "varies",
      defaultValue: "applies",
    });
  });

  it("serves a stopped experiment's released variation", () => {
    const result = status([
      ruleTrafficStep(experimentRule, {
        experiment: experiment({
          status: "stopped",
          releasedVariationId: "v1",
        }),
      }),
    ]);
    expect(result.value).toEqual({ kind: "value", value: "true" });
  });

  it.each([
    ["released", undefined, { kind: "value", value: "true" }],
    ["rolled-back", undefined, { kind: "value", value: "false" }],
    // Half of a 20% ramp-up step gets the variation.
    ["running", 0.2, { kind: "partial", value: "true", percent: 0.1 }],
  ])("serves a %s safe rollout", (ruleStatus, percent, value) => {
    const rule = {
      id: "s",
      type: "safe-rollout",
      status: ruleStatus,
      controlValue: "false",
      variationValue: "true",
      safeRolloutId: "sr_1",
    } as FeatureRule;
    const safeRollout = {
      rampUpSchedule: {
        enabled: true,
        step: 0,
        steps: [{ percent }],
        rampUpCompleted: false,
      },
    } as SafeRolloutInterface;
    expect(status([ruleTrafficStep(rule, { safeRollout })]).value).toEqual(
      value,
    );
  });

  it("serves the holdout's control group ahead of the rules", () => {
    const holdout = holdoutTrafficStep(
      { id: "hld_1", name: "Q4" },
      "false",
      experiment({}, { coverage: 0.1, variationWeights: [0.5, 0.5] }),
    );
    const result = status([holdout, ruleTrafficStep(force("true"))]);
    expect(result.value).toEqual({
      kind: "partial",
      value: "true",
      percent: 0.95,
    });
    expect(result.reason).toEqual({
      kind: "traffic",
      labels: ["Holdout", "Force rule"],
    });
    expect(result).toMatchObject({ holdout: "applies", rules: "applies" });
  });

  it("serves one non-boolean value over the default for its share", () => {
    expect(
      status([ruleTrafficStep(rollout("3.14", 0.5))], {
        isBoolean: false,
        defaultValue: "1",
      }).value,
    ).toEqual({ kind: "partial", value: "3.14", percent: 0.5 });
  });

  it.each([
    [
      "a rollout of the default value",
      [ruleTrafficStep(rollout("1.0", 0.37))],
      "1.0",
    ],
    [
      "a holdout of what everyone else gets",
      [
        holdoutTrafficStep(
          { id: "hld_1", name: "Q4" },
          "false",
          experiment({}, { coverage: 0.2 }),
        ),
      ],
      "false",
    ],
  ])("leaves %s out of the reason", (_, steps, defaultValue) => {
    expect(status(steps, { defaultValue, isBoolean: false })).toMatchObject({
      value: { kind: "value", value: defaultValue },
      reason: { kind: "default" },
    });
  });

  it("credits one of two rules that serve the same", () => {
    expect(
      status([force("true"), force("true")].map((r) => ruleTrafficStep(r)))
        .reason,
    ).toEqual({ kind: "traffic", labels: ["Force rule"] });
  });

  it("counts non-boolean values it can't reduce to one", () => {
    const result = status(
      [
        ruleTrafficStep(
          {
            ...experimentRule,
            variations: [
              { variationId: "v0", value: "a" },
              { variationId: "v1", value: "b" },
            ],
          } as FeatureRule,
          { experiment: experiment() },
        ),
      ],
      { isBoolean: false, defaultValue: "c" },
    );
    expect(result.value).toEqual({ kind: "split", count: 2 });
  });

  it("serves null when a prerequisite isn't met or forms a cycle", () => {
    for (const result of ["unmet", "cycle"] as const) {
      expect(
        status([], { prerequisites: [{ id: "parent", result }] }),
      ).toMatchObject({
        value: { kind: "value", value: null },
        reason: { kind: "prerequisite", result, count: 1 },
        prerequisites: "unmet",
        defaultValue: "skipped",
      });
    }
  });

  it("chains prerequisite targeting ahead of the steps that serve", () => {
    expect(
      status([ruleTrafficStep(experimentRule, { experiment: experiment() })], {
        prerequisites: [{ id: "parent", result: "varies" }],
      }),
    ).toMatchObject({
      value: { kind: "varies" },
      reason: {
        kind: "traffic",
        labels: ["Prerequisite targeting", "Experiment"],
      },
      prerequisites: "varies",
      rules: "applies",
    });
  });

  it("chains the steps before the one that varies", () => {
    const holdout = holdoutTrafficStep(
      { id: "hld_1", name: "Q4" },
      "false",
      experiment({}, { coverage: 0.1 }),
    );
    expect(
      status([holdout, ruleTrafficStep(force("true", '{"country":"US"}'))])
        .reason,
    ).toEqual({ kind: "traffic", labels: ["Holdout", "Force rule"] });
  });
});

describe("resolveRuleValue", () => {
  const json = { valueType: "json" as const, defaultValue: '{"a": 1, "b": 2}' };
  it.each([
    [
      "merges a sparse patch onto the default",
      '{"b": 3}',
      true,
      '{"a":1,"b":3}',
    ],
    ["respaces JSON", '{ "b" : 3 }', false, '{"b":3}'],
  ])("%s", (_, value, sparse, expected) => {
    expect(resolveRuleValue(json, value, sparse)).toBe(expected);
  });

  it("leaves other types alone", () => {
    expect(
      resolveRuleValue({ valueType: "string", defaultValue: "x" }, " y "),
    ).toBe(" y ");
  });
});
