import { ExperimentMetricInterface } from "shared/experiments";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { QueryInterface } from "shared/types/query";
import {
  buildAnalysisMetricErrors,
  buildMetricErrorFromQuery,
  getMetricsAndQueryDataForStatsEngine,
} from "back-end/src/services/stats";
import { QueryMap } from "back-end/src/queryRunners/QueryRunner";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";

// Minimal snapshot settings — only the fields read by
// getMetricsAndQueryDataForStatsEngine / getMetricSettingsForStatsEngine.
function buildSettings(metricIds: string[]): ExperimentSnapshotSettings {
  return {
    metricSettings: [],
    goalMetrics: metricIds,
    secondaryMetrics: [],
    guardrailMetrics: [],
    regressionAdjustmentEnabled: false,
    variations: [],
  } as unknown as ExperimentSnapshotSettings;
}

// Only the fields read by the function under test matter; cast the rest.
function buildQuery(overrides: Partial<QueryInterface>): QueryInterface {
  return {
    id: "qry_" + Math.random().toString(36).slice(2),
    organization: "org_1",
    datasource: "ds_1",
    language: "sql",
    query: "SELECT 1",
    status: "succeeded",
    createdAt: new Date(),
    heartbeat: new Date(),
    ...overrides,
  } as QueryInterface;
}

