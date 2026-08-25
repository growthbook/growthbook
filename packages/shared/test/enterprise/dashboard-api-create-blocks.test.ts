import { apiCreateDashboardBlockInterface } from "../../src/enterprise/validators/dashboard-block";

// A type missing from the create union fails at write time with a union error
// that names nothing.

const explorationBase = {
  datasource: "ds_abc",
  dimensions: [],
  chartType: "bar" as const,
  dateRange: { predefined: "last30Days" as const },
};

const GENERAL_DASHBOARD_BLOCK_FIXTURES: Record<string, unknown> = {
  markdown: {
    type: "markdown",
    title: "",
    description: "",
    content: "## Notes",
  },
  "metric-exploration": {
    type: "metric-exploration",
    title: "Revenue",
    description: "",
    explorerAnalysisId: "expl_1",
    config: {
      ...explorationBase,
      type: "metric",
      dataset: {
        type: "metric",
        values: [
          {
            type: "metric",
            name: "Revenue",
            metricId: "fact__rev",
            unit: "user_id",
            denominatorUnit: null,
            rowFilters: [],
          },
        ],
      },
    },
  },
  "fact-table-exploration": {
    type: "fact-table-exploration",
    title: "Orders",
    description: "",
    explorerAnalysisId: "expl_2",
    config: {
      ...explorationBase,
      type: "fact_table",
      dataset: {
        type: "fact_table",
        factTableId: "ftb_orders",
        values: [
          {
            type: "fact_table",
            name: "Orders",
            valueType: "count",
            valueColumn: null,
            unit: null,
            rowFilters: [],
          },
        ],
      },
    },
  },
  "data-source-exploration": {
    type: "data-source-exploration",
    title: "Raw events",
    description: "",
    explorerAnalysisId: "expl_3",
    config: {
      ...explorationBase,
      type: "data_source",
      dataset: {
        type: "data_source",
        table: "events",
        path: "analytics.public.events",
        timestampColumn: "ts",
        columnTypes: { ts: "date", country: "string" },
        values: [
          {
            type: "data_source",
            name: "Events",
            valueType: "count",
            valueColumn: null,
            unit: null,
            rowFilters: [],
          },
        ],
      },
    },
  },
  "funnel-exploration": {
    type: "funnel-exploration",
    title: "Signup funnel",
    description: "",
    explorerAnalysisId: "expl_4",
    config: {
      ...explorationBase,
      type: "funnel",
      dataset: {
        type: "funnel",
        unit: "user_id",
        steps: [
          {
            name: "Viewed signup",
            factTableId: "ftb_pageviews",
            rowFilters: [],
            optional: false,
          },
          {
            name: "Signed up",
            factTableId: "ftb_signups",
            rowFilters: [],
            optional: false,
          },
        ],
      },
    },
  },
  "experiments-status": {
    type: "experiments-status",
    title: "Team Velocity",
    description: "",
    dateRange: { predefined: "last90Days" },
    projects: [],
    dateGranularity: "auto",
  },
  "experiments-win-rate": {
    type: "experiments-win-rate",
    title: "Win Percentage",
    description: "",
    dateRange: { predefined: "last90Days" },
    projects: [],
    showProjectBreakdown: true,
  },
  "experiments-scaled-impact": {
    type: "experiments-scaled-impact",
    title: "Scaled Impact",
    description: "",
    dateRange: { predefined: "last90Days" },
    projects: [],
    metricId: "fact__rev",
  },
  "metric-experiments": {
    type: "metric-experiments",
    title: "Experiments with Lift",
    description: "",
    metricId: "fact__rev",
    projects: [],
    experimentSearchString: "",
    differenceType: "relative",
    bandits: false,
  },
  "sql-explorer": {
    type: "sql-explorer",
    title: "Custom query",
    description: "",
    savedQueryId: "sq_1",
    blockConfig: [],
  },
};

describe("apiCreateDashboardBlockInterface", () => {
  Object.entries(GENERAL_DASHBOARD_BLOCK_FIXTURES).forEach(
    ([type, fixture]) => {
      it(`accepts a ${type} block`, () => {
        const parsed = apiCreateDashboardBlockInterface.safeParse(fixture);
        expect(
          parsed.success ? null : JSON.stringify(parsed.error.issues),
        ).toBe(null);
      });
    },
  );

  it("accepts a block with an explicit grid layout", () => {
    const parsed = apiCreateDashboardBlockInterface.safeParse({
      ...(GENERAL_DASHBOARD_BLOCK_FIXTURES["metric-exploration"] as Record<
        string,
        unknown
      >),
      layout: { x: 8, y: 4, w: 8, h: 4 },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a layout wider than the grid", () => {
    const parsed = apiCreateDashboardBlockInterface.safeParse({
      ...(GENERAL_DASHBOARD_BLOCK_FIXTURES.markdown as Record<string, unknown>),
      layout: { x: 0, y: 0, w: 25, h: 3 },
    });
    expect(parsed.success).toBe(false);
  });
});
