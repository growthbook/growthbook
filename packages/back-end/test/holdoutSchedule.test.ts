import { normalizeHoldoutScheduleUpdates } from "back-end/src/services/holdouts";

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
          now: NOW,
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
          now: NOW,
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
        now: NOW,
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
        now: NOW,
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
        now: NOW,
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
        now: NOW,
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
        now: NOW,
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
        now: NOW,
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
        now: NOW,
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
        now: NOW,
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
        now: NOW,
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
        now: NOW,
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
        now: NOW,
      });
      expect(result.nextScheduledStatusUpdate).toBeNull();
    });
  });
});
