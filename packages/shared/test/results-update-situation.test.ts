import {
  getMetricRefreshBlocker,
  getResultsUpdateSituation,
} from "../src/experiments/metric-refresh";

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
  it.each<[string, Parameters<typeof situation>[0], string]>([
    ["nothing changed", { reasons: [] }, "up_to_date"],
    [
      "new metrics are the only change and the results are recent",
      {},
      "new_metrics",
    ],
    [
      "the results are older than the window",
      { resultsEndDate: hoursAgo(5) },
      "metrics_added",
    ],
    [
      "the results are exactly at the window",
      { resultsEndDate: hoursAgo(4) },
      "metrics_added",
    ],
    [
      "the results are just inside the window",
      { resultsEndDate: new Date(NOW.getTime() - 4 * HOUR + 1) },
      "new_metrics",
    ],
    [
      "the window is 0",
      { windowHours: 0, resultsEndDate: NOW },
      "metrics_added",
    ],
    [
      "no update can compute only new metrics",
      { refreshBlocker: "metric_not_supported" },
      "metrics_added",
    ],
    [
      "the analysis dates changed",
      { reasons: ["analysis_dates_changed"] },
      "settings_changed",
    ],
    [
      "the analysis dates changed with the metrics",
      { reasons: ["metrics_changed", "analysis_dates_changed"] },
      "settings_changed",
    ],
    [
      "a setting changed with the metrics",
      { reasons: ["segment", "metrics_changed"] },
      "settings_changed",
    ],
    [
      "newer Overall results exist",
      { reasons: ["metrics_changed", "newer_overall_results"] },
      "settings_changed",
    ],
  ])("when %s: %s", (name, overrides, expected) => {
    expect(situation(overrides)).toBe(expected);
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

  it("allows the running latest phase of a standard experiment, unless the pipeline changed since the results", () => {
    expect(blocker()).toBeNull();
    expect(blocker({ experiment: { type: undefined, phases } })).toBeNull();
    expect(blocker({ pipelineChanged: true })).toBe("metric_not_supported");
  });
});
