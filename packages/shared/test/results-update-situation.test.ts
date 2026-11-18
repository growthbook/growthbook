import {
  getMetricRefreshBlocker,
  getResultsUpdateSituation,
} from "../src/experiments/metric-refresh";
import type { ResultsOutdatedReason } from "../src/experiments/outdated-reasons";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-03-01T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR);

function situation({
  reasons = ["metrics_changed"],
  resultsEndDate = hoursAgo(1),
  windowHours = 4,
  refreshBlocker = null,
}: Partial<Parameters<typeof getResultsUpdateSituation>[0]> = {}) {
  return getResultsUpdateSituation({
    reasons,
    resultsEndDate,
    windowHours,
    now: NOW,
    refreshBlocker,
  });
}

describe("getResultsUpdateSituation", () => {
  it("is up to date when nothing changed", () => {
    expect(situation({ reasons: [] })).toBe("up_to_date");
  });

  it("offers new metrics when they are the only change and the results are recent", () => {
    expect(situation()).toBe("new_metrics");
  });

  it("falls back to a normal update once the results are older than the window", () => {
    expect(situation({ resultsEndDate: hoursAgo(5) })).toBe("metrics_added");
  });

  it("treats results exactly at the window as too old", () => {
    expect(situation({ resultsEndDate: hoursAgo(4) })).toBe("metrics_added");
    expect(
      situation({ resultsEndDate: new Date(NOW.getTime() - 4 * HOUR + 1) }),
    ).toBe("new_metrics");
  });

  it("never offers new metrics with a window of 0", () => {
    expect(situation({ windowHours: 0, resultsEndDate: NOW })).toBe(
      "metrics_added",
    );
  });

  it("does not offer new metrics when no update can compute only them", () => {
    expect(situation({ refreshBlocker: "phase_ended" })).toBe("metrics_added");
  });

  it.each<ResultsOutdatedReason[]>([
    ["analysis_dates_changed"],
    ["metrics_changed", "analysis_dates_changed"],
    ["segment", "metrics_changed"],
    ["metrics_changed", "newer_overall_results"],
  ])("needs a normal update when %j changed", (...reasons) => {
    expect(situation({ reasons })).toBe("settings_changed");
  });
});

describe("getMetricRefreshBlocker", () => {
  const phases = [
    { dateStarted: "2026-01-01", dateEnded: "2026-01-10" },
    { dateStarted: "2026-01-10" },
  ];
  const blocker = (
    overrides: Partial<Parameters<typeof getMetricRefreshBlocker>[0]> = {},
  ) =>
    getMetricRefreshBlocker({
      experiment: { type: "standard", phases },
      phase: 1,
      separateExperimentResultQueries: true,
      pipelineChanged: false,
      ...overrides,
    });

  it("allows the running latest phase of a standard experiment", () => {
    expect(blocker()).toBeNull();
    expect(blocker({ experiment: { type: undefined, phases } })).toBeNull();
  });

  it("names what blocks a new-metrics update", () => {
    expect(blocker({ experiment: { type: "holdout", phases } })).toBe(
      "unsupported_experiment_type",
    );
    expect(blocker({ phase: 0 })).toBe("not_latest_phase");
    expect(
      blocker({
        experiment: {
          type: "standard",
          phases: [{ dateStarted: "2026-01-01", dateEnded: "2026-01-10" }],
        },
        phase: 0,
      }),
    ).toBe("phase_ended");
    expect(blocker({ separateExperimentResultQueries: false })).toBe(
      "unsupported_data_source",
    );
    expect(blocker({ pipelineChanged: true })).toBe("metric_not_supported");
  });
});
