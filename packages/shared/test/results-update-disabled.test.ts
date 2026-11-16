import { isExperimentResultsUpdateDisabled } from "shared/experiments";

describe("isExperimentResultsUpdateDisabled", () => {
  const now = new Date("2026-01-10T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);
  const stopped = (dateEnded?: string | Date) => ({
    status: "stopped",
    phases: [{ dateEnded: hoursAgo(1000) }, { dateEnded }],
  });
  const on = { disableResultsUpdateForStoppedExperiments: true };
  const grace = (hours: number) => ({
    ...on,
    disableResultsUpdateForStoppedExperimentGraceHours: hours,
  });
  const last = 1;

  it("is never disabled when the setting is off", () => {
    expect(
      isExperimentResultsUpdateDisabled(stopped(hoursAgo(48)), last, {}, now),
    ).toBe(false);
    expect(
      isExperimentResultsUpdateDisabled(
        stopped(hoursAgo(48)),
        last,
        { disableResultsUpdateForStoppedExperiments: false },
        now,
      ),
    ).toBe(false);
  });

  it("only disables the last phase once the experiment is stopped", () => {
    expect(
      isExperimentResultsUpdateDisabled(
        { status: "running", phases: [{ dateEnded: hoursAgo(48) }] },
        0,
        on,
        now,
      ),
    ).toBe(false);
    expect(
      isExperimentResultsUpdateDisabled(stopped(hoursAgo(48)), last, on, now),
    ).toBe(true);
  });

  it("disables immediately when the grace period is unset or 0", () => {
    expect(
      isExperimentResultsUpdateDisabled(stopped(hoursAgo(0)), last, on, now),
    ).toBe(true);
    expect(
      isExperimentResultsUpdateDisabled(
        stopped(hoursAgo(0)),
        last,
        grace(0),
        now,
      ),
    ).toBe(true);
  });

  it("stays enabled inside the grace window and disables after it", () => {
    const settings = grace(24);
    expect(
      isExperimentResultsUpdateDisabled(
        stopped(hoursAgo(23.5)),
        last,
        settings,
        now,
      ),
    ).toBe(false);
    expect(
      isExperimentResultsUpdateDisabled(
        stopped(hoursAgo(24)),
        last,
        settings,
        now,
      ),
    ).toBe(true);
    expect(
      isExperimentResultsUpdateDisabled(
        stopped(hoursAgo(500)),
        last,
        settings,
        now,
      ),
    ).toBe(true);
  });

  it("supports a fractional grace period", () => {
    const settings = grace(1.5);
    expect(
      isExperimentResultsUpdateDisabled(
        stopped(hoursAgo(1.25)),
        last,
        settings,
        now,
      ),
    ).toBe(false);
    expect(
      isExperimentResultsUpdateDisabled(
        stopped(hoursAgo(1.5)),
        last,
        settings,
        now,
      ),
    ).toBe(true);
  });

  it("accepts ISO strings for the end date", () => {
    expect(
      isExperimentResultsUpdateDisabled(
        stopped(hoursAgo(1).toISOString()),
        last,
        grace(24),
        now,
      ),
    ).toBe(false);
  });

  it("is not disabled without a stop date", () => {
    expect(
      isExperimentResultsUpdateDisabled(stopped(undefined), last, on, now),
    ).toBe(false);
    expect(
      isExperimentResultsUpdateDisabled({ status: "stopped" }, last, on, now),
    ).toBe(false);
  });

  describe("earlier phases of a running experiment", () => {
    const running = (earlierEnded: Date, lastEnded?: Date) => ({
      status: "running",
      phases: [{ dateEnded: earlierEnded }, { dateEnded: lastEnded }],
    });

    it("locks an ended earlier phase but not the open last phase", () => {
      const exp = running(hoursAgo(1000));
      expect(isExperimentResultsUpdateDisabled(exp, 0, on, now)).toBe(true);
      expect(isExperimentResultsUpdateDisabled(exp, 1, on, now)).toBe(false);
    });

    it("measures grace from that phase's own end date", () => {
      const settings = grace(24);
      expect(
        isExperimentResultsUpdateDisabled(
          running(hoursAgo(23.5)),
          0,
          settings,
          now,
        ),
      ).toBe(false);
      expect(
        isExperimentResultsUpdateDisabled(
          running(hoursAgo(24)),
          0,
          settings,
          now,
        ),
      ).toBe(true);
    });

    it("does not lock a last phase that carries a past end date", () => {
      expect(
        isExperimentResultsUpdateDisabled(
          running(hoursAgo(1000), hoursAgo(1000)),
          1,
          on,
          now,
        ),
      ).toBe(false);
    });
  });

  it("locks a stopped experiment's earlier phase by its own end date", () => {
    const exp = {
      status: "stopped",
      phases: [{ dateEnded: hoursAgo(100) }, { dateEnded: hoursAgo(1) }],
    };
    const settings = grace(24);
    expect(isExperimentResultsUpdateDisabled(exp, 0, settings, now)).toBe(true);
    expect(isExperimentResultsUpdateDisabled(exp, 1, settings, now)).toBe(
      false,
    );
  });

  describe("holdouts", () => {
    const holdout = (status: string, lastEnded?: Date) => ({
      status,
      type: "holdout",
      phases: [{ dateEnded: hoursAgo(1000) }, { dateEnded: lastEnded }],
    });

    it("never locks a running holdout, even with an ended phase 0", () => {
      const exp = holdout("running");
      expect(isExperimentResultsUpdateDisabled(exp, 0, on, now)).toBe(false);
      expect(isExperimentResultsUpdateDisabled(exp, 1, on, now)).toBe(false);
    });

    it("locks every phase together, anchored on the last phase's end", () => {
      const settings = grace(24);
      const inGrace = holdout("stopped", hoursAgo(1));
      expect(isExperimentResultsUpdateDisabled(inGrace, 0, settings, now)).toBe(
        false,
      );
      expect(isExperimentResultsUpdateDisabled(inGrace, 1, settings, now)).toBe(
        false,
      );
      const pastGrace = holdout("stopped", hoursAgo(48));
      expect(
        isExperimentResultsUpdateDisabled(pastGrace, 0, settings, now),
      ).toBe(true);
      expect(
        isExperimentResultsUpdateDisabled(pastGrace, 1, settings, now),
      ).toBe(true);
    });
  });

  it("is not disabled for an out-of-range phase index", () => {
    expect(
      isExperimentResultsUpdateDisabled(stopped(hoursAgo(48)), 5, on, now),
    ).toBe(false);
    expect(
      isExperimentResultsUpdateDisabled(stopped(hoursAgo(48)), -1, on, now),
    ).toBe(false);
  });
});
