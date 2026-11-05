import { isStoppedExperimentResultsLocked } from "shared/experiments";

describe("isStoppedExperimentResultsLocked", () => {
  const now = new Date("2026-01-10T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);
  const stopped = (dateEnded?: string | Date) => ({
    status: "stopped",
    phases: [{ dateEnded: hoursAgo(1000) }, { dateEnded }],
  });
  const on = { disableResultsRefreshForStoppedExperiments: true };

  it("is never locked when the setting is off", () => {
    expect(
      isStoppedExperimentResultsLocked(stopped(hoursAgo(48)), {}, now),
    ).toBe(false);
    expect(
      isStoppedExperimentResultsLocked(
        stopped(hoursAgo(48)),
        { disableResultsRefreshForStoppedExperiments: false },
        now,
      ),
    ).toBe(false);
  });

  it("only locks stopped experiments", () => {
    expect(
      isStoppedExperimentResultsLocked(
        { status: "running", phases: [{ dateEnded: hoursAgo(48) }] },
        on,
        now,
      ),
    ).toBe(false);
    expect(
      isStoppedExperimentResultsLocked(stopped(hoursAgo(48)), on, now),
    ).toBe(true);
  });

  it("locks immediately when the grace period is unset or 0", () => {
    expect(
      isStoppedExperimentResultsLocked(stopped(hoursAgo(0)), on, now),
    ).toBe(true);
    expect(
      isStoppedExperimentResultsLocked(
        stopped(hoursAgo(0)),
        { ...on, stoppedExperimentResultsLockGraceHours: 0 },
        now,
      ),
    ).toBe(true);
  });

  it("stays unlocked inside the grace window and locks after it", () => {
    const settings = { ...on, stoppedExperimentResultsLockGraceHours: 24 };
    expect(
      isStoppedExperimentResultsLocked(stopped(hoursAgo(23.5)), settings, now),
    ).toBe(false);
    expect(
      isStoppedExperimentResultsLocked(stopped(hoursAgo(24)), settings, now),
    ).toBe(true);
    expect(
      isStoppedExperimentResultsLocked(stopped(hoursAgo(500)), settings, now),
    ).toBe(true);
  });

  it("uses the last phase's end date, accepting ISO strings", () => {
    const settings = { ...on, stoppedExperimentResultsLockGraceHours: 24 };
    expect(
      isStoppedExperimentResultsLocked(
        stopped(hoursAgo(1).toISOString()),
        settings,
        now,
      ),
    ).toBe(false);
  });

  it("is not locked without a stop date", () => {
    expect(isStoppedExperimentResultsLocked(stopped(undefined), on, now)).toBe(
      false,
    );
    expect(
      isStoppedExperimentResultsLocked({ status: "stopped" }, on, now),
    ).toBe(false);
  });
});
