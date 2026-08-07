import { getSnapshotMetricFailureSummary } from "@/services/experiments";

describe("getSnapshotMetricFailureSummary", () => {
  it("counts nothing when no metric failed", () => {
    expect(
      getSnapshotMetricFailureSummary({
        snapshotMetricIds: ["met_a", "met_b"],
      }),
    ).toEqual({ failedCount: 0, totalCount: 2 });
  });

  it("counts metrics that never produced a result, from the metricErrors map", () => {
    expect(
      getSnapshotMetricFailureSummary({
        metricErrors: {
          met_a: { type: "query", message: "Query failed: timeout" },
          met_b: { type: "build", message: "Failed to build query: bad SQL" },
        },
        snapshotMetricIds: ["met_a", "met_b", "met_c"],
      }),
    ).toEqual({ failedCount: 2, totalCount: 3 });
  });

  it("never reports more failures than the total", () => {
    // A failed id missing from the snapshot's metric list would otherwise read
    // as "2 of 1 metrics failed".
    expect(
      getSnapshotMetricFailureSummary({
        metricErrors: {
          met_a: { type: "query", message: "Query failed: timeout" },
          met_gone: { type: "query", message: "Query failed: timeout" },
        },
        snapshotMetricIds: ["met_a"],
      }),
    ).toEqual({ failedCount: 2, totalCount: 2 });
  });

  it("handles a snapshot with no analysis yet", () => {
    expect(getSnapshotMetricFailureSummary({ snapshotMetricIds: [] })).toEqual({
      failedCount: 0,
      totalCount: 0,
    });
  });
});
