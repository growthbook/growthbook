import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { MetricAnalysisInterface } from "shared/types/metric-analysis";
import { SavedQuery, ProductAnalyticsExploration } from "shared/validators";
import {
  redactSnapshotForPublic,
  redactSavedQueryForPublic,
  redactMetricAnalysisForPublic,
  redactExplorationForPublic,
} from "back-end/src/enterprise/services/dashboards";

// These serializers are the authorization boundary for block data on the
// unauthenticated public dashboard endpoint — verify they strip raw SQL and
// adhoc filters while preserving the result data the page renders.
describe("public dashboard block-data redaction", () => {
  describe("redactSnapshotForPublic", () => {
    const snapshot = {
      id: "snap_1",
      analyses: [{ results: [{ name: "All" }] }],
      queries: [{ query: "qry_1", status: "succeeded", name: "main" }],
      settings: {
        queryFilter: "WHERE country = 'US'",
        metricSettings: [
          {
            id: "met_1",
            settings: { sql: "SELECT * FROM events", type: "binomial" },
          },
          { id: "met_2" }, // no settings — must not throw
        ],
        dimensions: [
          {
            id: "dim_1",
            settings: { sql: "SELECT country", userIdType: "user" },
          },
        ],
        goalMetrics: ["met_1"],
      },
    } as unknown as ExperimentSnapshotInterface;

    const result = redactSnapshotForPublic(snapshot);

    it("blanks the SQL-bearing fields", () => {
      expect(result.settings.queryFilter).toBe("");
      expect(result.settings.metricSettings[0].settings?.sql).toBe("");
      expect(result.settings.dimensions[0].settings?.sql).toBe("");
    });

    it("preserves results and non-SQL settings", () => {
      expect(result.analyses).toEqual(snapshot.analyses);
      expect(result.settings.goalMetrics).toEqual(["met_1"]);
      expect(result.settings.metricSettings[0].settings?.type).toBe("binomial");
      expect(result.settings.dimensions[0].settings?.userIdType).toBe("user");
      // queries are id pointers, not SQL — left intact
      expect(result.queries).toEqual(snapshot.queries);
    });

    it("handles metric settings that are absent", () => {
      expect(result.settings.metricSettings[1].settings).toBeUndefined();
    });

    it("does not mutate the input", () => {
      expect(snapshot.settings.queryFilter).toBe("WHERE country = 'US'");
      expect(snapshot.settings.metricSettings[0].settings?.sql).toBe(
        "SELECT * FROM events",
      );
    });
  });

  describe("redactSavedQueryForPublic", () => {
    const query = {
      id: "sq_1",
      sql: "SELECT user_id, revenue FROM orders",
      dataVizConfig: [{ chartType: "bar" }],
      results: {
        results: [{ user_id: "u1", revenue: 5 }],
        sql: "SELECT user_id, revenue FROM orders",
      },
    } as unknown as SavedQuery;

    const result = redactSavedQueryForPublic(query);

    it("strips top-level and nested SQL", () => {
      expect(result.sql).toBe("");
      expect(result.results.sql).toBeUndefined();
    });

    it("preserves result rows and viz config", () => {
      expect(result.results.results).toEqual([{ user_id: "u1", revenue: 5 }]);
      expect(result.dataVizConfig).toEqual([{ chartType: "bar" }]);
    });

    it("does not mutate the input", () => {
      expect(query.sql).toBe("SELECT user_id, revenue FROM orders");
      expect(query.results.sql).toBe("SELECT user_id, revenue FROM orders");
    });
  });

  describe("redactMetricAnalysisForPublic", () => {
    const analysis = {
      id: "man_1",
      result: { count: 100 },
      settings: {
        userIdType: "user",
        additionalNumeratorFilters: ["amount > 0"],
        additionalDenominatorFilters: ["status = 'active'"],
      },
    } as unknown as MetricAnalysisInterface;

    const result = redactMetricAnalysisForPublic(analysis);

    it("strips adhoc SQL filter expressions", () => {
      expect(result.settings.additionalNumeratorFilters).toBeUndefined();
      expect(result.settings.additionalDenominatorFilters).toBeUndefined();
    });

    it("preserves the result and non-SQL settings", () => {
      expect(result.result).toEqual({ count: 100 });
      expect(result.settings.userIdType).toBe("user");
    });

    it("does not mutate the input", () => {
      expect(analysis.settings.additionalNumeratorFilters).toEqual([
        "amount > 0",
      ]);
    });
  });

  describe("redactExplorationForPublic", () => {
    it("returns the exploration unchanged (no raw SQL / credentials present)", () => {
      const exploration = {
        id: "exp_1",
        datasource: "ds_1",
        result: { rows: [] },
        config: { type: "metric" },
      } as unknown as ProductAnalyticsExploration;
      expect(redactExplorationForPublic(exploration)).toEqual(exploration);
    });
  });
});
