import type { ExperimentInterface } from "shared/types/experiment";
import type { HoldoutInterface, ApiUpdateHoldoutBody } from "shared/validators";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import { CasConflictError } from "back-end/src/models/BaseModel";
import { logger } from "back-end/src/util/logger";
import type { ReqContext } from "back-end/types/request";
import {
  getNextScheduledStatusUpdateForStage,
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

describe("rollbackExperimentAfterHoldoutFailure guard", () => {
  const mockUpdateExperiment = updateExperiment as jest.Mock;

  const makeExperiment = (
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

  const makeHoldout = (
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
    it("guards the rollback on the fields the update wrote, not dateUpdated", async () => {
      const experiment = makeExperiment();
      mockUpdateExperiment
        .mockResolvedValueOnce(makeExperiment({ name: "New" }))
        .mockResolvedValueOnce(makeExperiment({ name: "Old" }));
      const holdoutUpdate = jest
        .fn()
        .mockRejectedValue(new Error("holdout down"));

      await expect(
        updateHoldoutWithExperiment(makeContext(holdoutUpdate), {
          holdout: makeHoldout(),
          experiment,
          body: { name: "New" } as ApiUpdateHoldoutBody,
        }),
      ).rejects.toThrow("holdout down");

      expect(mockUpdateExperiment).toHaveBeenCalledTimes(2);
      const rollbackCall = mockUpdateExperiment.mock.calls[1][0];
      expect(rollbackCall.guard).toEqual({ name: "New" });
      expect(rollbackCall.changes).toEqual({ name: "Old" });
    });

    it("skips the rollback and warns when a written field changed concurrently", async () => {
      mockUpdateExperiment
        .mockResolvedValueOnce(makeExperiment({ name: "New" }))
        .mockRejectedValueOnce(new CasConflictError());
      const holdoutUpdate = jest
        .fn()
        .mockRejectedValue(new Error("holdout down"));
      const warn = jest.spyOn(logger, "warn").mockImplementation();

      await expect(
        updateHoldoutWithExperiment(makeContext(holdoutUpdate), {
          holdout: makeHoldout(),
          experiment: makeExperiment(),
          body: { name: "New" } as ApiUpdateHoldoutBody,
        }),
      ).rejects.toThrow("holdout down");

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("may need reconciling");
    });
  });

  describe("lifecycle transitions", () => {
    it("guards the rollback on the status and phases it wrote", async () => {
      const experiment = makeExperiment({ status: "running" });
      mockUpdateExperiment
        .mockResolvedValueOnce(makeExperiment({ status: "stopped" }))
        .mockResolvedValueOnce(makeExperiment({ status: "running" }));
      const holdoutUpdate = jest
        .fn()
        .mockRejectedValue(new Error("holdout down"));

      await expect(
        setHoldoutStage(makeContext(holdoutUpdate), {
          holdout: makeHoldout(),
          experiment,
          stage: "stopped",
        }),
      ).rejects.toThrow("holdout down");

      expect(mockUpdateExperiment).toHaveBeenCalledTimes(2);
      const forwardChanges = mockUpdateExperiment.mock.calls[0][0].changes;
      const rollbackCall = mockUpdateExperiment.mock.calls[1][0];
      // The guard is exactly the changeset the forward write applied.
      expect(rollbackCall.guard).toBe(forwardChanges);
      expect(rollbackCall.guard.status).toBe("stopped");
      expect(rollbackCall.changes.status).toBe("running");
    });
  });
});
