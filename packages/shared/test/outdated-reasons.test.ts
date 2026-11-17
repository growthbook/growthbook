import { isAnalysisDateRangeOutdated } from "shared/experiments";

describe("isAnalysisDateRangeOutdated", () => {
  const snapshotSettings = {
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: new Date("2026-01-05T00:00:00Z"),
  };

  it("is false when the phase dates match the snapshot", () => {
    expect(
      isAnalysisDateRangeOutdated({
        phase: {
          dateStarted: "2026-01-01T00:00:00Z",
          dateEnded: "2026-01-05T00:00:00Z",
        },
        snapshotSettings,
      }),
    ).toBe(false);
  });

  it("flags a changed start or end date", () => {
    expect(
      isAnalysisDateRangeOutdated({
        phase: {
          dateStarted: "2025-12-25T00:00:00Z",
          dateEnded: "2026-01-05T00:00:00Z",
        },
        snapshotSettings,
      }),
    ).toBe(true);
    expect(
      isAnalysisDateRangeOutdated({
        phase: {
          dateStarted: "2026-01-01T00:00:00Z",
          dateEnded: "2026-01-10T00:00:00Z",
        },
        snapshotSettings,
      }),
    ).toBe(true);
  });

  it("ignores differences under a day", () => {
    expect(
      isAnalysisDateRangeOutdated({
        phase: {
          dateStarted: "2026-01-01T12:00:00Z",
          dateEnded: "2026-01-05T12:00:00Z",
        },
        snapshotSettings,
      }),
    ).toBe(false);
  });

  it("compares a running phase against now", () => {
    expect(
      isAnalysisDateRangeOutdated({
        phase: { dateStarted: "2026-01-01T00:00:00Z" },
        snapshotSettings,
      }),
    ).toBe(true);
  });

  it("uses the run time for a lagged cutoff on a running phase", () => {
    const now = new Date();
    expect(
      isAnalysisDateRangeOutdated({
        phase: { dateStarted: "2026-01-01T00:00:00Z" },
        snapshotSettings: { ...snapshotSettings, endDateIsCutoff: true },
        snapshotDateCreated: now,
      }),
    ).toBe(false);
  });

  it("never flags results whose updates are disabled, even when dates differ", () => {
    expect(
      isAnalysisDateRangeOutdated({
        phase: {
          dateStarted: "2025-12-25T00:00:00Z",
          dateEnded: "2026-01-10T00:00:00Z",
        },
        snapshotSettings,
        resultsUpdateDisabled: true,
      }),
    ).toBe(false);
  });
});
