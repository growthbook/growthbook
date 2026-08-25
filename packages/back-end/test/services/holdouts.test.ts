import type { ExperimentInterface } from "shared/types/experiment";
import type { HoldoutInterface, ApiUpdateHoldoutBody } from "shared/validators";
import { holdoutSizeToCoverage } from "shared/util";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { logger } from "back-end/src/util/logger";
import type { ReqContext } from "back-end/types/request";
import {
  getHoldoutLivePayloadChanges,
  assertValidHoldoutEnvironments,
  getNextScheduledStatusUpdateForStage,
  isHoldoutExperiment,
  normalizeHoldoutScheduleUpdates,
  setHoldoutStage,
  updateHoldoutWithExperiment,
} from "back-end/src/services/holdouts";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  updateExperiment: jest.fn(),
  createExperiment: jest.fn(),
  deleteExperimentByIdForOrganization: jest.fn(),
  getExperimentsByIds: jest.fn(),
}));

jest.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: jest.fn(),
}));

function makeExperiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    type: "holdout",
    phases: [{ coverage: 0.1 }],
    ...overrides,
  } as unknown as ExperimentInterface;
}

function makeHoldoutExperiment(
  phases: { coverage: number }[],
): ExperimentInterface & { type: "holdout" } {
  return makeExperiment({
    type: "holdout",
    phases: phases as unknown as ExperimentInterface["phases"],
  }) as ExperimentInterface & { type: "holdout" };
}

describe("isHoldoutExperiment", () => {
  it("returns true for holdout experiments", () => {
    expect(isHoldoutExperiment(makeExperiment({ type: "holdout" }))).toBe(true);
  });

  it("returns false for non-holdout experiment types", () => {
    expect(isHoldoutExperiment(makeExperiment({ type: "standard" }))).toBe(
      false,
    );
    expect(
      isHoldoutExperiment(makeExperiment({ type: "multi-armed-bandit" })),
    ).toBe(false);
  });

  it("returns false when type is missing", () => {
    expect(isHoldoutExperiment(makeExperiment({ type: undefined }))).toBe(
      false,
    );
  });
});

describe("getHoldoutLivePayloadChanges", () => {
  const experiment = makeHoldoutExperiment([{ coverage: 0.1 }]);

  it("reports a change when coverage differs from phase 0", () => {
    expect(getHoldoutLivePayloadChanges(experiment, 0.2)).toEqual({
      changesLivePayload: true,
      changedFields: ["coverage"],
    });
  });

  it("reports no change when coverage matches phase 0", () => {
    expect(getHoldoutLivePayloadChanges(experiment, 0.1)).toEqual({
      changesLivePayload: false,
      changedFields: [],
    });
  });

  it("reports no change when coverage is undefined (unchanged)", () => {
    expect(getHoldoutLivePayloadChanges(experiment, undefined)).toEqual({
      changesLivePayload: false,
      changedFields: [],
    });
  });

  it("uses phase 0 as the payload phase, ignoring later phases", () => {
    const multiPhase = makeHoldoutExperiment([
      { coverage: 0.1 },
      { coverage: 0.9 },
    ]);
    // Matches phase 0 (0.1) -> no change, even though phase 1 differs.
    expect(
      getHoldoutLivePayloadChanges(multiPhase, 0.1).changesLivePayload,
    ).toBe(false);
    // Differs from phase 0 -> change.
    expect(
      getHoldoutLivePayloadChanges(multiPhase, 0.5).changesLivePayload,
    ).toBe(true);
  });
});

const NOW = new Date("2026-07-28T12:00:00.000Z");
const PAST = new Date("2026-07-01T00:00:00.000Z");
const SOON = new Date("2026-08-01T00:00:00.000Z");
const LATER = new Date("2026-09-01T00:00:00.000Z");
const LATEST = new Date("2026-10-01T00:00:00.000Z");

