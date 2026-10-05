import {
  addHours,
  subDays,
  subHours,
  subMinutes,
  subMonths,
  subWeeks,
} from "date-fns";
import { RampScheduleInterface } from "shared/validators";
import {
  computeFeatureHealth,
  EnvStaleResult,
  getTempRolloutStaleReason,
  isFeatureStale,
} from "shared/util";
import { getHealthSettings } from "shared/enterprise";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { GroupMap } from "shared/types/saved-group";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { OrganizationSettings } from "shared/types/organization";
import { SafeRolloutInterface } from "shared/types/safe-rollout";

const healthSettings = getHealthSettings(undefined, true);

// Fixed clock for every window assertion; time fixtures derive from it.
const NOW = new Date("2026-10-01T12:00:00.000Z");

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

const rollout = (coverage: number, value = "true"): Partial<FeatureRule> =>
  ({
    type: "rollout",
    value,
    coverage,
    hashAttribute: "id",
    condition: "",
  }) as Partial<FeatureRule>;

const expRef = (
  experimentId: string,
  values: string[] = ["true"],
): Partial<FeatureRule> =>
  ({
    type: "experiment-ref",
    experimentId,
    variations: values.map((value, i) => ({ variationId: `v${i}`, value })),
  }) as Partial<FeatureRule>;

const safeRolloutRule = (safeRolloutId: string): Partial<FeatureRule> =>
  ({
    type: "safe-rollout",
    safeRolloutId,
    controlValue: "false",
    variationValue: "true",
  }) as Partial<FeatureRule>;

const numberSchema: FeatureInterface["jsonSchema"] = {
  enabled: true,
  schemaType: "schema",
  schema: JSON.stringify({
    type: "object",
    properties: { n: { type: "number" } },
    required: ["n"],
  }),
  simple: { type: "object", fields: [] },
  date: NOW,
};

const jsonFeature = (
  rules: Partial<FeatureRule>[],
  jsonSchema: FeatureInterface["jsonSchema"],
) => feature(rules, { valueType: "json", defaultValue: '{"n":1}', jsonSchema });

const okExperiment = new Map([
  ["exp_ok", { id: "exp_ok" } as ExperimentInterfaceStringDates],
]);

const stoppedExperiment = (endedAt: Date): ExperimentInterfaceStringDates =>
  ({
    id: "exp_done",
    name: "Winner rollout",
    status: "stopped",
    excludeFromPayload: false,
    releasedVariationId: "v0",
    linkedFeatures: ["f"],
    phases: [
      {
        dateStarted: subDays(endedAt, 7).toISOString(),
        dateEnded: endedAt.toISOString(),
      },
    ],
  }) as unknown as ExperimentInterfaceStringDates;

const runningSafeRollout = (
  overrides: Record<string, unknown> = {},
): SafeRolloutInterface =>
  ({
    id: "sr_1",
    status: "running",
    environment: "prod",
    startedAt: subHours(NOW, 48),
    guardrailMetricIds: ["m"],
    ...overrides,
  }) as unknown as SafeRolloutInterface;

const analysisSummary = (
  health: { totalUsers: number; srm: number; multipleExposures?: number },
  guardrail?: "lost" | "safe" | "errored",
) => ({
  snapshotId: "snap",
  health: { multipleExposures: 0, ...health },
  ...(guardrail
    ? {
        resultsStatus: {
          variations: [
            {
              variationId: "1",
              guardrailMetrics: { m: { status: guardrail } },
            },
          ],
          settings: { sequentialTesting: true },
        },
      }
    : {}),
});

