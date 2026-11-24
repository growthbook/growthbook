import { describe, expect, it } from "vitest";
import type {
  ExplorationConfig,
  ProductAnalyticsExploration,
} from "shared/validators";
import {
  showsSeparateValueCharts,
  sliceExplorationToValue,
  stripExplorerDraftFields,
} from "@/enterprise/components/ProductAnalytics/util";

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
      showsSeparateValueCharts(config(["revenue", "signups"], separate)),
    ).toBe(true);
    expect(showsSeparateValueCharts(config(["revenue"], separate))).toBe(false);
    expect(
      showsSeparateValueCharts(
        config(["revenue", "signups"], { ...separate, chartType: "bigNumber" }),
      ),
    ).toBe(false);
    expect(showsSeparateValueCharts(config(["revenue", "signups"]))).toBe(
      false,
    );
  });

  it("lets a ratio share one chart with other metric types when turned off", () => {
    expect(showsSeparateValueCharts(config(["revenue", "aov"]))).toBe(false);
  });
});

describe("stripExplorerDraftFields", () => {
  it("keeps the separate-charts setting on the submitted config", () => {
    const separate = { chartSettings: { separateValueCharts: true } };
    expect(
      stripExplorerDraftFields(config(["revenue", "signups"], separate))
        .chartSettings,
    ).toEqual({ separateValueCharts: true });
    expect(
      stripExplorerDraftFields(
        config(["revenue", "signups"], {
          chartSettings: { separateValueCharts: false },
        }),
      ).chartSettings,
    ).toBeUndefined();
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
    expect(sliced.config.chartSettings).toEqual({
      valueAxisLabel: "",
      separateValueCharts: true,
    });
    expect(sliced.exploration?.result.rows[0].values).toEqual([
      { metricId: "signups", numerator: 3, denominator: 4 },
    ]);
  });
});
