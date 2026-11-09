import { isExperimentResultsUpdateDisabled } from "shared/experiments";

describe("isExperimentResultsUpdateDisabled", () => {
  const now = new Date("2026-01-10T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);
  const stopped = (dateEnded?: string | Date) => ({
    status: "stopped",
    phases: [{ dateEnded: hoursAgo(1000) }, { dateEnded }],
  });
  const on = { disableResultsUpdateForStoppedExperiments: true };

  it("is never disabled when the setting is off", () => {
    expect(
      isExperimentResultsUpdateDisabled(stopped(hoursAgo(48)), {}, now),
    ).toBe(false);
    expect(
      isExperimentResultsUpdateDisabled(
        stopped(hoursAgo(48)),
        { disableResultsUpdateForStoppedExperiments: false },
        now,
      ),
    ).toBe(false);
  });

  it("only disables stopped experiments", () => {
    expect(
      isExperimentResultsUpdateDisabled(
        { status: "running", phases: [{ dateEnded: hoursAgo(48) }] },
        on,
        now,
      ),
    ).toBe(false);
    expect(
      isExperimentResultsUpdateDisabled(stopped(hoursAgo(48)), on, now),
    ).toBe(true);
  });

  it("disables immediately when the grace period is unset or 0", () => {
    expect(
      isExperimentResultsUpdateDisabled(stopped(hoursAgo(0)), on, now),
    ).toBe(true);
    expect(
      isExperimentResultsUpdateDisabled(
        stopped(hoursAgo(0)),
        { ...on, disableResultsUpdateForStoppedExperimentGraceHours: 0 },
        now,
      ),
    ).toBe(true);
  });

  it("stays enabled inside the grace window and disables after it", () => {
    const settings = {
      ...on,
      disableResultsUpdateForStoppedExperimentGraceHours: 24,
    };
    expect(
      isExperimentResultsUpdateDisabled(stopped(hoursAgo(23.5)), settings, now),
    ).toBe(false);
    expect(
      isExperimentResultsUpdateDisabled(stopped(hoursAgo(24)), settings, now),
    ).toBe(true);
    expect(
      isExperimentResultsUpdateDisabled(stopped(hoursAgo(500)), settings, now),
    ).toBe(true);
  });

  it("supports a fractional grace period", () => {
    const settings = {
      ...on,
      disableResultsUpdateForStoppedExperimentGraceHours: 1.5,
    };
    expect(
      isExperimentResultsUpdateDisabled(stopped(hoursAgo(1.25)), settings, now),
    ).toBe(false);
    expect(
      isExperimentResultsUpdateDisabled(stopped(hoursAgo(1.5)), settings, now),
    ).toBe(true);
  });

  it("uses the last phase's end date, accepting ISO strings", () => {
    const settings = {
      ...on,
      disableResultsUpdateForStoppedExperimentGraceHours: 24,
    };
    expect(
      isExperimentResultsUpdateDisabled(
        stopped(hoursAgo(1).toISOString()),
        settings,
        now,
      ),
    ).toBe(false);
  });

  it("is not disabled without a stop date", () => {
    expect(isExperimentResultsUpdateDisabled(stopped(undefined), on, now)).toBe(
      false,
    );
    expect(
      isExperimentResultsUpdateDisabled({ status: "stopped" }, on, now),
    ).toBe(false);
  });
});
