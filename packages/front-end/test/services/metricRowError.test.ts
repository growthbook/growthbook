import {
  getMetricErrorsForDisplay,
  resolveMetricRowError,
} from "@/services/experiments";

describe("resolveMetricRowError", () => {
  it("prefers the metricErrors map", () => {
    expect(
      resolveMetricRowError({
        metricId: "met_a",
        metricErrors: {
          met_a: { type: "query", message: "Query failed: timeout" },
        },
      }),
    ).toEqual({ type: "query", message: "Query failed: timeout" });
  });

  it("returns undefined when nothing failed", () => {
    expect(
      resolveMetricRowError({
        metricId: "met_a",
        metricErrors: { met_b: { type: "query", message: "Query failed" } },
      }),
    ).toBeUndefined();
  });
});

describe("getMetricErrorsForDisplay", () => {
  it("treats an existing analysis map as authoritative", () => {
    expect(
      getMetricErrorsForDisplay({
        metricErrors: {},
        queries: [
          {
            query: "qry_group",
            name: "group_0",
            status: "failed",
            metrics: ["met_a", "met_b"],
          },
        ],
      }),
    ).toEqual({});
  });

  it("reconstructs metric errors from legacy failed query pointers", () => {
    expect(
      getMetricErrorsForDisplay({
        queries: [
          {
            query: "qry_group",
            name: "group_0",
            status: "failed",
            error: "warehouse timeout",
            metrics: ["met_a", "met_b"],
          },
        ],
      }),
    ).toEqual({
      met_a: { type: "query", message: "Query failed: warehouse timeout" },
      met_b: { type: "query", message: "Query failed: warehouse timeout" },
    });
  });

  it("falls back to failed query names for older snapshots", () => {
    expect(
      getMetricErrorsForDisplay({
        failedQueryNames: ["met_a"],
      }),
    ).toEqual({
      met_a: { type: "query", message: "Query failed" },
    });
  });
});
