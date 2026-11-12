import { FeatureRule } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { SafeRolloutInterface } from "shared/validators";
import {
  displayValue,
  EnvironmentReason,
  EnvironmentStatus,
  EnvironmentValue,
  getEnvironmentStatus,
  prerequisitesSummary,
  reachedRules,
  reasonText,
  servedDot,
  StepStatus,
  holdoutTrafficStep,
  ruleProjectReach,
  ruleTrafficStep,
  sdkValueText,
  stepServes,
  stepTargets,
  stepBucketing,
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

  it.each([
    [
      "a rollout over a rule serving the rest",
      [rollout("true", 0.5), force("false")],
      { kind: "traffic", labels: ["Rollout"] },
    ],
    [
      "nothing when two rollouts both vary it",
      [rollout("true", 0.5), rollout("false", 0.5)],
      { kind: "mixed" },
    ],
  ])("names %s", (_, rules, reason) => {
    expect(status(rules.map((r) => ruleTrafficStep(r))).reason).toEqual(reason);
  });

  it("stops at the first rule that serves everyone", () => {
    const result = status(
      [force("true"), force("false")].map((r) => ruleTrafficStep(r)),
    );
    expect(result.reason).toEqual({
      kind: "traffic",
      labels: ["Force rule"],
    });
    expect(result.steps.map((s) => s.reachable)).toEqual([true, false]);
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

  it("varies by user behind a bandit", () => {
    const result = status([
      ruleTrafficStep(experimentRule, {
        experiment: experiment({ type: "multi-armed-bandit" }),
      }),
    ]);
    expect(result).toMatchObject({
      value: { kind: "varies" },
      rules: "varies",
    });
  });

  // The SDK skips a bucketed rule for a user without its hash attribute.
  it.each([
    [
      "a running experiment",
      {},
      { kind: "partial", value: "true", percent: 0.5 },
      "Split by",
    ],
    [
      "a stopped experiment's released variation",
      { status: "stopped", releasedVariationId: "v1" },
      { kind: "value", value: "true" },
      // One value, to the share its coverage samples.
      "Sample by",
    ],
  ] as const)(
    "lets whoever lacks the hash attribute past %s at full coverage",
    (_, overrides, value, bucketing) => {
      const step = ruleTrafficStep(experimentRule, {
        experiment: experiment({ hashAttribute: "user_id", ...overrides }),
      });
      const alone = status([step]);
      // The share it shows still counts everyone as having one.
      expect(alone.value).toEqual(value);
      expect(alone.reason).toEqual({
        kind: "traffic",
        labels: ["Experiment"],
      });
      expect(alone.defaultValue).toBe("applies");
      expect(alone.defaultWithout).toEqual(["user_id"]);
      expect(stepTargets(step)).toBe("All users");
      expect(stepBucketing(step)).toEqual({
        label: bucketing,
        attribute: "user_id",
      });
      expect(reachedRules(alone)).toEqual({ rule: step, count: 1 });

      // A rule that buckets no one still ends it.
      const followed = status([step, ruleTrafficStep(force("false"))]);
      expect(followed.steps.map((s) => s.reachable)).toEqual([true, true]);
      expect(followed.defaultValue).toBe("skipped");
      expect(followed.defaultWithout).toEqual([]);
    },
  );

  it.each([
    ["to everyone", {}, { kind: "value", value: "true" }],
    [
      "to its phase's coverage",
      { coverage: 0.4 },
      { kind: "partial", value: "true", percent: 0.4 },
    ],
    [
      "past a legacy namespace, which its force rule doesn't read",
      { namespace: { enabled: true, name: "ns", range: [0, 0.5] } },
      { kind: "value", value: "true" },
    ],
    [
      "within a multi-range namespace, its filter",
      { namespace: { enabled: true, name: "ns", ranges: [[0, 0.5]] } },
      { kind: "partial", value: "true", percent: 0.5 },
    ],
  ])(
    "serves a stopped experiment's released variation %s",
    (_, phase, value) => {
      const result = status([
        ruleTrafficStep(experimentRule, {
          experiment: experiment(
            { status: "stopped", releasedVariationId: "v1" },
            phase,
          ),
        }),
      ]);
      expect(result.value).toEqual(value);
    },
  );

  // Targeted, so only reaching no one tells them apart from varying.
  const targeted = { condition: '{"country":"US"}' };
  it.each([
    [
      "a stopped experiment with no released variation",
      ruleTrafficStep(experimentRule, {
        experiment: experiment(
          { status: "stopped", releasedVariationId: "" },
          targeted,
        ),
      }),
    ],
    [
      "an experiment with one variation",
      ruleTrafficStep(experimentRule, {
        experiment: experiment(
          {
            variations: [{ id: "v1" }],
          } as Partial<ExperimentInterfaceStringDates>,
          targeted,
        ),
      }),
    ],
    [
      "an experiment at 0% coverage",
      ruleTrafficStep(experimentRule, {
        experiment: experiment({}, { coverage: 0, ...targeted }),
      }),
    ],
    [
      "a rollout at 0%",
      ruleTrafficStep({ ...rollout("true", 0), ...targeted } as FeatureRule),
    ],
    [
      "an inline experiment at 0% coverage",
      ruleTrafficStep({
        id: "x",
        type: "experiment",
        coverage: 0,
        values: [
          { value: "false", weight: 0.5 },
          { value: "true", weight: 0.5 },
        ],
        ...targeted,
      } as FeatureRule),
    ],
  ])("skips %s, whatever it targets, as the SDK does", (_, step) => {
    expect(status([step])).toMatchObject({
      value: { kind: "value", value: "false" },
      reason: { kind: "default" },
    });
    expect(stepTargets(step)).toBe("No one");
  });

  it("splits evenly when an experiment's weights don't add up", () => {
    expect(
      status([
        ruleTrafficStep(experimentRule, {
          experiment: experiment({}, { variationWeights: [0.2, 0.2] }),
        }),
      ]).value,
    ).toEqual({ kind: "partial", value: "true", percent: 0.5 });
  });

  it("serves null from an archived flag", () => {
    expect(
      status([ruleTrafficStep(force("true"))], { archived: true }),
    ).toMatchObject({
      value: { kind: "value", value: null },
      reason: { kind: "archived" },
    });
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
      [holdoutTrafficStep("false", experiment({}, { coverage: 0.2 }))],
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

  it("counts an experiment's split of a non-boolean value as a split", () => {
    expect(
      status(
        [
          ruleTrafficStep(
            {
              ...experimentRule,
              variations: [
                { variationId: "v0", value: "c" },
                { variationId: "v1", value: "FOO" },
              ],
            } as FeatureRule,
            { experiment: experiment({}, { coverage: 0.5 }) },
          ),
        ],
        { isBoolean: false, defaultValue: "c" },
      ).value,
    ).toEqual({ kind: "varies" });
  });

  it("reads non-boolean values it can't reduce to one as varying", () => {
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
    expect(result.value).toEqual({ kind: "varies" });
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

  it("serves the holdout's control group ahead of an unmet prerequisite", () => {
    const prerequisites = [{ id: "parent", result: "unmet" as const }];
    const held = (value: string) =>
      status(
        [
          holdoutTrafficStep(value, experiment({}, { coverage: 0.1 })),
          ruleTrafficStep(force("true")),
        ],
        { prerequisites },
      );
    const result = held("true");
    expect(result).toMatchObject({
      value: { kind: "partial", value: "true", percent: 0.05 },
      reason: { kind: "prerequisite", result: "unmet", holdout: true },
      prerequisites: "unmet",
      holdout: "applies",
      rules: "skipped",
      defaultValue: "skipped",
    });
    expect(result.steps.map((s) => s.step.kind)).toEqual(["holdout"]);
    expect(reasonText(result.reason)).toBe("Holdout + Prerequisite not met");
    // Held back to false, a boolean flag reads the same as serving nothing.
    expect(held("false")).toMatchObject({
      value: { kind: "value", value: null },
      holdout: "applies",
    });
    expect(reasonText(held("false").reason)).toBe("Prerequisite not met");
  });

  it.each([
    [
      "the default",
      [force("true", '{"country":"US"}')],
      "true",
      { kind: "default" },
    ],
    [
      "the rule after it",
      [force("true", '{"country":"US"}'), force("true")],
      "false",
      { kind: "traffic", labels: ["Force rule"] },
    ],
  ])(
    "serves one value when a targeted rule serves the same as %s",
    (_, rules, defaultValue, reason) => {
      const result = status(
        rules.map((r) => ruleTrafficStep(r)),
        { defaultValue },
      );
      expect(result.value).toEqual({ kind: "value", value: "true" });
      expect(result.reason).toEqual(reason);
    },
  );

  it("varies when a targeted rule sits ahead of values it can't know", () => {
    expect(
      status(
        [
          ruleTrafficStep(force("true", '{"country":"US"}')),
          ruleTrafficStep(experimentRule, {
            experiment: experiment({ type: "multi-armed-bandit" }),
          }),
        ],
        { defaultValue: "true" },
      ).value,
    ).toEqual({ kind: "varies" });
  });

  it("lets whoever lacks a split's attribute past it to the default", () => {
    const allTrue = {
      ...experimentRule,
      variations: [
        { variationId: "v0", value: "true" },
        { variationId: "v1", value: "true" },
      ],
    } as FeatureRule;
    expect(
      status([
        ruleTrafficStep(force("true", '{"country":"US"}')),
        ruleTrafficStep(allTrue, { experiment: experiment() }),
      ]).value,
    ).toEqual({ kind: "varies" });
  });

  it("puts the holdout ahead of prerequisite targeting, as the SDK does", () => {
    const holdout = holdoutTrafficStep(
      "false",
      experiment({}, { coverage: 0.1 }),
    );
    expect(
      status([holdout, ruleTrafficStep(force("true"))], {
        prerequisites: [{ id: "parent", result: "varies" }],
      }).reason,
    ).toEqual({
      kind: "traffic",
      labels: ["Holdout", "Prerequisite targeting"],
    });
  });

  it("names nothing when prerequisite targeting and a split both vary it", () => {
    expect(
      status([ruleTrafficStep(experimentRule, { experiment: experiment() })], {
        prerequisites: [{ id: "parent", result: "varies" }],
      }),
    ).toMatchObject({
      value: { kind: "varies" },
      reason: { kind: "mixed" },
      prerequisites: "varies",
      rules: "applies",
    });
  });

  it("names nothing when rules after a targeted one take over the rest", () => {
    const result = status(
      [
        force("true", '{"country":"US"}'),
        rollout("false", 0.5),
        force("x"),
      ].map((r) => ruleTrafficStep(r)),
    );
    expect(result.reason).toEqual({ kind: "mixed" });
  });

  it("chains the steps before the one that varies", () => {
    const holdout = holdoutTrafficStep(
      "false",
      experiment({}, { coverage: 0.1 }),
    );
    expect(
      status([holdout, ruleTrafficStep(force("true", '{"country":"US"}'))])
        .reason,
    ).toEqual({
      kind: "traffic",
      labels: ["Holdout", "Force rule"],
    });
  });
});

describe("stepServes and stepTargets", () => {
  it.each([
    [
      "a partial rollout",
      ruleTrafficStep(rollout("true", 0.5)),
      { kind: "value", value: "true" },
      "50% of users",
    ],
    [
      "a targeted rule",
      ruleTrafficStep(force("x", '{"country":"US"}')),
      { kind: "value", value: "x" },
      "Specific users",
    ],
    [
      "an experiment's split among whoever it reaches",
      ruleTrafficStep(experimentRule, {
        experiment: experiment({}, { coverage: 0.5 }),
      }),
      { kind: "partial", value: "true", percent: 0.5 },
      "50% of users",
    ],
    [
      "a bandit",
      ruleTrafficStep(experimentRule, {
        experiment: experiment({ type: "multi-armed-bandit" }),
      }),
      { kind: "varies" },
      "All users",
    ],
  ])("reads %s", (_, step, serves, targets) => {
    expect(stepServes(step, true)).toEqual(serves);
    expect(stepTargets(step)).toBe(targets);
  });
});

describe("reachedRules", () => {
  const targeted = ruleTrafficStep(force("true", '{"country":"US"}'));
  const partial = ruleTrafficStep(rollout("true", 0.55));
  const everyone = ruleTrafficStep(force("true"));
  const holdout = holdoutTrafficStep(
    "false",
    experiment({}, { coverage: 0.2 }),
  );
  it.each([
    ["a rule taking everyone", [everyone], everyone, 1],
    ["a set share over the default", [partial], partial, 1],
    ["a targeted rule", [targeted], null, 1],
    ["several rules", [targeted, everyone], null, 2],
    ["a rule reaching no one", [ruleTrafficStep(rollout("true", 0))], null, 0],
    ["a set share past a holdout", [holdout, partial], partial, 1],
    ["several rules past a holdout", [holdout, targeted, everyone], null, 2],
  ] as const)("lists %s", (_, steps, rule, count) => {
    expect(reachedRules(status([...steps]))).toEqual({ rule, count });
  });
});

describe("sdkValueText", () => {
  it.each([
    ["string", " y ", " y "],
    ["number", 1, "1"],
    ["boolean", false, "false"],
    ["json", { a: 1, b: [2] }, '{"a":1,"b":[2]}'],
    ["json", null, "null"],
  ] as const)("shows a served %s %j as %j", (valueType, served, text) => {
    expect(sdkValueText(valueType, served)).toBe(text);
  });
});

describe("ruleProjectReach", () => {
  const scoped = (projects?: string[], allProjects?: boolean) =>
    ({ ...force("true"), projects, allProjects }) as FeatureRule;
  it.each([
    ["an unscoped rule", scoped(), ["a", "b"], "all"],
    [
      "a rule scoped to every delivery project",
      scoped(["a", "b"], false),
      ["a", "b"],
      "all",
    ],
    ["a rule scoped to one of two", scoped(["a"], false), ["a", "b"], "some"],
    ["a rule scoped elsewhere", scoped(["c"], false), ["a", "b"], "none"],
    ["a rule scoped to no project", scoped([], false), ["a"], "none"],
    [
      "a scoped rule on a flag sent everywhere",
      scoped(["a"], false),
      null,
      "some",
    ],
  ])(
    "reaches %s's connections as the payload does",
    (_, rule, delivery, reach) => {
      expect(ruleProjectReach(rule, delivery)).toBe(reach);
    },
  );
});

describe("displayValue", () => {
  it.each([
    [null, "string", "null"],
    ["hi", "string", '"hi"'],
    ["3.5", "number", "3.5"],
    [null, "json", "null"],
    ["null", "json", "null"],
    ["{}", "json", "{}"],
    ["[]", "json", "[]"],
    ['{"a":1}', "json", null],
    ["[1]", "json", null],
    ['"hi"', "json", null],
    ["{not json", "json", null],
  ] as const)("shows %j (%s) as %j", (value, type, shown) => {
    expect(displayValue(value, type)).toBe(shown);
  });
});

describe("servedDot", () => {
  const card = (value: EnvironmentValue, prerequisites: StepStatus = "none") =>
    ({
      ...status([]),
      value,
      prerequisites,
    }) as EnvironmentStatus;
  it.each([
    ["null", card({ kind: "value", value: null }), "string", "empty"],
    ["a JSON null", card({ kind: "value", value: "null" }), "json", "empty"],
    ["a value", card({ kind: "value", value: "1" }), "number", "on"],
    [
      "one that varies by prerequisite",
      card({ kind: "varies" }, "varies"),
      "string",
      "split",
    ],
    ["one that varies by rule", card({ kind: "varies" }), "string", "on"],
  ] as const)("marks %s", (_, value, type, dot) => {
    expect(servedDot(value, type)).toBe(dot);
  });
});

describe("reasonText", () => {
  it.each([
    [{ kind: "disabled" }, "Environment OFF"],
    [{ kind: "archived" }, "Feature Flag archived"],
    [
      { kind: "prerequisite", result: "unmet", count: 1 },
      "Prerequisite not met",
    ],
    [
      { kind: "prerequisite", result: "unmet", count: 2 },
      "Prerequisites not met",
    ],
    [
      { kind: "prerequisite", result: "cycle", count: 1 },
      "Circular dependency",
    ],
    [
      {
        kind: "traffic",
        labels: ["Rollout", "Experiment"],
      },
      "Rollout + Experiment",
    ],
    [{ kind: "default" }, "Default value"],
    [{ kind: "mixed" }, null],
  ] as [EnvironmentReason, string | null][])(
    "says %j as %j",
    (reason, text) => {
      expect(reasonText(reason)).toBe(text);
    },
  );
});

describe("prerequisitesSummary", () => {
  it.each([
    [["met"], "skipped", "Not reachable"],
    [["met", "cycle", "unmet"], "applies", "Circular dependency"],
    [["met", "unmet", "varies"], "applies", "Not met"],
    [["met", "varies"], "applies", "Met for some users"],
    [["met", "met"], "applies", "All met"],
    [["met"], "applies", "Met"],
  ] as const)("sums up %j (%s) as %j", (results, overall, text) => {
    expect(prerequisitesSummary([...results], overall)).toBe(text);
  });
});
