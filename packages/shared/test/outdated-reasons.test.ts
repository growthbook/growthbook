import {
  getPValueCorrectionOutdatedReasons,
  isAnalysisDateRangeOutdated,
} from "shared/experiments";
import { ExperimentSnapshotAnalysisSettings } from "shared/types/experiment-snapshot";

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

describe("getPValueCorrectionOutdatedReasons", () => {
  type Args = Parameters<typeof getPValueCorrectionOutdatedReasons>[0];
  const reasonsFor = ({
    settings,
    ...args
  }: Partial<Omit<Args, "analysisSettings">> & {
    settings?: Partial<ExperimentSnapshotAnalysisSettings>;
  }) =>
    getPValueCorrectionOutdatedReasons({
      analysisSettings: {
        statsEngine: "frequentist",
        dimensions: [],
        pValueCorrection: "holm-bonferroni",
        ...settings,
      },
      currentPValueCorrection: "holm-bonferroni",
      snapshotGoalMetrics: ["g1", "g2"],
      currentGoalMetrics: ["g1", "g2"],
      ...args,
    });

  it("has none when the method and the goal metrics are unchanged", () => {
    expect(reasonsFor({})).toEqual([]);
    expect(reasonsFor({ currentGoalMetrics: ["g2", "g1", "g1"] })).toEqual([]);
  });

  it("flags a different method, or one turned on or off", () => {
    const changed = ["p_value_correction"];
    expect(
      reasonsFor({ currentPValueCorrection: "benjamini-hochberg" }),
    ).toEqual(changed);
    expect(reasonsFor({ currentPValueCorrection: null })).toEqual(changed);
    expect(reasonsFor({ settings: { pValueCorrection: null } })).toEqual(
      changed,
    );
  });

  it("flags a goal metric added, removed or swapped", () => {
    const changed = ["goal_metrics_changed"];
    expect(reasonsFor({ currentGoalMetrics: ["g1", "g2", "g3"] })).toEqual(
      changed,
    );
    expect(reasonsFor({ currentGoalMetrics: ["g1"] })).toEqual(changed);
    expect(reasonsFor({ currentGoalMetrics: ["g1", "g3"] })).toEqual(changed);
  });

  it("ignores the goal metrics when no correction is applied", () => {
    expect(
      reasonsFor({
        settings: { pValueCorrection: null },
        currentPValueCorrection: null,
        currentGoalMetrics: ["g1"],
      }),
    ).toEqual([]);
  });

  describe("an analysis that recorded no method", () => {
    const settings = { pValueCorrection: undefined };

    it("is never out of date on the method, which follows the current one", () => {
      expect(
        reasonsFor({ settings, currentPValueCorrection: "benjamini-hochberg" }),
      ).toEqual([]);
    });

    it("is out of date on the goal metrics, which are the snapshot's", () => {
      expect(reasonsFor({ settings, currentGoalMetrics: ["g1"] })).toEqual([
        "goal_metrics_changed",
      ]);
      expect(
        reasonsFor({
          settings,
          currentPValueCorrection: null,
          currentGoalMetrics: ["g1"],
        }),
      ).toEqual([]);
    });
  });

  it.each<{
    name: string;
    settings: Partial<ExperimentSnapshotAnalysisSettings>;
  }>([
    { name: "a Bayesian analysis", settings: { statsEngine: "bayesian" } },
    { name: "a date breakdown", settings: { dimensions: ["pre:date"] } },
  ])("has none for $name, which is never corrected", ({ settings }) => {
    expect(
      reasonsFor({
        settings,
        currentPValueCorrection: "benjamini-hochberg",
        currentGoalMetrics: ["g1"],
      }),
    ).toEqual([]);
  });
});
