import {
  getNewMetricsUpdateBlocker,
  shouldOfferNewMetricsUpdate,
} from "../src/experiments/new-metrics-update";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-03-01T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR);

function offered({
  reasons = ["metrics_changed"],
  resultsEndDate = hoursAgo(1),
  windowHours = 4,
  newMetricsUpdateBlocker = null,
  statsEngineInputsChanged = false,
}: Partial<Parameters<typeof shouldOfferNewMetricsUpdate>[0]> = {}) {
  return shouldOfferNewMetricsUpdate({
    reasons,
    resultsEndDate,
    windowHours,
    now: NOW,
    newMetricsUpdateBlocker,
    statsEngineInputsChanged,
  });
}

describe("shouldOfferNewMetricsUpdate", () => {
  it.each<[string, Parameters<typeof offered>[0], boolean]>([
    ["nothing changed", { reasons: [] }, false],
    ["new metrics are the only change and the results are recent", {}, true],
    [
      "the results are older than the window",
      { resultsEndDate: hoursAgo(5) },
      false,
    ],
    [
      "the results are exactly at the window",
      { resultsEndDate: hoursAgo(4) },
      false,
    ],
    [
      "the results are just inside the window",
      { resultsEndDate: new Date(NOW.getTime() - 4 * HOUR + 1) },
      true,
    ],
    ["the window is 0", { windowHours: 0, resultsEndDate: NOW }, false],
    [
      "no update can compute only new metrics",
      { newMetricsUpdateBlocker: "metric_not_supported" },
      false,
    ],
    [
      "a computed metric's stats engine inputs changed",
      { statsEngineInputsChanged: true },
      false,
    ],
    [
      "the analysis dates changed",
      { reasons: ["analysis_dates_changed"] },
      false,
    ],
    [
      "the analysis dates changed with the metrics",
      { reasons: ["metrics_changed", "analysis_dates_changed"] },
      false,
    ],
    [
      "a setting changed with the metrics",
      { reasons: ["segment", "metrics_changed"] },
      false,
    ],
    [
      "newer Overall results exist",
      { reasons: ["metrics_changed", "newer_overall_results"] },
      false,
    ],
  ])("when %s: %s", (name, overrides, expected) => {
    expect(offered(overrides)).toBe(expected);
  });
});

describe("getNewMetricsUpdateBlocker", () => {
  const phases = [
    { dateStarted: "2026-01-01", dateEnded: "2026-01-10" },
    { dateStarted: "2026-01-10" },
  ];
  const blocker = (
    overrides: Partial<Parameters<typeof getNewMetricsUpdateBlocker>[0]> = {},
  ) =>
    getNewMetricsUpdateBlocker({
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