const draft = { status: "draft" as const };
const running = { status: "running" as const };
const stopped = { status: "stopped" as const };

const holdout = (
  overrides: Partial<{
    statusUpdateSchedule: Parameters<
      typeof normalizeHoldoutScheduleUpdates
    >[0]["holdout"]["statusUpdateSchedule"];
    nextScheduledStatusUpdate: Parameters<
      typeof normalizeHoldoutScheduleUpdates
    >[0]["holdout"]["nextScheduledStatusUpdate"];
    analysisStartDate: Date;
  }> = {},
) => ({
  statusUpdateSchedule: null,
  nextScheduledStatusUpdate: null,
  analysisStartDate: undefined,
  ...overrides,
});

describe("normalizeHoldoutScheduleUpdates", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("clearing and absent input", () => {
    it("clears both fields when the schedule is explicitly null", () => {
      expect(
        normalizeHoldoutScheduleUpdates({
          holdout: holdout({
            statusUpdateSchedule: { startAt: SOON },
            nextScheduledStatusUpdate: { type: "start", date: SOON },
          }),
          experiment: draft,
          scheduleInput: null,
        }),
      ).toEqual({
        statusUpdateSchedule: null,
        nextScheduledStatusUpdate: null,
      });
    });

    it("preserves the stored values when no schedule is sent", () => {
      const stored = holdout({
        statusUpdateSchedule: { startAt: SOON },
        nextScheduledStatusUpdate: { type: "start", date: SOON },
      });
      expect(
        normalizeHoldoutScheduleUpdates({
          holdout: stored,
          experiment: draft,
          scheduleInput: undefined,
        }),
      ).toEqual({
        statusUpdateSchedule: { startAt: SOON },
        nextScheduledStatusUpdate: { type: "start", date: SOON },
      });
    });
  });

  describe("partial merges", () => {
    it("keeps stored dates that the request omits", () => {
      const result = normalizeHoldoutScheduleUpdates({
        holdout: holdout({
          statusUpdateSchedule: { startAt: SOON, stopAt: LATEST },
        }),
        experiment: draft,
        scheduleInput: { startAnalysisPeriodAt: LATER },
      });
      expect(result.statusUpdateSchedule).toEqual({
        startAt: SOON,
        startAnalysisPeriodAt: LATER,
        stopAt: LATEST,
      });
    });

    it("clears an individual date when it is sent as empty", () => {
      const result = normalizeHoldoutScheduleUpdates({
        holdout: holdout({
          statusUpdateSchedule: { startAt: SOON, stopAt: LATEST },
        }),
        experiment: draft,
        scheduleInput: { stopAt: "" },
      });
      expect(result.statusUpdateSchedule).toEqual({
        startAt: SOON,
        stopAt: undefined,
      });
    });

    it("coerces ISO strings to Dates", () => {
      const result = normalizeHoldoutScheduleUpdates({
        holdout: holdout(),
        experiment: draft,
        scheduleInput: { startAt: SOON.toISOString() },
      });
      expect(result.statusUpdateSchedule?.startAt).toEqual(SOON);
    });
  });

  describe("choosing the next scheduled transition", () => {
    it("picks the earliest future date", () => {
      const result = normalizeHoldoutScheduleUpdates({
        holdout: holdout(),
        experiment: draft,
        scheduleInput: {
          startAt: SOON,
          startAnalysisPeriodAt: LATER,
          stopAt: LATEST,
        },
      });
      expect(result.nextScheduledStatusUpdate).toEqual({
        type: "start",
        date: SOON,
      });
    });

    it("ignores dates in the past", () => {
      const result = normalizeHoldoutScheduleUpdates({
        holdout: holdout(),
        experiment: draft,
        scheduleInput: { startAt: PAST, stopAt: LATEST },
      });
      expect(result.nextScheduledStatusUpdate).toEqual({
        type: "stop",
        date: LATEST,
      });
    });

    it("returns null when every date is in the past", () => {
      const result = normalizeHoldoutScheduleUpdates({
        holdout: holdout(),
        experiment: draft,
        scheduleInput: { startAt: PAST },
      });
      expect(result.nextScheduledStatusUpdate).toBeNull();
    });
  });

  describe("stage eligibility", () => {
    it("ignores a start date once the holdout is running", () => {
      const result = normalizeHoldoutScheduleUpdates({
        holdout: holdout(),
        experiment: running,
        scheduleInput: { startAt: SOON, stopAt: LATEST },
      });
      expect(result.nextScheduledStatusUpdate).toEqual({
        type: "stop",
        date: LATEST,
      });
    });

    it("ignores an analysis start while the holdout is still a draft", () => {
      const result = normalizeHoldoutScheduleUpdates({
        holdout: holdout(),
        experiment: draft,
        scheduleInput: { startAnalysisPeriodAt: SOON, stopAt: LATEST },
      });
      expect(result.nextScheduledStatusUpdate).toEqual({
        type: "stop",
        date: LATEST,
      });
    });

    it("ignores an analysis start once the analysis period has begun", () => {
      const result = normalizeHoldoutScheduleUpdates({
        holdout: holdout({ analysisStartDate: PAST }),
        experiment: running,
        scheduleInput: { startAnalysisPeriodAt: SOON, stopAt: LATEST },
      });
      expect(result.nextScheduledStatusUpdate).toEqual({
        type: "stop",
        date: LATEST,
      });
    });

    it("schedules the analysis start for a running holdout that has not begun analysis", () => {
      const result = normalizeHoldoutScheduleUpdates({
        holdout: holdout(),
        experiment: running,
        scheduleInput: { startAnalysisPeriodAt: SOON, stopAt: LATEST },
      });
      expect(result.nextScheduledStatusUpdate).toEqual({
        type: "startAnalysisPeriod",
        date: SOON,
      });
    });

    it("ignores every transition once the holdout is stopped", () => {
      const result = normalizeHoldoutScheduleUpdates({
        holdout: holdout(),
        experiment: stopped,
        scheduleInput: {
          startAt: SOON,
          startAnalysisPeriodAt: LATER,
          stopAt: LATEST,
        },
      });
      expect(result.nextScheduledStatusUpdate).toBeNull();
    });
  });
});