describe("getMetricsAndQueryDataForStatsEngine per-metric error attribution", () => {
  const metricIds = ["m_ok", "m_failed", "m_group_a", "m_group_b", "m_dep"];

  function buildMetricMap(): Map<string, ExperimentMetricInterface> {
    const metrics = metricIds.map((id) => factMetricFactory.build({ id }));
    return new Map(metrics.map((m) => [m.id, m]));
  }

  it("records a per-metric query error for a failed single-metric query and keeps surviving metrics in queryResults", () => {
    const metricMap = buildMetricMap();
    const settings = buildSettings(metricIds);

    const queryData: QueryMap = new Map();
    // A surviving metric with a succeeded query
    queryData.set(
      "m_ok",
      buildQuery({ status: "succeeded", result: [{ variation: "0" }] }),
    );
    // A failed single-metric query
    queryData.set(
      "m_failed",
      buildQuery({ status: "failed", error: "Column not found" }),
    );

    const { queryResults, metricErrors } = getMetricsAndQueryDataForStatsEngine(
      queryData,
      metricMap,
      settings,
    );

    // Surviving metric is still analyzed
    expect(queryResults.some((qr) => qr.metrics.includes("m_ok"))).toBe(true);
    // Failed metric is NOT pushed as a blank result
    expect(queryResults.some((qr) => qr.metrics.includes("m_failed"))).toBe(
      false,
    );
    // Failed metric gets a structured "query" error with the chained message
    expect(metricErrors["m_failed"]).toEqual({
      type: "query",
      message: "Query failed: Column not found",
    });
    expect(metricErrors["m_ok"]).toBeUndefined();
  });

  it("uses explicit ownership instead of a single-metric query name", () => {
    const metricMap = buildMetricMap();
    const settings = buildSettings(metricIds);
    const queryData: QueryMap = new Map([
      [
        "renamed_query",
        buildQuery({
          status: "failed",
          error: "Column not found",
          queryType: "experimentMetric",
        }),
      ],
    ]);

    const { metricErrors } = getMetricsAndQueryDataForStatsEngine(
      queryData,
      metricMap,
      settings,
      { renamed_query: ["m_failed"] },
    );

    expect(metricErrors["m_failed"]).toEqual({
      type: "query",
      message: "Query failed: Column not found",
    });
    expect(metricErrors["renamed_query"]).toBeUndefined();
  });

  it("uses explicit ownership instead of a multi-metric query name", () => {
    const metricMap = buildMetricMap();
    const settings = buildSettings(metricIds);
    const queryData: QueryMap = new Map([
      [
        "renamed_query",
        buildQuery({
          status: "failed",
          error: "Table not found",
          queryType: "experimentMultiMetric",
        }),
      ],
    ]);

    const { metricErrors } = getMetricsAndQueryDataForStatsEngine(
      queryData,
      metricMap,
      settings,
      { renamed_query: ["m_group_a", "m_group_b"] },
    );

    expect(metricErrors["m_group_a"]).toEqual({
      type: "query",
      message: "Query failed: Table not found",
    });
    expect(metricErrors["m_group_b"]).toEqual(metricErrors["m_group_a"]);
  });

  it("attributes a failed fact-group query to each constituent metric (query vs dependency)", () => {
    const metricMap = buildMetricMap();
    const settings = buildSettings(metricIds);

    const queryData: QueryMap = new Map();
    // A surviving single metric
    queryData.set(
      "m_ok",
      buildQuery({ status: "succeeded", result: [{ variation: "0" }] }),
    );
    // A group query that failed at runtime
    queryData.set(
      "group_0",
      buildQuery({ status: "failed", error: "Syntax error near FROM" }),
    );
    // A group query that failed because an upstream dependency failed
    queryData.set(
      "group_1",
      buildQuery({
        status: "failed",
        error: "Dependencies failed: qry_units",
      }),
    );

    const factMetricGroups: Record<string, string[]> = {
      group_0: ["m_group_a", "m_group_b"],
      group_1: ["m_dep"],
    };

    const { queryResults, metricErrors } = getMetricsAndQueryDataForStatsEngine(
      queryData,
      metricMap,
      settings,
      factMetricGroups,
    );

    // Every metric in the failed group gets the same runtime query error
    expect(metricErrors["m_group_a"]).toEqual({
      type: "query",
      message: "Query failed: Syntax error near FROM",
    });
    expect(metricErrors["m_group_b"]).toEqual({
      type: "query",
      message: "Query failed: Syntax error near FROM",
    });
    // A cascade failure is classified as a dependency error
    expect(metricErrors["m_dep"]).toEqual({
      type: "dependency",
      message: "Dependency failed: qry_units",
    });
    // Failed groups contribute no rows to gbstats; the survivor still does
    expect(queryResults.some((qr) => qr.metrics.includes("m_ok"))).toBe(true);
    expect(queryResults.some((qr) => qr.metrics.includes("m_group_a"))).toBe(
      false,
    );
  });

  it("does not record an error for a query that succeeded with zero rows", () => {
    const metricMap = buildMetricMap();
    const settings = buildSettings(metricIds);

    const queryData: QueryMap = new Map();
    // Succeeded group query with no rows is a legitimately empty result
    queryData.set("group_0", buildQuery({ status: "succeeded", result: [] }));

    const { metricErrors, queryResults } = getMetricsAndQueryDataForStatsEngine(
      queryData,
      metricMap,
      settings,
      { group_0: ["m_group_a", "m_group_b"] },
    );

    expect(Object.keys(metricErrors)).toHaveLength(0);
    expect(queryResults).toEqual([
      {
        metrics: ["m_group_a", "m_group_b"],
        rows: [],
        sql: "SELECT 1",
      },
    ]);
  });

  it("classifies a build-time SQL-generation failure as a build error", () => {
    const metricMap = buildMetricMap();
    const settings = buildSettings(metricIds);

    const queryData: QueryMap = new Map();
    // A metric whose query failed to build (Phase 2 records it as a failed
    // query with the "Failed to build query" prefix).
    queryData.set(
      "m_failed",
      buildQuery({
        status: "failed",
        error: "Failed to build query: Unknown fact table",
      }),
    );

    const { metricErrors } = getMetricsAndQueryDataForStatsEngine(
      queryData,
      metricMap,
      settings,
    );

    expect(metricErrors["m_failed"]).toEqual({
      type: "build",
      message: "Failed to build query: Unknown fact table",
    });
  });

  it("attributes a failed incremental statistics query to the metrics it computed", () => {
    const metricMap = buildMetricMap();
    const settings = buildSettings(metricIds);

    const queryData: QueryMap = new Map();
    // Same-FT statistics query that failed at runtime
    queryData.set(
      "statistics_ft_1_ab12340",
      buildQuery({
        status: "failed",
        error: "Table not found",
        queryType: "experimentIncrementalRefreshStatistics",
      }),
    );
    // Cross-FT statistics query that cascaded from a failed insert
    queryData.set(
      "statistics_cross_ft_1_ab12340__ft_2_ab12341",
      buildQuery({
        status: "failed",
        error: "Dependencies failed: qry_insert",
        queryType: "experimentIncrementalRefreshStatistics",
      }),
    );

    const { metricErrors } = getMetricsAndQueryDataForStatsEngine(
      queryData,
      metricMap,
      settings,
      {
        statistics_ft_1_ab12340: ["m_group_a", "m_group_b"],
        statistics_cross_ft_1_ab12340__ft_2_ab12341: ["m_dep"],
      },
    );

    expect(metricErrors["m_group_a"]).toEqual({
      type: "query",
      message: "Query failed: Table not found",
    });
    expect(metricErrors["m_group_b"]).toEqual(metricErrors["m_group_a"]);
    expect(metricErrors["m_dep"]).toEqual({
      type: "dependency",
      message: "Dependency failed: qry_insert",
    });
  });

  it("reports ownership metadata that references a missing metric as config drift", () => {
    const { metricErrors } = getMetricsAndQueryDataForStatsEngine(
      new Map([
        [
          "group_0",
          buildQuery({
            status: "succeeded",
            result: [],
            queryType: "experimentMultiMetric",
          }),
        ],
      ]),
      buildMetricMap(),
      buildSettings(metricIds),
      { group_0: ["metric_deleted_after_query_start"] },
    );

    expect(metricErrors["metric_deleted_after_query_start"]).toEqual({
      type: "config-drift",
      message: "Metric configuration changed after the query started",
    });
  });
});

