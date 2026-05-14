import type {
  ExplorationConfig,
  ExplorationDateRange,
  ProductAnalyticsExploration,
} from "shared/validators";
import { computeExplorationComparisonPayload } from "shared/enterprise";
import type { FactMetricInterface } from "shared/types/fact-table";

function metricConfig(
  metricId: string,
  opts?: {
    dateGranularity?: "day" | "week" | "month";
    showAs?: "total" | "per_unit";
  },
): ExplorationConfig {
  return {
    type: "metric",
    datasource: "ds",
    dimensions: [
      {
        dimensionType: "date",
        column: "d",
        dateGranularity: opts?.dateGranularity ?? "day",
      },
    ],
    chartType: "line",
    dateRange: {
      predefined: "customDateRange",
      lookbackValue: null,
      lookbackUnit: null,
      startDate: "2024-01-01",
      endDate: "2024-01-07",
    },
    dataset: {
      type: "metric",
      values: [
        {
          type: "metric",
          name: "A",
          metricId,
          unit: null,
          denominatorUnit: null,
          rowFilters: [],
        },
      ],
    },
    showAs: opts?.showAs ?? "per_unit",
  };
}

function explorationOneRow(
  numerator: number,
  denominator: number | null,
  dimension0 = "2024-01-01",
  config: ExplorationConfig = metricConfig("m1"),
): ProductAnalyticsExploration {
  return {
    id: "e1",
    organization: "o",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datasource: "ds",
    configHash: "h",
    valueHashes: [],
    config,
    result: {
      rows: [
        {
          dimensions: [dimension0],
          values: [
            {
              metricId: "m1",
              numerator,
              denominator,
            },
          ],
        },
      ],
    },
    dateStart: "2024-01-01",
    dateEnd: "2024-01-07",
    runStarted: null,
    status: "success",
    queries: [],
  };
}

describe("computeExplorationComparisonPayload", () => {
  const prevFrame: ExplorationDateRange = {
    predefined: "customDateRange",
    lookbackValue: null,
    lookbackUnit: null,
    startDate: "2023-01-01",
    endDate: "2023-01-07",
  };

  it("computes big-number percent and table trend rounded to 2 decimals", () => {
    const meanMetric: FactMetricInterface = {
      id: "m1",
      organization: "o",
      datasource: "ds",
      managedBy: "",
      name: "Mean",
      description: "",
      tags: [],
      projects: [],
      owner: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      metricType: "mean",
      inverse: false,
      numerator: {
        factTableId: "ft",
        column: "c",
        aggregation: "sum",
        rowFilters: [],
      },
      denominator: null,
    } as unknown as FactMetricInterface;

    const getFactMetricById = (id: string) => (id === "m1" ? meanMetric : null);

    const primary = explorationOneRow(110, 10, "2024-01-01");
    const comparison = explorationOneRow(100, 10, "2023-01-01");
    const config = metricConfig("m1");

    const out = computeExplorationComparisonPayload(
      primary,
      comparison,
      config,
      prevFrame,
      getFactMetricById,
    );

    expect(out.previousPeriod.startDate).toBe("2023-01-01");
    expect(out.bigNumberTrends[0]).not.toBeNull();
    const t = out.bigNumberTrends[0]!;
    expect(t.currentValue).toBeCloseTo(11, 5);
    expect(t.previousValue).toBeCloseTo(10, 5);
    expect(t.pctChangeFraction).toBeCloseTo(0.1, 5);
    expect(t.pctChangePercent).toBe(10);

    expect(out.tableTrendsByRow).toHaveLength(1);
    expect(out.tableTrendsByRow[0]["__metric_0____trend"]).toBe(10);
  });

  it("pairs sparse primary rows to YoY comparison cells for tableTrendsByRow", () => {
    const meanMetric: FactMetricInterface = {
      id: "m1",
      organization: "o",
      datasource: "ds",
      managedBy: "",
      name: "Mean",
      description: "",
      tags: [],
      projects: [],
      owner: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      metricType: "mean",
      inverse: false,
      numerator: {
        factTableId: "ft",
        column: "c",
        aggregation: "sum",
        rowFilters: [],
      },
      denominator: null,
    } as unknown as FactMetricInterface;

    const getFactMetricById = (id: string) => (id === "m1" ? meanMetric : null);

    const config = metricConfig("m1", { showAs: "total" });
    const primary: ProductAnalyticsExploration = {
      ...explorationOneRow(0, null, "2024-01-01", config),
      result: {
        rows: [
          {
            dimensions: ["2024-01-05"],
            values: [{ metricId: "m1", numerator: 10, denominator: null }],
          },
          {
            dimensions: ["2024-01-07"],
            values: [{ metricId: "m1", numerator: 20, denominator: null }],
          },
        ],
      },
    };
    const comparison = explorationOneRow(5, null, "2023-01-05", config);

    const out = computeExplorationComparisonPayload(
      primary,
      comparison,
      config,
      prevFrame,
      getFactMetricById,
    );

    expect(out.tableTrendsByRow).toHaveLength(2);
    expect(out.tableTrendsByRow[0]["__metric_0____trend"]).toBe(100);
    expect(out.tableTrendsByRow[1]["__metric_0____trend"]).toBeNull();
  });

  it("returns empty table trends when ratio metric", () => {
    const ratioMetric: FactMetricInterface = {
      id: "m1",
      organization: "o",
      datasource: "ds",
      managedBy: "",
      name: "Ratio",
      description: "",
      tags: [],
      projects: [],
      owner: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      metricType: "ratio",
      inverse: false,
      numerator: {
        factTableId: "ft",
        column: "c",
        aggregation: "sum",
        rowFilters: [],
      },
      denominator: {
        factTableId: "ft",
        column: "d",
        aggregation: "sum",
        rowFilters: [],
      },
    } as unknown as FactMetricInterface;

    const getFactMetricById = (id: string) =>
      id === "m1" ? ratioMetric : null;

    const primary = explorationOneRow(1, 2, "2024-01-01");
    const comparison = explorationOneRow(1, 4, "2023-01-01");
    const config = metricConfig("m1");

    const out = computeExplorationComparisonPayload(
      primary,
      comparison,
      config,
      prevFrame,
      getFactMetricById,
    );

    expect(out.bigNumberTrends[0]).not.toBeNull();
    expect(out.tableTrendsByRow).toEqual([]);
  });

  it("densifies empty comparison to full daily zero series for the previous window", () => {
    const meanMetric: FactMetricInterface = {
      id: "m1",
      organization: "o",
      datasource: "ds",
      managedBy: "",
      name: "Mean",
      description: "",
      tags: [],
      projects: [],
      owner: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      metricType: "mean",
      inverse: false,
      numerator: {
        factTableId: "ft",
        column: "c",
        aggregation: "sum",
        rowFilters: [],
      },
      denominator: null,
    } as unknown as FactMetricInterface;

    const getFactMetricById = (id: string) => (id === "m1" ? meanMetric : null);

    const config = metricConfig("m1", { showAs: "total" });
    const primary = explorationOneRow(5, null, "2024-01-01", config);
    const comparison: ProductAnalyticsExploration = {
      ...explorationOneRow(0, null, "2023-01-01", config),
      result: { rows: [] },
    };

    const out = computeExplorationComparisonPayload(
      primary,
      comparison,
      config,
      prevFrame,
      getFactMetricById,
    );

    expect(out.exploration?.result.rows).toHaveLength(7);
    expect(
      out.exploration?.result.rows.every((r) => r.values[0]?.numerator === 0),
    ).toBe(true);
    expect(out.bigNumberTrends[0]?.previousValue).toBe(0);
  });
});