describe("getNextScheduledStatusUpdateForStage", () => {
  it("chains to the analysis start after entering running", () => {
    expect(
      getNextScheduledStatusUpdateForStage(
        { startAnalysisPeriodAt: LATER, stopAt: LATEST },
        "running",
      ),
    ).toEqual({ type: "startAnalysisPeriod", date: LATER });
  });

  it("chains to the stop after entering the analysis period", () => {
    expect(
      getNextScheduledStatusUpdateForStage(
        { stopAt: LATEST },
        "analysis-period",
      ),
    ).toEqual({ type: "stop", date: LATEST });
  });

  it("returns null when the schedule has no matching next transition", () => {
    expect(getNextScheduledStatusUpdateForStage({}, "running")).toBeNull();
    expect(
      getNextScheduledStatusUpdateForStage({}, "analysis-period"),
    ).toBeNull();
    expect(getNextScheduledStatusUpdateForStage(null, "running")).toBeNull();
  });

  it("ends the chain for stopped and draft", () => {
    expect(
      getNextScheduledStatusUpdateForStage({ stopAt: LATEST }, "stopped"),
    ).toBeNull();
    expect(
      getNextScheduledStatusUpdateForStage({ startAt: SOON }, "draft"),
    ).toBeNull();
  });
});

describe("rollbackExperimentAfterHoldoutFailure", () => {
  const mockUpdateExperiment = updateExperiment as jest.Mock;
  const mockQueueSDKPayloadRefresh = queueSDKPayloadRefresh as jest.Mock;

  const makeRollbackExperiment = (
    overrides: Partial<ExperimentInterface> = {},
  ): ExperimentInterface =>
    ({
      id: "exp_1",
      organization: "org",
      name: "Old",
      status: "running",
      phases: [{ dateEnded: undefined }],
      dateUpdated: new Date("2026-07-28T12:00:00.000Z"),
      ...overrides,
    }) as unknown as ExperimentInterface;

  const makeRollbackHoldout = (
    overrides: Partial<HoldoutInterface> = {},
  ): HoldoutInterface =>
    ({
      id: "hld_1",
      organization: "org",
      name: "Old",
      projects: [],
      environmentSettings: {},
      statusUpdateSchedule: null,
      nextScheduledStatusUpdate: null,
      analysisStartDate: undefined,
      ...overrides,
    }) as unknown as HoldoutInterface;

  const makeContext = (holdoutUpdate: jest.Mock): ReqContext =>
    ({
      org: { id: "org", settings: {} },
      models: { holdout: { update: holdoutUpdate } },
    }) as unknown as ReqContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("metadata updates", () => {
    it("rolls the experiment back to the fields it wrote", async () => {
      const experiment = makeRollbackExperiment();
      mockUpdateExperiment
        .mockResolvedValueOnce(makeRollbackExperiment({ name: "New" }))
        .mockResolvedValueOnce(makeRollbackExperiment({ name: "Old" }));
      const holdoutUpdate = jest
        .fn()
        .mockRejectedValue(new Error("holdout down"));

      await expect(
        updateHoldoutWithExperiment(makeContext(holdoutUpdate), {
          holdout: makeRollbackHoldout(),
          experiment,
          body: { name: "New" } as ApiUpdateHoldoutBody,
        }),
      ).rejects.toThrow("holdout down");

      expect(mockUpdateExperiment).toHaveBeenCalledTimes(2);
      const rollbackCall = mockUpdateExperiment.mock.calls[1][0];
      expect(rollbackCall.guard).toBeUndefined();
      expect(rollbackCall.changes).toEqual({ name: "Old" });
    });

    it("logs for manual reconciliation when the rollback write fails", async () => {
      mockUpdateExperiment
        .mockResolvedValueOnce(makeRollbackExperiment({ name: "New" }))
        .mockRejectedValueOnce(new Error("revert down"));
      const holdoutUpdate = jest
        .fn()
        .mockRejectedValue(new Error("holdout down"));
      const error = jest.spyOn(logger, "error").mockImplementation();

      await expect(
        updateHoldoutWithExperiment(makeContext(holdoutUpdate), {
          holdout: makeRollbackHoldout(),
          experiment: makeRollbackExperiment(),
          body: { name: "New" } as ApiUpdateHoldoutBody,
        }),
      ).rejects.toThrow("holdout down");

      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][1]).toContain("need reconciling by hand");
    });
  });

  describe("targeting updates", () => {
    it("mirrors targeting changes across every phase", async () => {
      const experiment = makeExperiment({
        phases: [
          {
            name: "Holdout",
            condition: "{}",
            savedGroups: [],
            coverage: 0.5,
          },
          {
            name: "Analysis",
            condition: "{}",
            savedGroups: [],
            coverage: 0.5,
          },
        ] as unknown as ExperimentInterface["phases"],
      });
      mockUpdateExperiment.mockResolvedValueOnce(experiment);
      const holdoutUpdate = jest.fn();

      const savedGroupTargeting = [{ match: "all" as const, ids: ["grp_1"] }];
      await updateHoldoutWithExperiment(makeContext(holdoutUpdate), {
        holdout: makeRollbackHoldout(),
        experiment,
        body: {
          targetingCondition: '{"country":"US"}',
          savedGroupTargeting,
          holdoutSize: 0.2,
        } as ApiUpdateHoldoutBody,
      });

      expect(mockUpdateExperiment).toHaveBeenCalledTimes(1);
      const { changes } = mockUpdateExperiment.mock.calls[0][0];
      const expectedCoverage = holdoutSizeToCoverage(0.2);
      expect(changes.phases).toHaveLength(2);
      for (const phase of changes.phases) {
        expect(phase.condition).toBe('{"country":"US"}');
        expect(phase.savedGroups).toEqual(savedGroupTargeting);
        expect(phase.coverage).toBe(expectedCoverage);
      }
      // Non-targeting fields are preserved.
      expect(changes.phases[0].name).toBe("Holdout");
      expect(changes.phases[1].name).toBe("Analysis");
    });
  });

  describe("lifecycle transitions", () => {
    it("rolls back to the status and phases it wrote", async () => {
      const experiment = makeRollbackExperiment({ status: "running" });
      mockUpdateExperiment
        .mockResolvedValueOnce(makeRollbackExperiment({ status: "stopped" }))
        .mockResolvedValueOnce(makeRollbackExperiment({ status: "running" }));
      const holdoutUpdate = jest
        .fn()
        .mockRejectedValue(new Error("holdout down"));

      await expect(
        setHoldoutStage(makeContext(holdoutUpdate), {
          holdout: makeRollbackHoldout(),
          experiment,
          stage: "stopped",
        }),
      ).rejects.toThrow("holdout down");

      expect(mockUpdateExperiment).toHaveBeenCalledTimes(2);
      const rollbackCall = mockUpdateExperiment.mock.calls[1][0];
      expect(rollbackCall.guard).toBeUndefined();
      expect(rollbackCall.changes.status).toBe("running");
    });

    it("never queues the forward refresh when the holdout write is rolled back", async () => {
      const experiment = makeExperiment({ status: "running" });
      mockUpdateExperiment
        .mockResolvedValueOnce(makeExperiment({ status: "stopped" }))
        .mockResolvedValueOnce(makeExperiment({ status: "running" }));
      const holdoutUpdate = jest
        .fn()
        .mockRejectedValue(new Error("holdout down"));

      await expect(
        setHoldoutStage(makeContext(holdoutUpdate), {
          holdout: makeRollbackHoldout(),
          experiment,
          stage: "stopped",
        }),
      ).rejects.toThrow("holdout down");

      const events = mockQueueSDKPayloadRefresh.mock.calls.map(
        ([arg]) => arg.auditContext.event,
      );
      // Only the reverted-state refresh runs, not the forward one.
      expect(events).toEqual(["Reverted: Status changed to stopped"]);
    });
  });
});