describe("buildAnalysisMetricErrors", () => {
  it("keeps analysis failures scoped to their analysis index", () => {
    const metricErrors = buildAnalysisMetricErrors(
      [
        {
          metric: "m_failed",
          analyses: [
            {
              unknownVariations: [],
              multipleExposures: 0,
              dimensions: [],
              error: "first analysis failed",
              traceback: "sensitive traceback",
            },
            {
              unknownVariations: [],
              multipleExposures: 0,
              dimensions: [],
            },
          ],
        },
      ],
      2,
    );

    expect(metricErrors).toEqual([
      {
        m_failed: {
          type: "analysis",
          message: "Analysis error: first analysis failed",
        },
      },
      {},
    ]);
    expect(JSON.stringify(metricErrors)).not.toContain("sensitive traceback");
  });
});

describe("buildMetricErrorFromQuery", () => {
  it("classifies a build-time failure as a build error and preserves the message", () => {
    expect(
      buildMetricErrorFromQuery("Failed to build query: Unknown fact table"),
    ).toEqual({
      type: "build",
      message: "Failed to build query: Unknown fact table",
    });
  });

  it("classifies a dependency cascade as a dependency error", () => {
    expect(buildMetricErrorFromQuery("Dependencies failed: qry_units")).toEqual(
      {
        type: "dependency",
        message: "Dependency failed: qry_units",
      },
    );
  });

  it("classifies any other failure as a runtime query error", () => {
    expect(buildMetricErrorFromQuery("Syntax error near FROM")).toEqual({
      type: "query",
      message: "Query failed: Syntax error near FROM",
    });
  });

  it("falls back to a generic message when no raw error is present", () => {
    expect(buildMetricErrorFromQuery()).toEqual({
      type: "query",
      message: "Query failed",
    });
  });
});
