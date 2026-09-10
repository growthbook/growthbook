import { RampScheduleInterface } from "shared/validators";
import { computeFeatureHealth, EnvStaleResult } from "shared/util";
import { getHealthSettings } from "shared/enterprise";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { SafeRolloutInterface } from "shared/types/safe-rollout";

const healthSettings = getHealthSettings(undefined, true);

function feature(
  rules: Partial<FeatureRule>[],
  overrides: Partial<FeatureInterface> = {},
): FeatureInterface {
  return {
    id: "f",
    valueType: "boolean",
    defaultValue: "false",
    environmentSettings: {
      prod: { enabled: true },
      dev: { enabled: true },
      off: { enabled: false },
    },
    rules: rules.map((r, i) => ({
      id: `rule_${i}`,
      description: "",
      enabled: true,
      allEnvironments: true,
      ...r,
    })),
    ...overrides,
  } as unknown as FeatureInterface;
}

const force = (value = "true", condition = ""): Partial<FeatureRule> =>
  ({ type: "force", value, condition }) as Partial<FeatureRule>;

function compute(
  f: FeatureInterface,
  extra: Partial<Parameters<typeof computeFeatureHealth>[0]> = {},
) {
  return computeFeatureHealth({
    feature: f,
    environments: ["prod", "dev", "off"],
    envResults: {},
    experimentMap: new Map(),
    rampSchedules: [],
    safeRollouts: [],
    healthSettings,
    ...extra,
  });
}

describe("computeFeatureHealth", () => {
  it("is empty for a healthy feature", () => {
    expect(compute(feature([force("true", '{"a":1}')]))).toEqual([]);
  });

  it("dedupes temp rollouts across environments and keeps the tier", () => {
    const envResults: Record<string, EnvStaleResult> = {
      prod: { stale: false, tempRollout: "old-temp-rollout" },
      dev: { stale: false, tempRollout: "old-temp-rollout" },
    };
    expect(compute(feature([]), { envResults })).toEqual([
      { signal: "old-temp-rollout", count: 2, environments: ["dev", "prod"] },
    ]);
  });

  it("flags rules shadowed by an unconditional catcher, once per rule", () => {
    const f = feature([
      force("true"),
      force("false", '{"a":1}'),
      force("false"),
    ]);
    expect(compute(f)).toEqual([
      { signal: "unreachable-rule", count: 2, environments: ["dev", "prod"] },
    ]);
  });

  it("ignores shadowing in disabled environments and by disabled rules", () => {
    const f = feature([
      { ...force("true"), enabled: false },
      { ...force("true"), allEnvironments: false, environments: ["off"] },
      force("false", '{"a":1}'),
    ]);
    expect(compute(f)).toEqual([]);
  });

  it("flags experiment-ref rules whose experiment is gone", () => {
    const f = feature([
      {
        type: "experiment-ref",
        experimentId: "exp_gone",
        variations: [{ variationId: "v", value: "true" }],
      } as Partial<FeatureRule>,
      {
        type: "experiment-ref",
        experimentId: "exp_ok",
        variations: [{ variationId: "v", value: "true" }],
      } as Partial<FeatureRule>,
    ]);
    const experimentMap = new Map([
      ["exp_ok", { id: "exp_ok" } as ExperimentInterfaceStringDates],
    ]);
    expect(compute(f, { experimentMap })).toEqual([
      { signal: "missing-experiment", count: 1 },
    ]);
  });

  it("collapses several ramps needing approval into one entry", () => {
    const needsApproval = {
      status: "running",
      currentStepIndex: 0,
      steps: [{ holdConditions: { requiresApproval: true } }],
      stepApproval: null,
    } as unknown as RampScheduleInterface;
    const paused = {
      status: "paused",
      steps: [],
    } as unknown as RampScheduleInterface;
    expect(
      compute(feature([]), {
        rampSchedules: [needsApproval, needsApproval, needsApproval, paused],
      }),
    ).toEqual([
      { signal: "ramp-needs-approval", count: 3 },
      { signal: "ramp-paused", count: 1 },
    ]);
  });

  it("reports a running safe rollout with no data after a day", () => {
    const safeRollout = {
      status: "running",
      environment: "prod",
      startedAt: new Date(Date.now() - 48 * 3600 * 1000),
      guardrailMetricIds: ["m"],
      analysisSummary: undefined,
    } as unknown as SafeRolloutInterface;
    expect(compute(feature([]), { safeRollouts: [safeRollout] })).toEqual([
      { signal: "safe-rollout-no-data", count: 1, environments: ["prod"] },
    ]);
  });

  it("flags values that fail the feature's type or schema", () => {
    const f = feature([force("maybe")], { defaultValue: "nope" });
    expect(compute(f)).toEqual([{ signal: "invalid-value", count: 2 }]);
  });

  it("orders entries most urgent first", () => {
    const f = feature([force("true"), force("bad")]);
    const envResults: Record<string, EnvStaleResult> = {
      prod: { stale: false, tempRollout: "temp-rollout" },
    };
    expect(compute(f, { envResults }).map((e) => e.signal)).toEqual([
      "invalid-value",
      "unreachable-rule",
      "temp-rollout",
    ]);
  });
});
