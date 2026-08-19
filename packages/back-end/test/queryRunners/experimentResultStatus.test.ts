import { getExperimentResultStatus } from "back-end/src/queryRunners/experimentResultStatus";

describe("getExperimentResultStatus", () => {
  it("succeeds when every metric query succeeds", () => {
    expect(
      getExperimentResultStatus([
        { status: "succeeded", queryType: "experimentMetric" },
        { status: "succeeded", queryType: "experimentMultiMetric" },
      ]),
    ).toBe("succeeded");
  });

  it("partially succeeds when a minority of metric queries fail", () => {
    expect(
      getExperimentResultStatus([
        { status: "succeeded", queryType: "experimentMetric" },
        { status: "succeeded", queryType: "experimentMetric" },
        { status: "failed", queryType: "experimentMetric" },
      ]),
    ).toBe("partially-succeeded");
  });

  it("partially succeeds when a majority of metric queries fail", () => {
    expect(
      getExperimentResultStatus([
        { status: "succeeded", queryType: "experimentMetric" },
        { status: "failed", queryType: "experimentMetric" },
        { status: "failed", queryType: "experimentMetric" },
        { status: "failed", queryType: "experimentMultiMetric" },
      ]),
    ).toBe("partially-succeeded");
  });

  it("fails when every metric query fails", () => {
    expect(
      getExperimentResultStatus([
        { status: "failed", queryType: "experimentMetric" },
        { status: "failed", queryType: "experimentMultiMetric" },
      ]),
    ).toBe("failed");
  });

  it("fails when the units query and its metric dependents fail", () => {
    expect(
      getExperimentResultStatus([
        { status: "failed", queryType: "experimentUnits" },
        { status: "failed", queryType: "experimentMetric" },
        { status: "failed", queryType: "experimentMultiMetric" },
      ]),
    ).toBe("failed");
  });

  it("fails when only a traffic query succeeds", () => {
    expect(
      getExperimentResultStatus([
        { status: "succeeded", queryType: "experimentTraffic" },
        { status: "failed", queryType: "experimentMetric" },
      ]),
    ).toBe("failed");
  });

  it.each(["queued", "running"] as const)(
    "keeps running while any query is %s",
    (status) => {
      expect(
        getExperimentResultStatus([
          { status: "succeeded", queryType: "experimentMetric" },
          { status, queryType: "experimentTraffic" },
        ]),
      ).toBe("running");
    },
  );

  it.each([
    "experimentResults",
    "experimentIncrementalRefreshStatistics",
  ] as const)("recognizes %s as an experiment result query", (queryType) => {
    expect(
      getExperimentResultStatus([{ status: "succeeded", queryType }]),
    ).toBe("succeeded");
  });

  it("does not let a non-metric failure block a metric result", () => {
    expect(
      getExperimentResultStatus([
        { status: "succeeded", queryType: "experimentMetric" },
        { status: "failed", queryType: "experimentTraffic" },
      ]),
    ).toBe("partially-succeeded");
  });

  it("succeeds an incremental refresh when DDL and statistics all succeed", () => {
    expect(
      getExperimentResultStatus([
        {
          status: "succeeded",
          queryType: "experimentIncrementalRefreshCreateUnitsTable",
        },
        {
          status: "succeeded",
          queryType: "experimentIncrementalRefreshInsertMetricsSourceData",
        },
        {
          status: "succeeded",
          queryType: "experimentIncrementalRefreshStatistics",
        },
      ]),
    ).toBe("succeeded");
  });

  it("fails an incremental refresh when statistics fails despite succeeded DDL", () => {
    expect(
      getExperimentResultStatus([
        {
          status: "succeeded",
          queryType: "experimentIncrementalRefreshCreateUnitsTable",
        },
        {
          status: "succeeded",
          queryType: "experimentIncrementalRefreshInsertMetricsSourceData",
        },
        {
          status: "failed",
          queryType: "experimentIncrementalRefreshStatistics",
        },
      ]),
    ).toBe("failed");
  });

  it("partially succeeds an incremental refresh when one statistics group fails", () => {
    expect(
      getExperimentResultStatus([
        {
          status: "succeeded",
          queryType: "experimentIncrementalRefreshStatistics",
        },
        {
          status: "failed",
          queryType: "experimentIncrementalRefreshStatistics",
        },
      ]),
    ).toBe("partially-succeeded");
  });
});
