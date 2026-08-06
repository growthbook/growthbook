import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { MetricAnalysisInterface } from "shared/types/metric-analysis";
import { ProductAnalyticsExploration, SavedQuery } from "shared/validators";
import { ExperimentMetricInterface } from "shared/experiments";
import { DashboardInterface } from "shared/enterprise";
import {
  redactSnapshotForPublic,
  redactSavedQueryForPublic,
  redactMetricAnalysisForPublic,
  redactExplorationConfigForPublic,
  redactExplorationForPublic,
  redactMetricForPublic,
  redactDashboardForPublic,
} from "back-end/src/enterprise/services/dashboards";

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
          { id: "met_2" },
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

  describe("redactExplorationConfigForPublic", () => {
    it("blanks data-source schema, value columns, and sql_expr filters", () => {
      const config = {
        type: "data_source",
        datasource: "ds_1",
        chartType: "table",
        dateRange: { predefined: "last7Days" },
        dimensions: [
          {
            dimensionType: "slice",
            slices: [
              {
                name: "US buyers",
                filters: [
                  { operator: "sql_expr", values: ["country = 'US'"] },
                  { operator: "equals", column: "plan", values: ["pro"] },
                ],
              },
            ],
          },
        ],
        dataset: {
          type: "data_source",
          table: "events",
          path: "analytics.events",
          timestampColumn: "ts",
          columnTypes: { revenue: "number" },
          values: [
            {
              type: "data_source",
              name: "Revenue",
              valueType: "sum",
              valueColumn: "revenue",
              unit: null,
              rowFilters: [
                { operator: "sql_expr", values: ["amount > 0"] },
                { operator: "equals", column: "status", values: ["paid"] },
              ],
            },
          ],
        },
      } as unknown as ProductAnalyticsExploration["config"];

      const result = redactExplorationConfigForPublic(config);

      expect(result.dataset.type).toBe("data_source");
      if (result.dataset.type !== "data_source") throw new Error("type");
      expect(result.dataset.table).toBe("");
      expect(result.dataset.path).toBe("");
      expect(result.dataset.timestampColumn).toBe("");
      expect(result.dataset.columnTypes).toEqual({});
      expect(result.dataset.values[0].valueColumn).toBeNull();
      expect(result.dataset.values[0].rowFilters[0].values).toEqual([]);
      expect(result.dataset.values[0].rowFilters[1].values).toEqual(["paid"]);

      // Display fields survive.
      expect(result.chartType).toBe("table");
      expect(result.dataset.values[0].name).toBe("Revenue");
      const slice = result.dimensions[0];
      if (slice.dimensionType !== "slice") throw new Error("dimensionType");
      expect(slice.slices[0].name).toBe("US buyers");
      expect(slice.slices[0].filters[0].values).toEqual([]);
      expect(slice.slices[0].filters[1].values).toEqual(["pro"]);
    });

    it("drops fact-table id and value columns", () => {
      const config = {
        type: "fact_table",
        datasource: "ds_1",
        chartType: "bar",
        dateRange: { predefined: "last30Days" },
        dimensions: [],
        dataset: {
          type: "fact_table",
          factTableId: "ft_1",
          values: [
            {
              type: "fact_table",
              name: "Signups",
              valueType: "count",
              valueColumn: "user_id",
              unit: null,
              rowFilters: [{ operator: "sql_expr", values: ["x = 1"] }],
            },
          ],
        },
      } as unknown as ProductAnalyticsExploration["config"];

      const result = redactExplorationConfigForPublic(config);
      if (result.dataset.type !== "fact_table") throw new Error("type");
      expect(result.dataset.factTableId).toBeNull();
      expect(result.dataset.values[0].valueColumn).toBeNull();
      expect(result.dataset.values[0].rowFilters[0].values).toEqual([]);
      expect(result.dataset.values[0].name).toBe("Signups");
    });

    it("blanks funnel step fact tables and sql_expr filters, keeps names", () => {
      const config = {
        type: "funnel",
        datasource: "ds_1",
        chartType: "bar",
        dateRange: { predefined: "last7Days" },
        dimensions: [],
        dataset: {
          type: "funnel",
          unit: "user_id",
          steps: [
            {
              name: "Landing",
              factTable: "ft_1",
              optional: false,
              rowFilters: [{ operator: "sql_expr", values: ["path = '/'"] }],
            },
          ],
        },
      } as unknown as ProductAnalyticsExploration["config"];

      const result = redactExplorationConfigForPublic(config);
      if (result.dataset.type !== "funnel") throw new Error("type");
      expect(result.dataset.steps[0].factTable).toBe("");
      expect(result.dataset.steps[0].rowFilters[0].values).toEqual([]);
      expect(result.dataset.steps[0].name).toBe("Landing");
    });

    it("does not mutate the input", () => {
      const config = {
        type: "data_source",
        datasource: "ds_1",
        chartType: "table",
        dateRange: { predefined: "last7Days" },
        dimensions: [],
        dataset: {
          type: "data_source",
          table: "events",
          path: "analytics.events",
          timestampColumn: "ts",
          columnTypes: { revenue: "number" },
          values: [
            {
              type: "data_source",
              name: "Revenue",
              valueType: "sum",
              valueColumn: "revenue",
              unit: null,
              rowFilters: [{ operator: "sql_expr", values: ["amount > 0"] }],
            },
          ],
        },
      } as unknown as ProductAnalyticsExploration["config"];

      redactExplorationConfigForPublic(config);
      if (config.dataset.type !== "data_source") throw new Error("type");
      expect(config.dataset.table).toBe("events");
      expect(config.dataset.values[0].valueColumn).toBe("revenue");
      expect(config.dataset.values[0].rowFilters[0].values).toEqual([
        "amount > 0",
      ]);
    });
  });

  describe("redactExplorationForPublic", () => {
    const exploration = {
      id: "expl_1",
      organization: "org_1",
      datasource: "ds_1",
      status: "success",
      queries: [{ query: "qry_1", status: "succeeded", name: "main" }],
      result: { rows: [{ dimensions: ["US"] }] },
      config: {
        type: "fact_table",
        datasource: "ds_1",
        chartType: "bar",
        dateRange: { predefined: "last7Days" },
        dimensions: [],
        dataset: {
          type: "fact_table",
          factTableId: "ft_1",
          values: [
            {
              type: "fact_table",
              name: "Signups",
              valueType: "count",
              valueColumn: "user_id",
              unit: null,
              rowFilters: [],
            },
          ],
        },
      },
    } as unknown as ProductAnalyticsExploration;

    const result = redactExplorationForPublic(exploration);

    it("strips internal query pointers and org id", () => {
      expect(result.queries).toEqual([]);
      expect(result.organization).toBe("");
    });

    it("redacts the config and preserves results", () => {
      expect(result.result).toEqual(exploration.result);
      if (result.config.dataset.type !== "fact_table") throw new Error("type");
      expect(result.config.dataset.factTableId).toBeNull();
    });

    it("does not mutate the input", () => {
      expect(exploration.organization).toBe("org_1");
      expect(exploration.queries).toHaveLength(1);
    });
  });

  describe("redactMetricForPublic", () => {
    it("strips legacy sql, templateVariables, and userIdColumns", () => {
      const metric = {
        id: "met_1",
        name: "Revenue",
        type: "count",
        sql: "SELECT * FROM orders",
        templateVariables: { eventName: "purchase" },
        userIdColumns: { user_id: "uid" },
        userIdTypes: ["user"],
      } as unknown as ExperimentMetricInterface;

      const result = redactMetricForPublic(metric) as Record<string, unknown>;
      expect(result.sql).toBeUndefined();
      expect(result.templateVariables).toBeUndefined();
      expect(result.userIdColumns).toBeUndefined();
      expect(result.name).toBe("Revenue");
    });

    it("strips nested fact-metric row filters and aggregate filters", () => {
      const metric = {
        id: "fact__1",
        name: "Purchases",
        metricType: "mean",
        numerator: {
          factTableId: "ft_1",
          column: "amount",
          aggregation: "sum",
          rowFilters: [{ operator: "sql_expr", values: ["amount > 0"] }],
          aggregateFilter: "count > 5",
          aggregateFilterColumn: "count",
        },
        denominator: {
          factTableId: "ft_2",
          column: "users",
          rowFilters: [{ operator: "equals", column: "x", values: ["1"] }],
          aggregateFilter: "count > 1",
        },
      } as unknown as ExperimentMetricInterface;

      const result = redactMetricForPublic(metric) as {
        numerator: Record<string, unknown>;
        denominator: Record<string, unknown>;
        name: string;
      };
      expect(result.numerator.rowFilters).toBeUndefined();
      expect(result.numerator.aggregateFilter).toBeUndefined();
      expect(result.numerator.aggregateFilterColumn).toBeUndefined();
      expect(result.denominator.rowFilters).toBeUndefined();
      expect(result.denominator.aggregateFilter).toBeUndefined();

      // Lookup/display fields survive.
      expect(result.numerator.factTableId).toBe("ft_1");
      expect(result.numerator.column).toBe("amount");
      expect(result.name).toBe("Purchases");
    });

    it("handles fact metrics with a null denominator", () => {
      const metric = {
        id: "fact__2",
        name: "Count",
        metricType: "proportion",
        numerator: {
          factTableId: "ft_1",
          column: "id",
          rowFilters: [{ operator: "sql_expr", values: ["a = 1"] }],
        },
        denominator: null,
      } as unknown as ExperimentMetricInterface;

      const result = redactMetricForPublic(metric) as {
        numerator: Record<string, unknown>;
        denominator: unknown;
      };
      expect(result.numerator.rowFilters).toBeUndefined();
      expect(result.denominator).toBeNull();
    });

    it("does not mutate a fact metric's column refs", () => {
      const metric = {
        id: "fact__3",
        name: "Purchases",
        metricType: "mean",
        numerator: {
          factTableId: "ft_1",
          column: "amount",
          rowFilters: [{ operator: "sql_expr", values: ["amount > 0"] }],
          aggregateFilter: "count > 5",
        },
        denominator: null,
      } as unknown as ExperimentMetricInterface & {
        numerator: { rowFilters: unknown[]; aggregateFilter: string };
      };

      redactMetricForPublic(metric);
      expect(metric.numerator.rowFilters).toHaveLength(1);
      expect(metric.numerator.aggregateFilter).toBe("count > 5");
    });
  });

  describe("redactDashboardForPublic", () => {
    const dashboard = {
      id: "dash_1",
      organization: "org_1",
      userId: "u_1",
      projects: ["prj_1"],
      title: "My dashboard",
      blocks: [
        {
          id: "b1",
          type: "data-source-exploration",
          explorerAnalysisId: "expl_1",
          config: {
            type: "data_source",
            datasource: "ds_1",
            chartType: "table",
            dateRange: { predefined: "last7Days" },
            dimensions: [],
            dataset: {
              type: "data_source",
              table: "events",
              path: "analytics.events",
              timestampColumn: "ts",
              columnTypes: { revenue: "number" },
              values: [
                {
                  type: "data_source",
                  name: "Revenue",
                  valueType: "sum",
                  valueColumn: "revenue",
                  unit: null,
                  rowFilters: [{ operator: "sql_expr", values: ["a > 0"] }],
                },
              ],
            },
          },
        },
        {
          id: "b2",
          type: "metric-explorer",
          factMetricId: "fact__1",
          metricAnalysisId: "man_1",
          analysisSettings: {
            userIdType: "user",
            additionalNumeratorFilters: ["amount > 0"],
            additionalDenominatorFilters: ["status = 'active'"],
          },
        },
        {
          id: "b3",
          type: "markdown",
          content: "hello",
        },
      ],
    } as unknown as DashboardInterface;

    const result = redactDashboardForPublic(dashboard);

    it("strips ownership and organization identifiers", () => {
      expect(result.userId).toBe("");
      expect(result.organization).toBe("");
      expect(result.projects).toEqual([]);
    });

    it("redacts exploration block configs but keeps lookup ids", () => {
      const block = result.blocks[0];
      if (block.type !== "data-source-exploration") throw new Error("type");
      expect(block.explorerAnalysisId).toBe("expl_1");
      if (block.config.dataset.type !== "data_source") throw new Error("type");
      expect(block.config.dataset.table).toBe("");
      expect(block.config.dataset.values[0].valueColumn).toBeNull();
      expect(block.config.dataset.values[0].rowFilters[0].values).toEqual([]);
    });

    it("strips metric-explorer adhoc SQL filters, keeps lookup ids", () => {
      const block = result.blocks[1];
      if (block.type !== "metric-explorer") throw new Error("type");
      expect(block.factMetricId).toBe("fact__1");
      expect(block.metricAnalysisId).toBe("man_1");
      expect(block.analysisSettings.additionalNumeratorFilters).toBeUndefined();
      expect(
        block.analysisSettings.additionalDenominatorFilters,
      ).toBeUndefined();
      expect(block.analysisSettings.userIdType).toBe("user");
    });

    it("leaves other block types untouched", () => {
      const block = result.blocks[2];
      if (block.type !== "markdown") throw new Error("type");
      expect(block.content).toBe("hello");
    });

    it("does not mutate the input", () => {
      expect(dashboard.userId).toBe("u_1");
      const src = dashboard.blocks[1];
      if (src.type !== "metric-explorer") throw new Error("type");
      expect(src.analysisSettings.additionalNumeratorFilters).toEqual([
        "amount > 0",
      ]);
    });
  });
});
