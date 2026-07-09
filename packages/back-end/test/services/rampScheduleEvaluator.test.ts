import { RampScheduleInterface, SafeRolloutInterface } from "shared/validators";
import {
  evaluateCurrentStep,
  evaluateRampScheduleAfterSafeRolloutSnapshot,
} from "back-end/src/services/rampScheduleEvaluator";
import { createSafeRolloutSnapshot } from "back-end/src/services/safeRolloutSnapshots";

jest.mock("back-end/src/services/safeRolloutSnapshots", () => ({
  createSafeRolloutSnapshot: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
}));

jest.mock("back-end/src/models/EventModel", () => ({
  createEvent: jest.fn(),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockCreateSafeRolloutSnapshot =
  createSafeRolloutSnapshot as jest.MockedFunction<
    typeof createSafeRolloutSnapshot
  >;

function makeSchedule(
  overrides: Partial<RampScheduleInterface> = {},
): RampScheduleInterface {
  const enteredAt = new Date("2026-01-01T00:00:00Z");
  return {
    id: "rs_1",
    organization: "org_1",
    dateCreated: new Date("2025-12-01T00:00:00Z"),
    dateUpdated: new Date("2025-12-01T00:00:00Z"),
    name: "Ramp",
    entityType: "feature",
    entityId: "feat_1",
    targets: [],
    steps: [
      {
        interval: 3600,
        monitored: true,
        actions: [],
      },
    ],
    status: "running",
    currentStepIndex: 0,
    startedAt: enteredAt,
    phaseStartedAt: enteredAt,
    currentStepEnteredAt: enteredAt,
    monitoringStartDate: enteredAt,
    nextStepAt: null,
    nextProcessAt: null,
    safeRolloutId: "sr_1",
    monitoringConfig: {
      datasourceId: "ds_1",
      exposureQueryId: "exposure_1",
      guardrailMetricIds: [],
      signalMetricIds: [],
      monitoringMode: "auto",
      autoUpdate: true,
    },
    ...overrides,
  } as RampScheduleInterface;
}

function makeSafeRollout(snapshotId: string): SafeRolloutInterface {
  return {
    id: "sr_1",
    organization: "org_1",
    dateCreated: new Date("2025-12-01T00:00:00Z"),
    dateUpdated: new Date("2025-12-01T00:00:00Z"),
    featureId: "feat_1",
    datasourceId: "ds_1",
    exposureQueryId: "exposure_1",
    guardrailMetricIds: [],
    maxDuration: { amount: 90, unit: "days" },
    autoRollback: false,
    autoSnapshots: true,
    status: "running",
    startedAt: new Date("2026-01-01T00:00:00Z"),
    rampScheduleId: "rs_1",
    trackingKey: "ramp_rs_1",
    rampUpSchedule: {
      enabled: false,
      step: 0,
      steps: [],
      rampUpCompleted: false,
    },
    analysisSummary: {
      snapshotId,
      health: {
        srm: 0.5,
        multipleExposures: 0,
        totalUsers: 100,
      },
      resultsStatus: {
        variations: [
          {
            variationId: "1",
            goalMetrics: {},
            guardrailMetrics: {},
          },
        ],
      },
    },
  } as SafeRolloutInterface;
}

function makeContext({
  safeRollout,
  snapshotDate,
  schedule,
}: {
  safeRollout: SafeRolloutInterface;
  snapshotDate: Date;
  schedule?: RampScheduleInterface;
}) {
  return {
    org: { id: "org_1", settings: {} },
    models: {
      rampSchedules: {
        getById: jest.fn().mockResolvedValue(schedule ?? null),
        updateById: jest
          .fn()
          .mockImplementation(
            (_id: string, updates: Partial<RampScheduleInterface>) => ({
              ...(schedule ?? {}),
              ...updates,
            }),
          ),
      },
      safeRollout: {
        getById: jest.fn().mockResolvedValue(safeRollout),
        update: jest.fn(),
      },
      safeRolloutSnapshots: {
        getById: jest.fn().mockResolvedValue({
          id: safeRollout.analysisSummary?.snapshotId,
          status: "success",
          dateCreated: snapshotDate,
        }),
      },
      metricGroups: {
        getAll: jest.fn().mockResolvedValue([]),
      },
    },
  };
}

describe("evaluateCurrentStep: 0-step simple schedules", () => {
  it("holds when a 0-step schedule has a future cutoffDate", async () => {
    const schedule = makeSchedule({
      steps: [],
      currentStepIndex: -1,
      cutoffDate: new Date("2026-01-05T00:00:00Z"),
    });
    const context = makeContext({
      safeRollout: makeSafeRollout("sr_unused"),
      snapshotDate: new Date("2026-01-01T00:00:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-01T01:00:00Z"),
    );

    expect(decision).toEqual({
      action: "hold",
      reason: "Waiting for scheduled end date",
      nextProcessAt: new Date("2026-01-05T00:00:00Z"),
    });
  });

  it("advances when a 0-step schedule has a past cutoffDate", async () => {
    const schedule = makeSchedule({
      steps: [],
      currentStepIndex: -1,
      cutoffDate: new Date("2025-12-31T00:00:00Z"),
    });
    const context = makeContext({
      safeRollout: makeSafeRollout("sr_unused"),
      snapshotDate: new Date("2026-01-01T00:00:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-01T01:00:00Z"),
    );

    expect(decision).toEqual({ action: "advance" });
  });

  it("advances when a 0-step schedule has no cutoffDate", async () => {
    const schedule = makeSchedule({
      steps: [],
      currentStepIndex: -1,
      cutoffDate: undefined,
    });
    const context = makeContext({
      safeRollout: makeSafeRollout("sr_unused"),
      snapshotDate: new Date("2026-01-01T00:00:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-01T01:00:00Z"),
    );

    expect(decision).toEqual({ action: "advance" });
  });

  it("still advances a multi-step ramp from step -1 even with a future cutoffDate", async () => {
    const schedule = makeSchedule({
      steps: [{ interval: 3600, monitored: false, actions: [] }],
      currentStepIndex: -1,
      cutoffDate: new Date("2026-01-05T00:00:00Z"),
    });
    const context = makeContext({
      safeRollout: makeSafeRollout("sr_unused"),
      snapshotDate: new Date("2026-01-01T00:00:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-01T01:00:00Z"),
    );

    expect(decision).toEqual({ action: "advance" });
  });

  it("holds a completed multi-step ramp waiting for a future cutoffDate", async () => {
    const schedule = makeSchedule({
      steps: [
        { interval: 3600, monitored: false, actions: [] },
        { interval: 3600, monitored: false, actions: [] },
      ],
      currentStepIndex: 2,
      cutoffDate: new Date("2026-01-10T00:00:00Z"),
    });
    const context = makeContext({
      safeRollout: makeSafeRollout("sr_unused"),
      snapshotDate: new Date("2026-01-01T00:00:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-05T00:00:00Z"),
    );

    expect(decision).toEqual({
      action: "hold",
      reason: "Waiting for scheduled end date",
      nextProcessAt: new Date("2026-01-10T00:00:00Z"),
    });
  });

  it("advances a completed multi-step ramp once cutoffDate has passed", async () => {
    const schedule = makeSchedule({
      steps: [
        { interval: 3600, monitored: false, actions: [] },
        { interval: 3600, monitored: false, actions: [] },
      ],
      currentStepIndex: 2,
      cutoffDate: new Date("2026-01-03T00:00:00Z"),
    });
    const context = makeContext({
      safeRollout: makeSafeRollout("sr_unused"),
      snapshotDate: new Date("2026-01-01T00:00:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-05T00:00:00Z"),
    );

    expect(decision).toEqual({ action: "advance" });
  });
});

describe("rampScheduleEvaluator monitored SafeRollout integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("holds for stale SafeRollout analysis without creating a snapshot", async () => {
    const schedule = makeSchedule();
    const safeRollout = makeSafeRollout("srsnp_stale");
    const context = makeContext({
      safeRollout,
      snapshotDate: new Date("2026-01-01T00:30:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-01T02:00:00Z"),
    );

    expect(decision).toEqual({
      action: "hold",
      reason:
        "Waiting for analysis results that cover the current monitored step",
    });
    expect(mockCreateSafeRolloutSnapshot).not.toHaveBeenCalled();
  });

  it("advances when the linked SafeRollout has fresh healthy analysis", async () => {
    const schedule = makeSchedule();
    const safeRollout = makeSafeRollout("srsnp_fresh");
    const context = makeContext({
      safeRollout,
      snapshotDate: new Date("2026-01-01T01:05:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-01T02:00:00Z"),
    );

    expect(decision).toEqual({ action: "advance" });
    expect(mockCreateSafeRolloutSnapshot).not.toHaveBeenCalled();
  });

  it("holds when SafeRollout analysis is older than the rolling analysis floor", async () => {
    const schedule = makeSchedule();
    // Floor bumped (e.g. ramp restart) after the snapshot was taken.
    const safeRollout = {
      ...makeSafeRollout("srsnp_pre_restart"),
      analysisStartedAt: new Date("2026-01-01T01:30:00Z"),
    } as SafeRolloutInterface;
    const context = makeContext({
      safeRollout,
      // Snapshot covers the step interval but predates the rolling floor.
      snapshotDate: new Date("2026-01-01T01:10:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-01T02:00:00Z"),
    );

    expect(decision).toEqual({
      action: "hold",
      reason:
        "Waiting for analysis results that cover the current monitored step",
    });
  });

  it("advances when SafeRollout analysis is newer than the rolling analysis floor", async () => {
    const schedule = makeSchedule();
    const safeRollout = {
      ...makeSafeRollout("srsnp_post_restart"),
      analysisStartedAt: new Date("2026-01-01T00:30:00Z"),
    } as SafeRolloutInterface;
    const context = makeContext({
      safeRollout,
      snapshotDate: new Date("2026-01-01T01:05:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-01T02:00:00Z"),
    );

    expect(decision).toEqual({ action: "advance" });
  });

  it("re-evaluates the linked ramp when SafeRollout snapshot completion fires", async () => {
    const schedule = makeSchedule();
    const safeRollout = makeSafeRollout("srsnp_stale");
    const context = makeContext({
      safeRollout,
      schedule,
      snapshotDate: new Date("2026-01-01T00:30:00Z"),
    });

    await evaluateRampScheduleAfterSafeRolloutSnapshot(
      context as Parameters<
        typeof evaluateRampScheduleAfterSafeRolloutSnapshot
      >[0],
      safeRollout,
      new Date("2026-01-01T02:00:00Z"),
    );

    expect(context.models.rampSchedules.getById).toHaveBeenCalledWith("rs_1");
    expect(context.models.rampSchedules.updateById).toHaveBeenCalledWith(
      "rs_1",
      {
        nextProcessAt: null,
      },
    );
    expect(mockCreateSafeRolloutSnapshot).not.toHaveBeenCalled();
  });

  it("rolls back when an expanded guardrail metric is a significant loser", async () => {
    const schedule = makeSchedule({
      monitoringConfig: {
        datasourceId: "ds_1",
        exposureQueryId: "exposure_1",
        guardrailMetricIds: ["m_guard"],
        signalMetricIds: [],
        monitoringMode: "auto",
        autoUpdate: true,
      },
    });
    const baseSafeRollout = makeSafeRollout("srsnp_guard_lost");
    const safeRollout = {
      ...baseSafeRollout,
      analysisSummary: {
        ...baseSafeRollout.analysisSummary!,
        resultsStatus: {
          variations: [
            {
              variationId: "1",
              goalMetrics: {},
              guardrailMetrics: {
                m_guard: { status: "lost" },
              },
            },
          ],
        },
      },
    } as SafeRolloutInterface;
    const context = makeContext({
      safeRollout,
      snapshotDate: new Date("2026-01-01T01:05:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-01T02:00:00Z"),
    );

    expect(decision).toEqual({
      action: "rollback",
      reason: expect.stringMatching(/Guardrail metric m_guard.*significant/i),
    });
  });

  it("ignores non-guardrail lost metrics (signal-only or unrelated)", async () => {
    const schedule = makeSchedule({
      monitoringConfig: {
        datasourceId: "ds_1",
        exposureQueryId: "exposure_1",
        guardrailMetricIds: ["m_guard"],
        signalMetricIds: [],
        monitoringMode: "auto",
        autoUpdate: true,
      },
    });
    const baseSafeRollout = makeSafeRollout("srsnp_unrelated_lost");
    const safeRollout = {
      ...baseSafeRollout,
      analysisSummary: {
        ...baseSafeRollout.analysisSummary!,
        resultsStatus: {
          variations: [
            {
              variationId: "1",
              goalMetrics: {},
              // Lost metric is not in the guardrail list — must not trigger rollback.
              guardrailMetrics: {
                m_other: { status: "lost" },
              },
            },
          ],
        },
      },
    } as SafeRolloutInterface;
    const context = makeContext({
      safeRollout,
      snapshotDate: new Date("2026-01-01T01:05:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-01T02:00:00Z"),
    );

    expect(decision).toEqual({ action: "advance" });
  });

  it("rolls back on SRM failure when srmAction=rollback", async () => {
    const schedule = makeSchedule({
      monitoringConfig: {
        datasourceId: "ds_1",
        exposureQueryId: "exposure_1",
        guardrailMetricIds: [],
        signalMetricIds: [],
        monitoringMode: "auto",
        autoUpdate: true,
        srmAction: "rollback",
      },
    });
    const baseSafeRollout = makeSafeRollout("srsnp_srm");
    const safeRollout = {
      ...baseSafeRollout,
      analysisSummary: {
        ...baseSafeRollout.analysisSummary!,
        health: {
          // p-value below the default 0.001 threshold with enough users.
          srm: 0.0001,
          multipleExposures: 0,
          totalUsers: 1000,
        },
      },
    } as SafeRolloutInterface;
    const context = makeContext({
      safeRollout,
      snapshotDate: new Date("2026-01-01T01:05:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-01T02:00:00Z"),
    );

    expect(decision).toEqual({
      action: "rollback",
      reason: expect.stringMatching(/SRM check failed/),
    });
  });

  it("holds on SRM failure when srmAction=hold (default)", async () => {
    const schedule = makeSchedule({
      monitoringConfig: {
        datasourceId: "ds_1",
        exposureQueryId: "exposure_1",
        guardrailMetricIds: [],
        signalMetricIds: [],
        monitoringMode: "auto",
        autoUpdate: true,
      },
    });
    const baseSafeRollout = makeSafeRollout("srsnp_srm_hold");
    const safeRollout = {
      ...baseSafeRollout,
      analysisSummary: {
        ...baseSafeRollout.analysisSummary!,
        health: {
          srm: 0.0001,
          multipleExposures: 0,
          totalUsers: 1000,
        },
      },
    } as SafeRolloutInterface;
    const context = makeContext({
      safeRollout,
      snapshotDate: new Date("2026-01-01T01:05:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-01T02:00:00Z"),
    );

    expect(decision).toEqual({
      action: "hold",
      reason: expect.stringMatching(/SRM check failed/),
    });
  });

  it("ignores SRM failure when srmAction=warn (advances past the gate)", async () => {
    const schedule = makeSchedule({
      monitoringConfig: {
        datasourceId: "ds_1",
        exposureQueryId: "exposure_1",
        guardrailMetricIds: [],
        signalMetricIds: [],
        monitoringMode: "auto",
        autoUpdate: true,
        srmAction: "warn",
      },
    });
    const baseSafeRollout = makeSafeRollout("srsnp_srm_warn");
    const safeRollout = {
      ...baseSafeRollout,
      analysisSummary: {
        ...baseSafeRollout.analysisSummary!,
        health: {
          srm: 0.0001,
          multipleExposures: 0,
          totalUsers: 1000,
        },
      },
    } as SafeRolloutInterface;
    const context = makeContext({
      safeRollout,
      snapshotDate: new Date("2026-01-01T01:05:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-01T02:00:00Z"),
    );

    expect(decision).toEqual({ action: "advance" });
  });

  it("rolls back on multiple-exposure failure when multipleExposureAction=rollback", async () => {
    const schedule = makeSchedule({
      monitoringConfig: {
        datasourceId: "ds_1",
        exposureQueryId: "exposure_1",
        guardrailMetricIds: [],
        signalMetricIds: [],
        monitoringMode: "auto",
        autoUpdate: true,
        multipleExposureAction: "rollback",
      },
    });
    const baseSafeRollout = makeSafeRollout("srsnp_me");
    const safeRollout = {
      ...baseSafeRollout,
      analysisSummary: {
        ...baseSafeRollout.analysisSummary!,
        health: {
          // healthy SRM
          srm: 0.5,
          // 5% multi-exposure with 100 users — well over the 1% default threshold
          multipleExposures: 5,
          totalUsers: 100,
        },
      },
    } as SafeRolloutInterface;
    const context = makeContext({
      safeRollout,
      snapshotDate: new Date("2026-01-01T01:05:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-01T02:00:00Z"),
    );

    expect(decision).toEqual({
      action: "rollback",
      reason: expect.stringMatching(/multiple exposures/),
    });
  });

  describe("no-traffic handling", () => {
    function noTrafficContext(noTrafficAction: "hold" | "rollback" | "warn") {
      const schedule = makeSchedule({
        // Start of monitoring set on step entry; default helper sets these.
        monitoringConfig: {
          datasourceId: "ds_1",
          exposureQueryId: "exposure_1",
          guardrailMetricIds: [],
          signalMetricIds: [],
          monitoringMode: "auto",
          autoUpdate: true,
          noTrafficAction,
        },
      });
      const baseSafeRollout = makeSafeRollout("srsnp_no_traffic");
      const safeRollout = {
        ...baseSafeRollout,
        analysisSummary: {
          ...baseSafeRollout.analysisSummary!,
          health: {
            srm: 0.5,
            multipleExposures: 0,
            totalUsers: 0,
          },
        },
      } as SafeRolloutInterface;
      return { schedule, safeRollout };
    }

    it("holds during the no-traffic grace period regardless of action", async () => {
      const { schedule, safeRollout } = noTrafficContext("rollback");
      const context = makeContext({
        safeRollout,
        snapshotDate: new Date("2026-01-01T01:05:00Z"),
      });

      // monitoringStartDate is 2026-01-01T00:00:00Z; "now" is +1h, well inside
      // the 24h grace window.
      const decision = await evaluateCurrentStep(
        context as Parameters<typeof evaluateCurrentStep>[0],
        schedule,
        new Date("2026-01-01T01:30:00Z"),
      );

      expect(decision).toMatchObject({
        action: "hold",
        reason: expect.stringMatching(/No traffic yet.*grace period/i),
        nextProcessAt: expect.any(Date),
      });
    });

    it("rolls back after grace period expires when noTrafficAction=rollback", async () => {
      const { schedule, safeRollout } = noTrafficContext("rollback");
      const context = makeContext({
        safeRollout,
        snapshotDate: new Date("2026-01-02T01:05:00Z"),
      });

      // 25h elapsed — past the 24h grace window.
      const decision = await evaluateCurrentStep(
        context as Parameters<typeof evaluateCurrentStep>[0],
        schedule,
        new Date("2026-01-02T01:00:00Z"),
      );

      expect(decision).toEqual({
        action: "rollback",
        reason: expect.stringMatching(/No traffic detected.*rollback/i),
      });
    });

    it("holds after grace period expires when noTrafficAction=hold", async () => {
      const { schedule, safeRollout } = noTrafficContext("hold");
      const context = makeContext({
        safeRollout,
        snapshotDate: new Date("2026-01-02T01:05:00Z"),
      });

      const decision = await evaluateCurrentStep(
        context as Parameters<typeof evaluateCurrentStep>[0],
        schedule,
        new Date("2026-01-02T01:00:00Z"),
      );

      expect(decision).toEqual({
        action: "hold",
        reason: expect.stringMatching(/No traffic detected.*hold/i),
      });
    });

    it("falls through to downstream checks after grace period when noTrafficAction=warn", async () => {
      // With healthy downstream signals, "warn" should not gate progression.
      const { schedule, safeRollout } = noTrafficContext("warn");
      const context = makeContext({
        safeRollout,
        snapshotDate: new Date("2026-01-02T01:05:00Z"),
      });

      const decision = await evaluateCurrentStep(
        context as Parameters<typeof evaluateCurrentStep>[0],
        schedule,
        new Date("2026-01-02T01:00:00Z"),
      );

      expect(decision).toEqual({ action: "advance" });
    });
  });

  it("holds when totalUsers is below the step's minSampleSize", async () => {
    const schedule = makeSchedule({
      steps: [
        {
          interval: 3600,
          monitored: true,
          actions: [],
          holdConditions: { minSampleSize: 1000 },
        },
      ],
    });
    const safeRollout = makeSafeRollout("srsnp_min_sample");
    // totalUsers default is 100; minSampleSize = 1000 → should hold.
    const context = makeContext({
      safeRollout,
      snapshotDate: new Date("2026-01-01T01:05:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-01T02:00:00Z"),
    );

    expect(decision).toEqual({
      action: "hold",
      reason: expect.stringMatching(
        /Waiting for minimum sample size.*100\/1000/,
      ),
    });
  });

  it("advances once totalUsers meets minSampleSize", async () => {
    const schedule = makeSchedule({
      steps: [
        {
          interval: 3600,
          monitored: true,
          actions: [],
          holdConditions: { minSampleSize: 50 },
        },
      ],
    });
    const safeRollout = makeSafeRollout("srsnp_min_sample_ok");
    const context = makeContext({
      safeRollout,
      snapshotDate: new Date("2026-01-01T01:05:00Z"),
    });

    const decision = await evaluateCurrentStep(
      context as Parameters<typeof evaluateCurrentStep>[0],
      schedule,
      new Date("2026-01-01T02:00:00Z"),
    );

    expect(decision).toEqual({ action: "advance" });
  });

  // -------------------------------------------------------------------------
  // Test gap 18: terminal-state no-op
  // -------------------------------------------------------------------------

  describe("evaluateRampScheduleAfterSafeRolloutSnapshot is a no-op for terminal schedules", () => {
    for (const terminalStatus of [
      "rolled-back",
      "completed",
      "paused",
    ] as const) {
      it(`does nothing when schedule.status is "${terminalStatus}"`, async () => {
        // Simulate a race where the schedule transitions to a terminal state
        // after the snapshot is created but before the evaluator runs.
        const safeRollout = makeSafeRollout("srsnp_terminal");
        // getById returns a schedule already in a terminal state.
        const terminalSchedule = makeSchedule({ status: terminalStatus });
        const context = makeContext({
          safeRollout,
          schedule: terminalSchedule,
          snapshotDate: new Date("2026-01-01T01:05:00Z"),
        });

        await evaluateRampScheduleAfterSafeRolloutSnapshot(
          context as Parameters<
            typeof evaluateRampScheduleAfterSafeRolloutSnapshot
          >[0],
          safeRollout,
          new Date("2026-01-01T02:00:00Z"),
        );

        // The evaluator must re-fetch the schedule and then bail out without
        // performing any mutation when the status is not "running".
        expect(context.models.rampSchedules.getById).toHaveBeenCalledWith(
          "rs_1",
        );
        expect(context.models.rampSchedules.updateById).not.toHaveBeenCalled();
      });
    }

    it("does nothing when the schedule has been deleted (getById returns null)", async () => {
      const safeRollout = makeSafeRollout("srsnp_deleted");
      const context = makeContext({
        safeRollout,
        // No schedule object → getById resolves to null.
        snapshotDate: new Date("2026-01-01T01:05:00Z"),
      });

      await evaluateRampScheduleAfterSafeRolloutSnapshot(
        context as Parameters<
          typeof evaluateRampScheduleAfterSafeRolloutSnapshot
        >[0],
        safeRollout,
        new Date("2026-01-01T02:00:00Z"),
      );

      expect(context.models.rampSchedules.getById).toHaveBeenCalledWith("rs_1");
      expect(context.models.rampSchedules.updateById).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Test gap 20: noTrafficAction + srmAction simultaneous firing
  // -------------------------------------------------------------------------

  describe("noTrafficAction and srmAction simultaneous firing", () => {
    // noTraffic triggers when totalUsers===0; SRM requires enough users to be
    // classified as unhealthy. They are structurally mutually exclusive in a
    // single snapshot. These tests document the priority order for each path.

    function makeScheduleWithBothActions(
      noTrafficAction: "hold" | "rollback" | "warn",
      srmAction: "hold" | "rollback" | "warn",
    ) {
      return makeSchedule({
        monitoringConfig: {
          datasourceId: "ds_1",
          exposureQueryId: "exposure_1",
          guardrailMetricIds: [],
          signalMetricIds: [],
          monitoringMode: "auto",
          autoUpdate: true,
          noTrafficAction,
          srmAction,
        },
      });
    }

    it("noTraffic rollback fires before SRM is evaluated when totalUsers=0 (past grace)", async () => {
      // SRM cannot fire with 0 users (not enough data), so noTraffic always
      // wins when traffic is absent.
      const schedule = makeScheduleWithBothActions("rollback", "rollback");
      const baseSafeRollout = makeSafeRollout("srsnp_no_users_srm");
      const safeRollout = {
        ...baseSafeRollout,
        analysisSummary: {
          ...baseSafeRollout.analysisSummary!,
          health: { totalUsers: 0, srm: 0.0001, multipleExposures: 0 },
        },
      } as SafeRolloutInterface;
      const context = makeContext({
        safeRollout,
        snapshotDate: new Date("2026-01-02T01:05:00Z"),
      });

      // 25h elapsed — past the 24h default grace period.
      const decision = await evaluateCurrentStep(
        context as Parameters<typeof evaluateCurrentStep>[0],
        schedule,
        new Date("2026-01-02T01:00:00Z"),
      );

      // noTraffic is evaluated first (before SRM), so its action wins.
      expect(decision).toEqual({
        action: "rollback",
        reason: expect.stringMatching(/No traffic detected.*rollback/i),
      });
    });

    it("SRM rollback fires independently when totalUsers>0 (no noTraffic condition)", async () => {
      // When traffic is present noTraffic is never considered; SRM can act
      // on its own.
      const schedule = makeScheduleWithBothActions("warn", "rollback");
      const baseSafeRollout = makeSafeRollout("srsnp_srm_no_notraffic");
      const safeRollout = {
        ...baseSafeRollout,
        analysisSummary: {
          ...baseSafeRollout.analysisSummary!,
          health: {
            // 1000 users → no-traffic block is skipped; SRM can evaluate.
            totalUsers: 1000,
            srm: 0.0001,
            multipleExposures: 0,
          },
        },
      } as SafeRolloutInterface;
      const context = makeContext({
        safeRollout,
        snapshotDate: new Date("2026-01-01T01:05:00Z"),
      });

      const decision = await evaluateCurrentStep(
        context as Parameters<typeof evaluateCurrentStep>[0],
        schedule,
        new Date("2026-01-01T02:00:00Z"),
      );

      expect(decision).toEqual({
        action: "rollback",
        reason: expect.stringMatching(/SRM check failed/),
      });
    });

    it("grace-period hold takes priority over SRM when totalUsers=0 and inside grace window", async () => {
      const schedule = makeScheduleWithBothActions("rollback", "rollback");
      const baseSafeRollout = makeSafeRollout("srsnp_grace_srm");
      const safeRollout = {
        ...baseSafeRollout,
        analysisSummary: {
          ...baseSafeRollout.analysisSummary!,
          health: { totalUsers: 0, srm: 0.0001, multipleExposures: 0 },
        },
      } as SafeRolloutInterface;
      const context = makeContext({
        safeRollout,
        snapshotDate: new Date("2026-01-01T01:05:00Z"),
      });

      // now is +1.5h — still inside the 24h grace window.
      const decision = await evaluateCurrentStep(
        context as Parameters<typeof evaluateCurrentStep>[0],
        schedule,
        new Date("2026-01-01T01:30:00Z"),
      );

      // Grace-period hold runs first and must block both the noTraffic rollback
      // and any downstream SRM rollback.
      expect(decision).toMatchObject({
        action: "hold",
        reason: expect.stringMatching(/No traffic yet.*grace period/i),
      });
    });
  });
});