const approvalRamp = (
  overrides: Record<string, unknown> = {},
): RampScheduleInterface =>
  ({
    id: "ramp_1",
    name: "Ramp",
    status: "running",
    currentStepIndex: 1,
    steps: [{}, { interval: 3600, holdConditions: { requiresApproval: true } }],
    stepApproval: null,
    nextStepAt: NOW,
    ...overrides,
  }) as unknown as RampScheduleInterface;

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
    const bad = jsonFeature([force('{"n":"x"}', '{"a":1}')], numberSchema);
    expect(compute(bad)).toEqual([{ signal: "invalid-value", count: 1 }]);
    const good = jsonFeature([force('{"n":2}', '{"a":1}')], numberSchema);
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

  it("accepts only the literal strings true and false on a boolean flag", () => {
    const coerced = feature(
      ["TRUE", "True", "1", " true", ""].map((v) => force(v, '{"a":1}')),
    );
    expect(compute(coerced)).toEqual([{ signal: "invalid-value", count: 5 }]);
    expect(
      compute(feature([force("false", '{"a":1}')], { defaultValue: "true" })),
    ).toEqual([]);
  });

  it("checks numbers against the stored-string grammar and never rejects a plain string", () => {
    const numbers = feature(
      ["1.5", "-2", "0", "1e3", "abc", "", "1."].map((v) =>
        force(v, '{"a":1}'),
      ),
      { valueType: "number", defaultValue: "0" },
    );
    expect(compute(numbers)).toEqual([{ signal: "invalid-value", count: 4 }]);
    const strings = feature(
      ["", "{not json", "TRUE"].map((v) => force(v, '{"a":1}')),
      { valueType: "string", defaultValue: "" },
    );
    expect(compute(strings)).toEqual([]);
  });

  it("counts a schema failure in one variation once for the whole rule", () => {
    const f = jsonFeature(
      [force('{"n":2}', '{"a":1}'), expRef("exp_ok", ['{"n":3}', '{"n":"x"}'])],
      numberSchema,
    );
    expect(compute(f, { experimentMap: okExperiment })).toEqual([
      { signal: "invalid-value", count: 1 },
    ]);
  });

  it("applies a schema only while enabled, from either schemaType, and repairs loose JSON first", () => {
    const disabled = jsonFeature([force('{"n":"x"}', '{"a":1}')], {
      ...numberSchema!,
      enabled: false,
    });
    expect(compute(disabled)).toEqual([]);

    const simpleSchema: FeatureInterface["jsonSchema"] = {
      enabled: true,
      schemaType: "simple",
      schema: "",
      simple: {
        type: "object",
        fields: [
          {
            key: "n",
            type: "integer",
            required: true,
            default: "",
            description: "",
            enum: [],
          },
        ],
      },
      date: NOW,
    };
    expect(
      compute(jsonFeature([force('{"n":"x"}', '{"a":1}')], simpleSchema)),
    ).toEqual([{ signal: "invalid-value", count: 1 }]);
    expect(
      compute(jsonFeature([force("{n: 2}", '{"a":1}')], simpleSchema)),
    ).toEqual([]);
  });

  it("skips disabled rules for every signal and treats an absent enabled flag as live", () => {
    const f = feature([
      { ...force("maybe", '{"a":1}'), enabled: false },
      { ...expRef("exp_gone"), enabled: false },
      { ...force("nope", '{"a":1}'), enabled: undefined },
    ]);
    expect(compute(f)).toEqual([{ signal: "invalid-value", count: 1 }]);
  });

  it("checks values and experiment links of rules confined to a disabled environment, but not their shadowing", () => {
    const offOnly = { allEnvironments: false, environments: ["off"] };
    const f = feature([
      { ...force("true"), ...offOnly },
      { ...force("maybe", '{"a":1}'), ...offOnly },
      { ...expRef("exp_gone"), ...offOnly },
    ]);
    expect(compute(f)).toEqual([
      { signal: "invalid-value", count: 1 },
      { signal: "missing-experiment", count: 1 },
    ]);
  });

  it("evaluates shadowing only in the environments the caller passes", () => {
    const restrictedOnly = {
      allEnvironments: false,
      environments: ["restricted"],
    };
    const f = feature(
      [
        { ...force("true"), ...restrictedOnly },
        { ...force("false", '{"a":1}'), ...restrictedOnly },
      ],
      {
        environmentSettings: {
          prod: { enabled: true },
          restricted: { enabled: true },
        },
      },
    );
    // A project-restricted env the caller leaves out is not evaluated even
    // though the feature has it enabled.
    expect(compute(f, { environments: ["prod"] })).toEqual([]);
    expect(compute(f, { environments: ["prod", "restricted"] })).toEqual([
      { signal: "unreachable-rule", count: 1 },
    ]);
    // Unlike isFeatureStale, no fallback to the feature's own env list.
    expect(compute(f, { environments: [] })).toEqual([]);
  });

  it("treats an empty-object condition as unconditional but schedules, prerequisites and partial rollouts as targeting", () => {
    expect(
      compute(feature([force("true", "{}"), force("false", '{"a":1}')])),
    ).toEqual([{ signal: "unreachable-rule", count: 1 }]);

    const targeted = feature([
      {
        ...force("true"),
        scheduleRules: [{ timestamp: "2026-12-01T00:00:00Z", enabled: true }],
      },
      {
        ...force("true"),
        prerequisites: [{ id: "parent", condition: '{"value": true}' }],
      },
      rollout(0.5),
      force("false", '{"a":1}'),
    ]);
    expect(compute(targeted)).toEqual([]);

    expect(compute(feature([rollout(1), force("false", '{"a":1}')]))).toEqual([
      { signal: "unreachable-rule", count: 1 },
    ]);
  });

  it("trusts knownExperimentIds over the readable experiment map and counts missing links per rule", () => {
    const f = feature([
      expRef("exp_hidden"),
      expRef("exp_hidden"),
      expRef("exp_visible"),
    ]);
    const experimentMap = new Map([
      ["exp_visible", { id: "exp_visible" } as ExperimentInterfaceStringDates],
    ]);
    expect(
      compute(f, {
        experimentMap,
        knownExperimentIds: new Set(["exp_hidden", "exp_visible"]),
      }),
    ).toEqual([]);
    expect(
      compute(f, {
        experimentMap,
        knownExperimentIds: new Set(["exp_visible"]),
      }),
    ).toEqual([{ signal: "missing-experiment", count: 2 }]);
    expect(
      compute(f, { experimentMap, knownExperimentIds: new Set() }),
    ).toEqual([{ signal: "missing-experiment", count: 3 }]);
  });

  it("counts invalid values once per rule for bandit and safe-rollout rules too", () => {
    const f = feature([
      {
        type: "contextual-bandit-ref",
        contextualBanditId: "cb_1",
        variations: [
          { variationId: "a", value: "yes" },
          { variationId: "b", value: "no" },
          { variationId: "c", value: "1" },
        ],
      } as Partial<FeatureRule>,
      {
        type: "safe-rollout",
        safeRolloutId: "sr_1",
        controlValue: "0",
        variationValue: "1",
      } as Partial<FeatureRule>,
      rollout(0.5, "maybe"),
    ]);
    expect(compute(f)).toEqual([{ signal: "invalid-value", count: 3 }]);
  });

  it("does not special-case archived flags; the caller decides whether to show their signals", () => {
    const f = feature([force("true"), force("maybe")], { archived: true });
    expect(compute(f)).toEqual([
      { signal: "invalid-value", count: 1 },
      { signal: "unreachable-rule", count: 1 },
    ]);
  });

  describe("at a fixed clock", () => {
    beforeEach(() => jest.useFakeTimers({ now: NOW }));
    afterEach(() => jest.useRealTimers());

    it("matches the stale pass's temp rollout tier at the 30-day boundary", () => {
      const f = feature([expRef("exp_done")]);
      const recent = subDays(NOW, 30);
      expect(
        compute(f, {
          envResults: { prod: { stale: false, tempRollout: "temp-rollout" } },
          experimentMap: new Map([["exp_done", stoppedExperiment(recent)]]),
        }),
      ).toEqual([
        {
          signal: "temp-rollout",
          count: 1,
          details: [{ label: "Winner rollout", since: recent.toISOString() }],
        },
      ]);
      const old = subDays(NOW, 31);
      expect(
        compute(f, {
          envResults: {
            prod: {
              stale: true,
              reason: "old-temp-rollout",
              tempRollout: "old-temp-rollout",
            },
          },
          experimentMap: new Map([["exp_done", stoppedExperiment(old)]]),
        }),
      ).toEqual([
        {
          signal: "old-temp-rollout",
          count: 1,
          details: [{ label: "Winner rollout", since: old.toISOString() }],
        },
      ]);
    });

    it("reports no data only after 25 full hours, and never for an unstarted or finished rollout", () => {
      const f = feature([safeRolloutRule("sr_1")]);
      const startedAt = (d: Date | undefined) =>
        compute(f, { safeRollouts: [runningSafeRollout({ startedAt: d })] });
      expect(startedAt(subMinutes(subHours(NOW, 24), 59))).toEqual([]);
      expect(startedAt(subHours(NOW, 25))).toEqual([
        { signal: "safe-rollout-no-data", count: 1 },
      ]);
      expect(startedAt(undefined)).toEqual([]);
      expect(
        compute(f, {
          safeRollouts: [
            runningSafeRollout({
              status: "released",
              startedAt: subHours(NOW, 72),
            }),
          ],
        }),
      ).toEqual([]);
    });

    it("flags SRM once each arm has 8 users, flags 1% multiple exposures, and ranks unhealthy above a rollback", () => {
      const f = feature([safeRolloutRule("sr_1")]);
      const withAnalysis = (summary: ReturnType<typeof analysisSummary>) =>
        compute(f, {
          safeRollouts: [runningSafeRollout({ analysisSummary: summary })],
        });
      expect(
        withAnalysis(analysisSummary({ totalUsers: 15, srm: 0.0001 })),
      ).toEqual([]);
      expect(
        withAnalysis(analysisSummary({ totalUsers: 16, srm: 0.0001 })),
      ).toEqual([{ signal: "safe-rollout-unhealthy", count: 1 }]);
      expect(
        withAnalysis(analysisSummary({ totalUsers: 16, srm: 0.001 })),
      ).toEqual([]);
      expect(
        withAnalysis(
          analysisSummary({ totalUsers: 100, srm: 0.5, multipleExposures: 1 }),
        ),
      ).toEqual([{ signal: "safe-rollout-unhealthy", count: 1 }]);
      expect(
        withAnalysis(analysisSummary({ totalUsers: 16, srm: 0.0001 }, "lost")),
      ).toEqual([{ signal: "safe-rollout-unhealthy", count: 1 }]);
    });

    it("asks for a rollback on a losing guardrail but stays quiet on a safe or errored one", () => {
      const f = feature([safeRolloutRule("sr_1")]);
      const guardrail = (status: "lost" | "safe" | "errored") =>
        compute(f, {
          safeRollouts: [
            runningSafeRollout({
              analysisSummary: analysisSummary(
                { totalUsers: 100, srm: 0.5 },
                status,
              ),
            }),
          ],
        });
      expect(guardrail("lost")).toEqual([
        { signal: "safe-rollout-rollback-now", count: 1 },
      ]);
      expect(guardrail("safe")).toEqual([]);
      expect(guardrail("errored")).toEqual([]);
    });

    it("surfaces a ramp approval only once the step's time hold has elapsed", () => {
      const ramps = (schedule: RampScheduleInterface) =>
        compute(feature([]), { rampSchedules: [schedule] });
      const needsApproval = [{ signal: "ramp-needs-approval", count: 1 }];

      expect(ramps(approvalRamp({ nextStepAt: addHours(NOW, 1) }))).toEqual([]);
      expect(ramps(approvalRamp({ nextStepAt: NOW }))).toEqual(needsApproval);
      expect(ramps(approvalRamp({ stepApproval: { stepIndex: 1 } }))).toEqual(
        [],
      );
      expect(ramps(approvalRamp({ status: "ready" }))).toEqual([]);

      const monitored = (currentStepEnteredAt: Date) =>
        approvalRamp({
          steps: [
            {},
            {
              interval: 3600,
              monitored: true,
              holdConditions: { requiresApproval: true },
            },
          ],
          nextStepAt: null,
          currentStepEnteredAt,
        });
      expect(ramps(monitored(subMinutes(NOW, 30)))).toEqual([]);
      expect(ramps(monitored(subHours(NOW, 1)))).toEqual(needsApproval);
    });

    it("ignores a ramp-monitored safe rollout once its ramp has ended", () => {
      const monitor = runningSafeRollout({
        id: "sr_ramp",
        rampScheduleId: "ramp_done",
      });
      for (const status of ["completed", "rolled-back"]) {
        const ramp = {
          id: "ramp_done",
          name: "Ramp",
          status,
          steps: [],
        } as unknown as RampScheduleInterface;
        expect(
          compute(feature([]), {
            safeRollouts: [monitor],
            rampSchedules: [ramp],
          }),
        ).toEqual([]);
      }
    });
  });
});

