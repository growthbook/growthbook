import type {
  RampScheduleInterface,
  SafeRolloutInterface,
} from "shared/validators";
import { syncLinkedSafeRolloutForRampState } from "back-end/src/services/rampSchedule";

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
});