describe("assertValidHoldoutEnvironments", () => {
  const context = {
    org: {
      id: "org",
      settings: {
        environments: [{ id: "production" }, { id: "staging" }],
      },
    },
  } as unknown as ReqContext;

  it("passes when every id exists in the org", () => {
    expect(() =>
      assertValidHoldoutEnvironments(context, {
        production: { enabled: true },
        staging: { enabled: false },
      }),
    ).not.toThrow();
  });

  it("throws when an id does not exist in the org", () => {
    expect(() =>
      assertValidHoldoutEnvironments(context, {
        production: { enabled: true },
        made_up: { enabled: true },
      }),
    ).toThrow(/Invalid environment: made_up/);
  });

  it("is a no-op for undefined or null", () => {
    expect(() =>
      assertValidHoldoutEnvironments(context, undefined),
    ).not.toThrow();
    expect(() => assertValidHoldoutEnvironments(context, null)).not.toThrow();
  });

  it("tolerates ids already stored on the holdout", () => {
    expect(() =>
      assertValidHoldoutEnvironments(
        context,
        { deleted: { enabled: false } },
        { deleted: { enabled: true } },
      ),
    ).not.toThrow();
  });

  it("still rejects newly introduced ids on update", () => {
    expect(() =>
      assertValidHoldoutEnvironments(
        context,
        { deleted: { enabled: false }, made_up: { enabled: true } },
        { deleted: { enabled: true } },
      ),
    ).toThrow(/Invalid environment: made_up/);
  });
});
