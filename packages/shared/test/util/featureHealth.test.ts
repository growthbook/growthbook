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

  it("counts a temp rollout once per rule, not once per environment", () => {
    const stopped = {
      id: "exp_done",
      status: "stopped",
      excludeFromPayload: false,
      releasedVariationId: "v1",
      linkedFeatures: ["f"],
      phases: [{ dateStarted: "2023-01-01", dateEnded: "2023-02-01" }],
    } as unknown as ExperimentInterfaceStringDates;
    const f = feature([
      {
        type: "experiment-ref",
        experimentId: "exp_done",
        variations: [{ variationId: "v1", value: "true" }],
      } as Partial<FeatureRule>,
    ]);
    const envResults: Record<string, EnvStaleResult> = {
      prod: { stale: false, tempRollout: "old-temp-rollout" },
      dev: { stale: false, tempRollout: "old-temp-rollout" },
    };
    expect(
      compute(f, {
        envResults,
        experimentMap: new Map([["exp_done", stopped]]),
      }),
    ).toEqual([
      {
        signal: "old-temp-rollout",
        count: 1,
        details: [
          { label: "exp_done", since: new Date("2023-02-01").toISOString() },
        ],
      },
    ]);
  });

  it("still reports a temp rollout when the rule cannot be resolved", () => {
    const envResults: Record<string, EnvStaleResult> = {
      prod: { stale: false, tempRollout: "temp-rollout" },
    };
    expect(compute(feature([]), { envResults })).toEqual([
      { signal: "temp-rollout", count: 1 },
    ]);
  });

  it("flags rules shadowed by an unconditional catcher, once per rule", () => {
    const f = feature([
      force("true"),
      force("false", '{"a":1}'),
      force("false"),
    ]);
    expect(compute(f)).toEqual([{ signal: "unreachable-rule", count: 2 }]);
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
      name: "Ramp A",
      status: "running",
      currentStepIndex: 0,
      steps: [{ holdConditions: { requiresApproval: true } }],
      stepApproval: null,
    } as unknown as RampScheduleInterface;
    const paused = {
      name: "Ramp B",
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
      id: "sr_1",
      status: "running",
      environment: "prod",
      startedAt: new Date(Date.now() - 48 * 3600 * 1000),
      guardrailMetricIds: ["m"],
      analysisSummary: undefined,
    } as unknown as SafeRolloutInterface;
    const f = feature([
      {
        type: "safe-rollout",
        safeRolloutId: "sr_1",
        controlValue: "false",
        variationValue: "true",
      } as Partial<FeatureRule>,
    ]);
    expect(compute(f, { safeRollouts: [safeRollout] })).toEqual([
      { signal: "safe-rollout-no-data", count: 1 },
    ]);
  });

  it("counts a ramp-monitored safe rollout while its ramp is live", () => {
    const monitor = {
      id: "sr_ramp",
      rampScheduleId: "ramp_1",
      status: "running",
      environment: "prod",
      startedAt: new Date(Date.now() - 48 * 3600 * 1000),
      guardrailMetricIds: ["m"],
    } as unknown as SafeRolloutInterface;
    const ramp = {
      id: "ramp_1",
      name: "Ramp",
      status: "running",
      steps: [],
    } as unknown as RampScheduleInterface;
    expect(
      compute(feature([]), { safeRollouts: [monitor], rampSchedules: [ramp] }),
    ).toEqual([{ signal: "safe-rollout-no-data", count: 1 }]);
  });

  it("ignores safe rollouts no rule points at any more", () => {
    const orphan = {
      id: "sr_orphan",
      status: "running",
      environment: "prod",
      startedAt: new Date(Date.now() - 48 * 3600 * 1000),
      guardrailMetricIds: ["m"],
    } as unknown as SafeRolloutInterface;
    expect(compute(feature([]), { safeRollouts: [orphan] })).toEqual([]);
  });

  it("flags invalid values once per rule and once for the default", () => {
    const f = feature(
      [
        force("maybe", '{"a":1}'),
        {
          type: "experiment-ref",
          experimentId: "exp_ok",
          variations: [
            { variationId: "a", value: "bad" },
            { variationId: "b", value: "worse" },
          ],
        } as Partial<FeatureRule>,
      ],
      { defaultValue: "nope" },
    );
    const experimentMap = new Map([
      ["exp_ok", { id: "exp_ok" } as ExperimentInterfaceStringDates],
    ]);
    expect(compute(f, { experimentMap })).toEqual([
      { signal: "invalid-value", count: 3 },
    ]);
  });

  it("validates values against an enabled JSON schema", () => {
    const schema = {
      enabled: true,
      schemaType: "schema",
      schema: JSON.stringify({
        type: "object",
        properties: { n: { type: "number" } },
        required: ["n"],
      }),
      date: new Date(),
    };
    const bad = feature([force('{"n":"x"}', '{"a":1}')], {
      valueType: "json",
      defaultValue: '{"n":1}',
      jsonSchema: schema,
    } as Partial<FeatureInterface>);
    expect(compute(bad)).toEqual([{ signal: "invalid-value", count: 1 }]);
    const good = feature([force('{"n":2}', '{"a":1}')], {
      valueType: "json",
      defaultValue: '{"n":1}',
      jsonSchema: schema,
    } as Partial<FeatureInterface>);
    expect(compute(good)).toEqual([]);
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
