import { describe, expect, it } from "vitest";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import {
  showsSeparateValueCharts,
  sliceExplorationToValue,
  valuesMixMetricClasses,
} from "@/enterprise/components/ProductAnalytics/util";

const metricTypes: Record<string, string> = {
  revenue: "mean",
  signups: "proportion",
  aov: "ratio",
};
const getFactMetricById = (id: string) =>
  metricTypes[id] ? ({ metricType: metricTypes[id] } as never) : null;

function config(
  metricIds: string[],
  overrides: Partial<ExplorationConfig> = {},
): ExplorationConfig {
  return {
    type: "metric",
    datasource: "ds_1",
    chartType: "line",
    dimensions: [],
    dateRange: { predefined: "last7Days" },
    dataset: {
      type: "metric",
      values: metricIds.map((metricId) => ({
        type: "metric",
        name: metricId,
        metricId,
        unit: "user_id",
        denominatorUnit: null,
        rowFilters: [],
      })),
    },
    ...overrides,
  } as ExplorationConfig;
}

describe("showsSeparateValueCharts", () => {
  it("separates when asked, on axis charts with more than one value", () => {
    const separate = { chartSettings: { separateValueCharts: true } };
    expect(
      showsSeparateValueCharts(
        config(["revenue", "signups"], separate),
        getFactMetricById,
      ),
    ).toBe(true);
    expect(
      showsSeparateValueCharts(
        config(["revenue"], separate),
        getFactMetricById,
      ),
    ).toBe(false);
    expect(
      showsSeparateValueCharts(
        config(["revenue", "signups"], { ...separate, chartType: "bigNumber" }),
        getFactMetricById,
      ),
    ).toBe(false);
    expect(
      showsSeparateValueCharts(
        config(["revenue", "signups"]),
        getFactMetricById,
      ),
    ).toBe(false);
  });

  it("always separates a ratio charted with other metric types", () => {
    expect(
      valuesMixMetricClasses(config(["revenue", "aov"]), getFactMetricById),
    ).toBe(true);
    expect(
      valuesMixMetricClasses(config(["revenue", "signups"]), getFactMetricById),
    ).toBe(false);
    expect(
      showsSeparateValueCharts(config(["revenue", "aov"]), getFactMetricById),
    ).toBe(true);
  });
});

describe("sliceExplorationToValue", () => {
  it("keeps only the value at the index, in the config and every row", () => {
    const exploration = {
      result: {
        rows: [
          {
            dimensions: ["2026-11-01"],
            values: [
              { metricId: "revenue", numerator: 10, denominator: 2 },
              { metricId: "signups", numerator: 3, denominator: 4 },
            ],
          },
        ],
      },
    } as ProductAnalyticsExploration;
    const sliced = sliceExplorationToValue(
      config(["revenue", "signups"], {
        chartSettings: { valueAxisLabel: "Shared", separateValueCharts: true },
      }),
      exploration,
      1,
    );
    expect(
      sliced.config.dataset.type === "metric" &&
        sliced.config.dataset.values.map((v) => v.metricId),
    ).toEqual(["signups"]);
    expect(sliced.config.chartSettings).toEqual({ separateValueCharts: true });
    expect(sliced.exploration?.result.rows[0].values).toEqual([
      { metricId: "signups", numerator: 3, denominator: 4 },
    ]);
  });
});