describe("getTempRolloutStaleReason", () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  const endedAt = (date: Date | string | undefined) => ({
    phases: [{ dateEnded: date }],
  });

  it("turns old after more than 30 full days", () => {
    expect(getTempRolloutStaleReason(endedAt(subDays(NOW, 30)), NOW)).toBe(
      "temp-rollout",
    );
    expect(
      getTempRolloutStaleReason(endedAt(subHours(subDays(NOW, 30), 23)), NOW),
    ).toBe("temp-rollout");
    expect(getTempRolloutStaleReason(endedAt(subDays(NOW, 31)), NOW)).toBe(
      "old-temp-rollout",
    );
  });

  it("treats a missing or unparsable end date as just ended", () => {
    expect(getTempRolloutStaleReason(endedAt(undefined), NOW)).toBe(
      "temp-rollout",
    );
    expect(getTempRolloutStaleReason(endedAt("not a date"), NOW)).toBe(
      "temp-rollout",
    );
    expect(getTempRolloutStaleReason({ phases: [] }, NOW)).toBe("temp-rollout");
  });
});

describe("isFeatureStale windows and rule kinds", () => {
  beforeEach(() => jest.useFakeTimers({ now: NOW }));
  afterEach(() => jest.useRealTimers());

  function stale(
    f: FeatureInterface,
    extra: Partial<Parameters<typeof isFeatureStale>[0]> = {},
  ) {
    return isFeatureStale({
      feature: f,
      features: [f],
      environments: ["prod"],
      ...extra,
    });
  }

  // Three weeks untouched, one enabled environment.
  const settled = (
    rules: Partial<FeatureRule>[],
    overrides: Partial<FeatureInterface> = {},
  ) =>
    feature(rules, {
      environmentSettings: { prod: { enabled: true } },
      dateUpdated: subWeeks(NOW, 3),
      ...overrides,
    });

  it("counts a flag as old only once it is strictly more than two weeks untouched", () => {
    const twoWeeksAgo = subWeeks(NOW, 2);
    expect(stale(settled([], { dateUpdated: twoWeeksAgo }))).toMatchObject({
      stale: false,
      reason: "recently-updated",
    });
    expect(
      stale(settled([], { dateUpdated: new Date(twoWeeksAgo.getTime() - 1) })),
    ).toMatchObject({ stale: true, reason: "no-rules" });
    // No dateUpdated reads as updated right now, so the flag can never age.
    expect(stale(settled([], { dateUpdated: undefined }))).toMatchObject({
      stale: false,
      reason: "recently-updated",
    });
  });

  it("keeps a draft active for exactly one calendar month, then calls it abandoned", () => {
    const monthAgo = subMonths(NOW, 1);
    const f = settled([]);
    expect(stale(f, { mostRecentDraftDate: monthAgo })).toMatchObject({
      stale: false,
      reason: "active-draft",
    });
    expect(
      stale(f, { mostRecentDraftDate: new Date(monthAgo.getTime() - 1) }),
    ).toMatchObject({ stale: true, reason: "abandoned-draft" });
    expect(stale(f, { mostRecentDraftDate: null })).toMatchObject({
      stale: true,
      reason: "no-rules",
    });
  });

  it("does not call a prerequisite-gated force rule one-sided", () => {
    const f = settled([
      {
        ...force("true"),
        prerequisites: [{ id: "parent", condition: '{"value": true}' }],
      },
    ]);
    const result = stale(f);
    expect(result.envResults.prod).toEqual({
      stale: false,
      reason: "has-rules",
    });
    expect(result.stale).toBe(false);
  });

  it("does not call an environment served by a contextual bandit one-sided", () => {
    const f = settled([
      {
        type: "contextual-bandit-ref",
        contextualBanditId: "cb_1",
        variations: [
          { variationId: "a", value: "true" },
          { variationId: "b", value: "false" },
        ],
      } as Partial<FeatureRule>,
    ]);
    expect(stale(f).envResults.prod).toEqual({
      stale: false,
      reason: "has-rules",
    });
  });

  it("does not call an environment served by a safe rollout one-sided", () => {
    const f = settled([safeRolloutRule("sr_1")]);
    expect(stale(f).envResults.prod).toEqual({
      stale: false,
      reason: "has-rules",
    });
  });
});

