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
        trigger: { type: "interval", seconds: 3600 },
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
});
