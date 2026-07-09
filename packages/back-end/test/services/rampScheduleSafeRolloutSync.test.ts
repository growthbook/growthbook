import type {
  RampScheduleInterface,
  SafeRolloutInterface,
} from "shared/validators";
import {
  restartSchedule,
  syncLinkedSafeRolloutForRampState,
} from "back-end/src/services/rampSchedule";

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
  publishRevision: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  createRevision: jest.fn(),
  getRevision: jest.fn(),
  discardRevision: jest.fn(),
  registerRevisionPublishedHook: jest.fn(),
}));

jest.mock("back-end/src/models/EventModel", () => ({
  createEvent: jest.fn(),
}));

jest.mock("back-end/src/services/organizations", () => ({
  getEnvironments: jest.fn().mockReturnValue([]),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("back-end/src/util/secrets", () => ({
  IS_CLOUD: false,
}));

function makeSchedule(
  overrides: Partial<RampScheduleInterface> = {},
): RampScheduleInterface {
  return {
    id: "rs_1",
    organization: "org_1",
    name: "Ramp",
    entityType: "feature",
    entityId: "feat_1",
    targets: [],
    steps: [
      {
        monitored: true,
        trigger: { type: "interval", seconds: 3600 },
        actions: [],
      },
    ],
    status: "running",
    currentStepIndex: 0,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    phaseStartedAt: new Date("2026-01-01T00:00:00Z"),
    currentStepEnteredAt: new Date("2026-01-01T00:00:00Z"),
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

function makeContext(safeRollout: SafeRolloutInterface) {
  const update = jest.fn().mockResolvedValue(safeRollout);
  return {
    ctx: {
      models: {
        safeRollout: {
          getById: jest.fn().mockResolvedValue(safeRollout),
          update,
        },
      },
    },
    update,
  };
}

describe("syncLinkedSafeRolloutForRampState", () => {
  it("does not rewrite startedAt when reactivating an already-started SafeRollout", async () => {
    const safeRollout = {
      id: "sr_1",
      status: "stopped",
      autoSnapshots: true,
      startedAt: new Date("2025-12-01T00:00:00Z"),
      nextSnapshotAttempt: new Date("2026-01-01T01:00:00Z"),
    } as SafeRolloutInterface;
    const { ctx, update } = makeContext(safeRollout);

    await syncLinkedSafeRolloutForRampState(
      ctx as Parameters<typeof syncLinkedSafeRolloutForRampState>[0],
      makeSchedule(),
    );

    expect(update).toHaveBeenCalledWith(
      safeRollout,
      expect.not.objectContaining({ startedAt: expect.any(Date) }),
    );
    expect(update).toHaveBeenCalledWith(
      safeRollout,
      expect.objectContaining({
        status: "running",
        autoSnapshots: true,
      }),
    );
  });

  it("stops the SafeRollout when the ramp transitions to a non-monitored step", async () => {
    const safeRollout = {
      id: "sr_1",
      status: "running",
      autoSnapshots: true,
      startedAt: new Date("2025-12-01T00:00:00Z"),
      nextSnapshotAttempt: new Date("2026-01-01T01:00:00Z"),
    } as SafeRolloutInterface;
    const { ctx, update } = makeContext(safeRollout);

    // currentStepIndex=1 points at a non-monitored step.
    const schedule = makeSchedule({
      currentStepIndex: 1,
      steps: [
        {
          monitored: true,
          trigger: { type: "interval", seconds: 3600 },
          actions: [],
        },
        {
          monitored: false,
          trigger: { type: "interval", seconds: 3600 },
          actions: [],
        },
      ],
    });

    await syncLinkedSafeRolloutForRampState(
      ctx as Parameters<typeof syncLinkedSafeRolloutForRampState>[0],
      schedule,
    );

    expect(update).toHaveBeenCalledWith(
      safeRollout,
      expect.objectContaining({
        status: "stopped",
        autoSnapshots: false,
      }),
    );
  });

  it("reactivates autoSnapshots when transitioning back into a monitored step", async () => {
    // SR is currently stopped (e.g., paused during a non-monitored step) and
    // we're stepping into a monitored step → should re-enable snapshots and
    // bump nextSnapshotAttempt so the agenda picks it up immediately.
    const safeRollout = {
      id: "sr_1",
      status: "stopped",
      autoSnapshots: false,
      startedAt: new Date("2025-12-01T00:00:00Z"),
    } as SafeRolloutInterface;
    const { ctx, update } = makeContext(safeRollout);

    await syncLinkedSafeRolloutForRampState(
      ctx as Parameters<typeof syncLinkedSafeRolloutForRampState>[0],
      makeSchedule(),
    );

    expect(update).toHaveBeenCalledWith(
      safeRollout,
      expect.objectContaining({
        status: "running",
        autoSnapshots: true,
        nextSnapshotAttempt: expect.any(Date),
      }),
    );
    // Already-started SR — must not rewrite startedAt.
    expect(update).toHaveBeenCalledWith(
      safeRollout,
      expect.not.objectContaining({ startedAt: expect.any(Date) }),
    );
  });

  it("respects explicit terminal status overrides (e.g. `stopped` on rollback)", async () => {
    const safeRollout = {
      id: "sr_1",
      status: "running",
      autoSnapshots: true,
      startedAt: new Date("2025-12-01T00:00:00Z"),
    } as SafeRolloutInterface;
    const { ctx, update } = makeContext(safeRollout);

    await syncLinkedSafeRolloutForRampState(
      ctx as Parameters<typeof syncLinkedSafeRolloutForRampState>[0],
      makeSchedule(),
      "rolled-back",
    );

    expect(update).toHaveBeenCalledWith(
      safeRollout,
      expect.objectContaining({
        status: "rolled-back",
        autoSnapshots: true,
      }),
    );
  });

  it("no-ops when nothing about the SafeRollout would change", async () => {
    // SR is already running with the desired autoSnapshots state and a fresh
    // nextSnapshotAttempt — sync should skip the write entirely.
    const safeRollout = {
      id: "sr_1",
      status: "running",
      autoSnapshots: true,
      startedAt: new Date("2025-12-01T00:00:00Z"),
      nextSnapshotAttempt: new Date("2026-01-01T01:00:00Z"),
    } as SafeRolloutInterface;
    const { ctx, update } = makeContext(safeRollout);

    await syncLinkedSafeRolloutForRampState(
      ctx as Parameters<typeof syncLinkedSafeRolloutForRampState>[0],
      makeSchedule(),
    );

    expect(update).not.toHaveBeenCalled();
  });
});

// `restartSchedule` keeps the existing safeRolloutId but rolls its analysis
// forward so the new run isn't gated by snapshots from the prior run. We test
// just the SafeRollout side-effects here; orchestration coverage for restart
// lives in rampSchedule.test.ts.
describe("restartSchedule SafeRollout floor reset", () => {
  function makeRestartContext(safeRollout: SafeRolloutInterface) {
    const updateSafeRollout = jest.fn().mockResolvedValue(safeRollout);
    const rampUpdateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) =>
          Promise.resolve({
            ...makeSchedule({
              currentStepIndex: -1,
              status: "ready",
              steps: [],
              targets: [],
              safeRolloutId: "sr_1",
            }),
            ...updates,
          }),
      );
    const rampGetById = jest.fn().mockResolvedValue(
      makeSchedule({
        currentStepIndex: -1,
        status: "running",
        steps: [],
        targets: [],
        safeRolloutId: "sr_1",
      }),
    );
    return {
      ctx: {
        org: { id: "org_1", settings: {} },
        auditUser: { type: "system" },
        environments: [],
        permissions: {
          canUpdateFeature: jest.fn().mockReturnValue(true),
        },
        models: {
          rampSchedules: {
            updateById: rampUpdateById,
            getById: rampGetById,
            // 0-step terminal schedules in these fixtures hit the auto-delete
            // path inside advanceUntilBlocked; stub deleteById so it's a no-op.
            deleteById: jest.fn().mockResolvedValue(undefined),
          },
          safeRollout: {
            getById: jest.fn().mockResolvedValue(safeRollout),
            update: updateSafeRollout,
          },
        },
      },
      updateSafeRollout,
    };
  }

  it("bumps analysisStartedAt, nextSnapshotAttempt, and clears pastNotifications on the linked SafeRollout", async () => {
    const before = new Date(Date.now() - 60_000);
    const safeRollout = {
      id: "sr_1",
      status: "stopped",
      autoSnapshots: false,
      startedAt: new Date("2025-12-01T00:00:00Z"),
      analysisStartedAt: before,
      nextSnapshotAttempt: before,
      pastNotifications: [
        { type: "srm", dateSent: new Date("2025-12-15T00:00:00Z") },
      ],
    } as unknown as SafeRolloutInterface;
    const { ctx, updateSafeRollout } = makeRestartContext(safeRollout);

    // A terminal schedule that's been rolled back already; restart should skip
    // the rollback path and go straight to the ready→running flow.
    const schedule = makeSchedule({
      currentStepIndex: -1,
      status: "rolled-back",
      steps: [],
      targets: [],
      safeRolloutId: "sr_1",
    });

    await restartSchedule(
      ctx as Parameters<typeof restartSchedule>[0],
      schedule,
    );

    // Floor reset call should have been made with all three fields together.
    const floorCall = updateSafeRollout.mock.calls.find(
      ([, updates]) =>
        updates &&
        Object.prototype.hasOwnProperty.call(updates, "analysisStartedAt"),
    );
    expect(floorCall).toBeDefined();
    expect(floorCall![1]).toMatchObject({
      analysisStartedAt: expect.any(Date),
      nextSnapshotAttempt: expect.any(Date),
      pastNotifications: [],
    });
    // Floor must move forward (later than the prior value).
    expect((floorCall![1].analysisStartedAt as Date).getTime()).toBeGreaterThan(
      before.getTime(),
    );
  });

  it("no-ops the floor reset when the schedule has no linked SafeRollout", async () => {
    const safeRollout = {
      id: "sr_unused",
      status: "stopped",
    } as SafeRolloutInterface;
    const { ctx, updateSafeRollout } = makeRestartContext(safeRollout);
    // Override rampSchedules.updateById to keep safeRolloutId undefined.
    (ctx.models.rampSchedules.updateById as jest.Mock).mockImplementation(
      (_id: string, updates: Partial<RampScheduleInterface>) =>
        Promise.resolve({
          ...makeSchedule({
            currentStepIndex: -1,
            status: "ready",
            steps: [],
            targets: [],
            safeRolloutId: undefined,
          }),
          ...updates,
        }),
    );
    (ctx.models.rampSchedules.getById as jest.Mock).mockResolvedValue(
      makeSchedule({
        currentStepIndex: -1,
        status: "running",
        steps: [],
        targets: [],
        safeRolloutId: undefined,
      }),
    );

    const schedule = makeSchedule({
      currentStepIndex: -1,
      status: "rolled-back",
      steps: [],
      targets: [],
      safeRolloutId: undefined,
    });

    await restartSchedule(
      ctx as Parameters<typeof restartSchedule>[0],
      schedule,
    );

    // No floor reset (no SR to update).
    const floorCall = updateSafeRollout.mock.calls.find(
      ([, updates]) =>
        updates &&
        Object.prototype.hasOwnProperty.call(updates, "analysisStartedAt"),
    );
    expect(floorCall).toBeUndefined();
  });
});