describe("getHealthSettings", () => {
  it("falls back to the shipped defaults", () => {
    expect(getHealthSettings(undefined, true)).toEqual({
      decisionFrameworkEnabled: false,
      experimentMinLengthDays: 3,
      srmThreshold: 0.001,
      multipleExposureMinPercent: 0.01,
    });
  });

  it("enables the decision framework only when the org opted in and the plan allows it", () => {
    const settings = {
      decisionFrameworkEnabled: true,
      srmThreshold: 0.05,
    } as OrganizationSettings;
    expect(getHealthSettings(settings, false)).toMatchObject({
      decisionFrameworkEnabled: false,
      srmThreshold: 0.05,
    });
    expect(getHealthSettings(settings, true)).toMatchObject({
      decisionFrameworkEnabled: true,
      srmThreshold: 0.05,
    });
  });
});

describe("computeFeatureHealth broken saved groups", () => {
  const groupMap: GroupMap = new Map([
    ["list", { type: "list", attributeKey: "id", values: ["u1"] }],
    ["nested", { type: "condition", condition: '{"$savedGroups":["list"]}' }],
    ["loop_a", { type: "condition", condition: '{"$savedGroups":["loop_b"]}' }],
    ["loop_b", { type: "condition", condition: '{"$savedGroups":["loop_a"]}' }],
    ["dangling", { type: "condition", condition: '{"$savedGroups":["gone"]}' }],
  ]);
  const inGroups = (match: "all" | "any" | "none", ...ids: string[]) =>
    ({
      ...force(),
      savedGroups: [{ match, ids }],
    }) as Partial<FeatureRule>;

  it("reports nothing when every referenced group resolves", () => {
    expect(
      compute(
        feature([
          inGroups("all", "list"),
          inGroups("any", "nested"),
          force("true", '{"id":{"$inGroup":"list"}}'),
        ]),
        { groupMap },
      ),
    ).toEqual([]);
  });

  it("counts each rule naming a missing, cyclic or dangling group, negated or not", () => {
    expect(
      compute(
        feature([
          inGroups("all", "gone"),
          inGroups("none", "gone"),
          inGroups("any", "loop_a"),
          inGroups("all", "dangling"),
          force("true", '{"$not":{"id":{"$inGroup":"gone"}}}'),
          {
            ...force(),
            enabled: false,
            savedGroups: [{ match: "all", ids: ["gone"] }],
          },
        ]),
        { groupMap },
      ),
    ).toEqual([{ signal: "broken-saved-group", count: 5 }]);
  });

  it("checks rule and feature prerequisite conditions", () => {
    const gate = { id: "parent", condition: '{"value":{"$inGroup":"gone"}}' };
    expect(
      compute(
        feature([{ ...force(), prerequisites: [gate] }], {
          prerequisites: [gate],
        }),
        { groupMap },
      ),
    ).toEqual([{ signal: "broken-saved-group", count: 2 }]);
  });

  it("checks the served phase of an experiment-ref rule's experiment", () => {
    const experiment = (phases: Record<string, unknown>[]) =>
      ({ id: "exp", phases }) as unknown as ExperimentInterfaceStringDates;
    const servedBroken = experiment([
      { savedGroups: [{ match: "all", ids: ["list"] }] },
      { condition: '{"id":{"$inGroup":"gone"}}' },
    ]);
    const onlyHistoryBroken = experiment([
      { savedGroups: [{ match: "all", ids: ["gone"] }] },
      { savedGroups: [{ match: "all", ids: ["list"] }] },
    ]);
    const f = feature([expRef("exp")]);
    expect(
      compute(f, {
        groupMap,
        experimentMap: new Map([["exp", servedBroken]]),
        knownExperimentIds: new Set(["exp"]),
      }),
    ).toEqual([{ signal: "broken-saved-group", count: 1 }]);
    expect(
      compute(f, {
        groupMap,
        experimentMap: new Map([["exp", onlyHistoryBroken]]),
        knownExperimentIds: new Set(["exp"]),
      }),
    ).toEqual([]);
  });

  it("skips the check without a group map", () => {
    expect(compute(feature([inGroups("all", "gone")]))).toEqual([]);
  });
});

