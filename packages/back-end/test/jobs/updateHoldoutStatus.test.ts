import {
  isScheduledTransitionApplicable,
  scheduledTypeToStage,
} from "back-end/src/jobs/updateHoldoutStatus";

const PAST = new Date("2026-07-01T00:00:00.000Z");

const draft = { status: "draft" as const };
const running = { status: "running" as const };
const stopped = { status: "stopped" as const };

const holdout = (overrides: Partial<{ analysisStartDate: Date }> = {}) => ({
  analysisStartDate: undefined,
  ...overrides,
});

describe("scheduledTypeToStage", () => {
  it("maps each scheduled type to its target stage", () => {
    expect(scheduledTypeToStage("start")).toBe("running");
    expect(scheduledTypeToStage("startAnalysisPeriod")).toBe("analysis-period");
    expect(scheduledTypeToStage("stop")).toBe("stopped");
  });
});

describe("isScheduledTransitionApplicable", () => {
  it("only starts a draft holdout", () => {
    expect(isScheduledTransitionApplicable("start", draft, holdout())).toBe(
      true,
    );
    expect(isScheduledTransitionApplicable("start", running, holdout())).toBe(
      false,
    );
  });

  it("only begins analysis for a running holdout that has not begun analysis", () => {
    expect(
      isScheduledTransitionApplicable(
        "startAnalysisPeriod",
        running,
        holdout(),
      ),
    ).toBe(true);
    expect(
      isScheduledTransitionApplicable(
        "startAnalysisPeriod",
        running,
        holdout({ analysisStartDate: PAST }),
      ),
    ).toBe(false);
    expect(
      isScheduledTransitionApplicable("startAnalysisPeriod", draft, holdout()),
    ).toBe(false);
  });

  it("stops a running holdout before or during analysis", () => {
    expect(isScheduledTransitionApplicable("stop", running, holdout())).toBe(
      true,
    );
    expect(
      isScheduledTransitionApplicable(
        "stop",
        running,
        holdout({ analysisStartDate: PAST }),
      ),
    ).toBe(true);
    expect(isScheduledTransitionApplicable("stop", draft, holdout())).toBe(
      false,
    );
    expect(isScheduledTransitionApplicable("stop", stopped, holdout())).toBe(
      false,
    );
  });
});
