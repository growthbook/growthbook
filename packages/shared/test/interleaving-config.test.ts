import {
  getInterleavingResultsBlocker,
  interleavingAnalysisConfigured,
  interleavingAutoSnapshotScheduled,
} from "../src/util";

const configured = {
  datasourceId: "ds_1",
  interleavingExposureQueryId: "ilq_1",
  userIdType: "user_id",
};
const withMetrics = { ...configured, metrics: [{ id: "met_1" }] };

describe("interleavingAnalysisConfigured", () => {
  it("accepts a fully configured analysis", () => {
    expect(interleavingAnalysisConfigured(configured)).toBe(true);
    expect(getInterleavingResultsBlocker(withMetrics)).toBeNull();
  });

  it.each([
    "datasourceId",
    "interleavingExposureQueryId",
    "userIdType",
  ] as const)("rejects an empty %s", (field) => {
    const il = { ...withMetrics, [field]: "" };
    expect(interleavingAnalysisConfigured(il)).toBe(false);
    expect(getInterleavingResultsBlocker(il)).toContain("Data Source");
  });

  it("rejects a brand new experiment with nothing set", () => {
    const il = {
      datasourceId: "",
      interleavingExposureQueryId: "",
      userIdType: "",
      metrics: [],
    };
    expect(interleavingAnalysisConfigured(il)).toBe(false);
    expect(getInterleavingResultsBlocker(il)).not.toBeNull();
  });
});

describe("getInterleavingResultsBlocker", () => {
  it("asks for a metric once the analysis is configured", () => {
    expect(getInterleavingResultsBlocker({ ...configured, metrics: [] })).toBe(
      "Add at least one metric to this interleaving experiment before updating results.",
    );
  });

  // The analysis inputs are what the metric picker reads, so they come first.
  it("reports the missing analysis before the missing metric", () => {
    expect(
      getInterleavingResultsBlocker({
        ...configured,
        datasourceId: "",
        metrics: [],
      }),
    ).toContain("Data Source");
  });

  it("keeps named resources Title Case", () => {
    const blocker = getInterleavingResultsBlocker({
      ...withMetrics,
      datasourceId: "",
    });
    expect(blocker).toContain("Data Source");
    expect(blocker).not.toContain("data source");
  });
});

describe("interleavingAutoSnapshotScheduled", () => {
  const scheduled = {
    ...withMetrics,
    status: "running",
    archived: false,
    autoSnapshots: true,
  };

  it("accepts a running experiment with auto-updates on", () => {
    expect(interleavingAutoSnapshotScheduled(scheduled)).toBe(true);
  });

  it.each([
    ["archived", { archived: true }],
    ["stopped", { status: "stopped" }],
    ["a draft", { status: "draft" }],
    ["auto-updates off", { autoSnapshots: false }],
  ])("rejects %s", (_label, overrides) => {
    expect(
      interleavingAutoSnapshotScheduled({ ...scheduled, ...overrides }),
    ).toBe(false);
  });

  // Pre-dates the scheduling fields; treated as off until something seeds it.
  it("rejects a doc with no autoSnapshots field", () => {
    expect(
      interleavingAutoSnapshotScheduled({
        ...withMetrics,
        status: "running",
        archived: false,
      }),
    ).toBe(false);
  });

  // dangerousFindInterleavingsToUpdate requires metrics.0 and a datasourceId,
  // so claiming an update is coming for these would never come true.
  it.each([
    ["no metrics", { metrics: [] }],
    ["no Data Source", { datasourceId: "" }],
    ["no exposure query", { interleavingExposureQueryId: "" }],
    ["no identifier type", { userIdType: "" }],
  ])("rejects a running experiment with %s", (_label, overrides) => {
    expect(
      interleavingAutoSnapshotScheduled({ ...scheduled, ...overrides }),
    ).toBe(false);
  });
});