describe("isFeatureStale walks dependents on their own facts", () => {
  const old = new Date(Date.now() - 30 * 86400000);
  const flag = (id: string, extra: Partial<FeatureInterface> = {}) =>
    ({
      id,
      valueType: "boolean",
      defaultValue: "false",
      dateUpdated: old,
      environmentSettings: { prod: { enabled: true } },
      rules: [],
      ...extra,
    }) as unknown as FeatureInterface;
  const parentGate = { id: "root", condition: '{"value": true}' };
  const runningOn = (parent: string) =>
    ({
      id: "exp",
      status: "running",
      archived: false,
      excludeFromPayload: false,
      linkedFeatures: [parent],
      phases: [
        {
          dateStarted: old.toISOString(),
          prerequisites: [{ id: parent, condition: '{"value": true}' }],
        },
      ],
    }) as unknown as ExperimentInterfaceStringDates;

  it("keeps a flag with a running dependent experiment when it also has a stale dependent flag", () => {
    const root = flag("root");
    const dependent = flag("dep", { prerequisites: [parentGate] });
    const result = isFeatureStale({
      feature: root,
      features: [root, dependent],
      environments: ["prod"],
      experiments: [runningOn("root")],
    });
    expect(result).toMatchObject({ stale: false, reason: "has-dependents" });
  });

  it("does not lend the requested flag's draft to its dependents", () => {
    const root = flag("root");
    const dependent = flag("dep", { prerequisites: [parentGate] });
    const result = isFeatureStale({
      feature: root,
      features: [root, dependent],
      environments: ["prod"],
      mostRecentDraftDate: new Date(),
    });
    expect(result.reason).toBe("active-draft");
    expect(result.envResults.prod?.reason).not.toBe("has-dependents");
  });
});
