import {
  getDefaultValueAxisName,
  getExplorationRenderOpts,
  getRenderedMetricValue,
  getShowAsChoiceByIndex,
  getShowAsOptions,
  normalizeShowAs,
} from "shared/enterprise";
import { toClientJourneyExploration } from "shared/journeys";
import type {
  ExplorationConfig,
  MetricValue,
  ProductAnalyticsExploration,
  ShowAs,
} from "shared/validators";
import { toValueQueryKey } from "shared/validators";
import type { FactMetricInterface } from "shared/types/fact-table";

function makeMetric(
  id: string,
  metricType: FactMetricInterface["metricType"],
  aggregation: "sum" | "max" | "count distinct" = "sum",
): FactMetricInterface {
  return {
    id,
    name: id,
    metricType,
    numerator: { factTableId: "ft", column: "amount", aggregation },
    denominator: null,
  } as FactMetricInterface;
}

const metrics = new Map(
  [
    makeMetric("revenue", "mean"),
    makeMetric("maxOrder", "mean", "max"),
    makeMetric("converted", "proportion"),
    makeMetric("aov", "ratio"),
  ].map((m) => [m.id, m]),
);
const getFactMetricById = (id: string) => metrics.get(id) ?? null;

function metricValue(
  metricId: string,
  showAs?: ShowAs,
  unit: string | null = "user_id",
): MetricValue {
  return {
    type: "metric",
    name: metricId,
    metricId,
    unit,
    denominatorUnit: null,
    rowFilters: [],
    ...(showAs ? { showAs } : {}),
  };
}

function metricConfig(
  values: MetricValue[],
  legacyShowAs?: ShowAs,
): ExplorationConfig {
  return {
    type: "metric",
    datasource: "ds",
    chartType: "line",
    dimensions: [],
    dateRange: { predefined: "last30Days" },
    dataset: { type: "metric", values },
    ...(legacyShowAs ? { showAs: legacyShowAs } : {}),
  };
}

const MEAN_OPTIONS = ["total", "per_unit"];
const none = { options: [], showAs: "total" };
const mean = (showAs: ShowAs) => ({ options: MEAN_OPTIONS, showAs });

describe("getShowAsOptions", () => {
  it("offers total and per unit for mean metrics only", () => {
    expect(getShowAsOptions("mean")).toEqual(MEAN_OPTIONS);
    for (const type of [
      "proportion",
      "retention",
      "dailyParticipation",
      "ratio",
      "quantile",
    ] as const) {
      expect(getShowAsOptions(type)).toEqual([]);
    }
    expect(getShowAsOptions(undefined)).toEqual([]);
  });
});

describe("getShowAsChoiceByIndex", () => {
  it("resolves each mean metric independently", () => {
    const config = metricConfig([
      metricValue("revenue", "per_unit"),
      metricValue("revenue", "total"),
    ]);
    expect(getShowAsChoiceByIndex(config, getFactMetricById)).toEqual([
      mean("per_unit"),
      mean("total"),
    ]);
  });

  it("infers the default from each metric's own aggregation", () => {
    const config = metricConfig([
      metricValue("revenue"),
      metricValue("maxOrder"),
    ]);
    expect(getShowAsChoiceByIndex(config, getFactMetricById)).toEqual([
      mean("total"),
      mean("per_unit"),
    ]);
  });

  it("offers no options and renders totals for other metric types", () => {
    const config = metricConfig([
      metricValue("converted", "per_unit"),
      metricValue("aov"),
      metricValue("revenue"),
    ]);
    expect(getShowAsChoiceByIndex(config, getFactMetricById)).toEqual([
      none,
      none,
      mean("total"),
    ]);
  });

  it("offers no options for a slot with no metric selected", () => {
    const config = metricConfig([metricValue("")]);
    expect(getShowAsChoiceByIndex(config, getFactMetricById)).toEqual([none]);
  });

  it("falls back to the deprecated config-level showAs", () => {
    const config = metricConfig(
      [metricValue("revenue"), metricValue("revenue", "total")],
      "per_unit",
    );
    expect(getShowAsChoiceByIndex(config, getFactMetricById)).toEqual([
      mean("per_unit"),
      mean("total"),
    ]);
  });

  it("resolves an unsaved draft metric", () => {
    const draft = makeMetric("", "mean", "max");
    const config = metricConfig([{ ...metricValue(""), draftMetric: draft }]);
    expect(getShowAsChoiceByIndex(config, () => null)).toEqual([
      mean("per_unit"),
    ]);
  });

  it("offers no options for any value of a non-metric dataset", () => {
    const config: ExplorationConfig = {
      ...metricConfig([]),
      type: "fact_table",
      dataset: {
        type: "fact_table",
        factTableId: "ft",
        values: [
          {
            type: "fact_table",
            name: "Events",
            valueType: "count",
            valueColumn: null,
            unit: null,
            rowFilters: [],
          },
        ],
      },
    };
    expect(getShowAsChoiceByIndex(config, getFactMetricById)).toEqual([none]);
  });
});

describe("normalizeShowAs", () => {
  it("moves the config-level showAs onto the values that offer it", () => {
    const normalized = normalizeShowAs(
      metricConfig(
        [metricValue("revenue"), metricValue("converted")],
        "per_unit",
      ),
      getFactMetricById,
    );
    expect(normalized).not.toHaveProperty("showAs");
    expect(normalized.dataset).toEqual({
      type: "metric",
      values: [metricValue("revenue", "per_unit"), metricValue("converted")],
    });
  });

  it("keeps a value's own choice over the config-level one", () => {
    const normalized = normalizeShowAs(
      metricConfig([metricValue("revenue", "total")], "per_unit"),
      getFactMetricById,
    );
    expect(normalized.dataset).toEqual({
      type: "metric",
      values: [metricValue("revenue", "total")],
    });
  });

  it("strips showAs that isn't one of the metric's options", () => {
    const normalized = normalizeShowAs(
      metricConfig([metricValue("converted", "per_unit")]),
      getFactMetricById,
    );
    expect(normalized.dataset).toEqual({
      type: "metric",
      values: [metricValue("converted")],
    });
  });

  it("keeps showAs on values whose metric hasn't loaded", () => {
    const config = metricConfig([metricValue("loading", "per_unit")]);
    expect(normalizeShowAs(config, getFactMetricById)).toBe(config);
  });

  it("returns the same reference when nothing changes", () => {
    const config = metricConfig([
      metricValue("revenue", "per_unit"),
      metricValue("converted"),
    ]);
    expect(normalizeShowAs(config, getFactMetricById)).toBe(config);
  });
});

describe("toValueQueryKey", () => {
  it("ignores render-only fields", () => {
    expect(
      toValueQueryKey({ ...metricValue("revenue", "per_unit"), name: "A" }),
    ).toEqual(toValueQueryKey({ ...metricValue("revenue"), name: "B" }));
  });

  it("distinguishes values that query differently", () => {
    expect(
      toValueQueryKey(metricValue("revenue", undefined, "user_id")),
    ).not.toEqual(
      toValueQueryKey(metricValue("revenue", undefined, "device_id")),
    );
  });
});

describe("getDefaultValueAxisName", () => {
  it("names the shared mode", () => {
    expect(
      getDefaultValueAxisName(
        metricConfig([
          metricValue("revenue", "per_unit"),
          metricValue("maxOrder"),
        ]),
        getFactMetricById,
      ),
    ).toBe("Per user_id");
  });

  it("ignores values that offer no options", () => {
    expect(
      getDefaultValueAxisName(
        metricConfig([metricValue("revenue"), metricValue("converted")]),
        getFactMetricById,
      ),
    ).toBe("Total");
  });

  it("is empty when a per-unit value shares the axis with a proportion", () => {
    expect(
      getDefaultValueAxisName(
        metricConfig([
          metricValue("revenue", "per_unit"),
          metricValue("converted"),
        ]),
        getFactMetricById,
      ),
    ).toBe("");
  });

  it("is empty when no value offers options", () => {
    expect(
      getDefaultValueAxisName(
        metricConfig([metricValue("converted")]),
        getFactMetricById,
      ),
    ).toBe("");
  });

  it("is empty when values render in different modes", () => {
    expect(
      getDefaultValueAxisName(
        metricConfig([
          metricValue("revenue", "total"),
          metricValue("revenue", "per_unit"),
        ]),
        getFactMetricById,
      ),
    ).toBe("");
  });
});

describe("getRenderedMetricValue", () => {
  it("applies each value's own showAs", () => {
    const opts = getExplorationRenderOpts(
      metricConfig([
        metricValue("revenue", "total"),
        metricValue("revenue", "per_unit"),
        metricValue("converted"),
      ]),
      getFactMetricById,
    );
    const cell = { numerator: 100, denominator: 4 };
    expect([0, 1, 2].map((i) => getRenderedMetricValue(cell, opts, i))).toEqual(
      [100, 25, 100],
    );
  });
});

describe("toClientJourneyExploration", () => {
  it("serves a cached result with the requested names and showAs", () => {
    const cached = {
      config: metricConfig([
        { ...metricValue("revenue", "per_unit"), name: "Old name" },
        metricValue("maxOrder"),
      ]),
      result: { rows: [] },
    } as unknown as ProductAnalyticsExploration;
    const requested = metricConfig([
      { ...metricValue("revenue"), name: "New name" },
      metricValue("maxOrder", "total"),
    ]);
    expect(
      toClientJourneyExploration(cached, requested).config.dataset,
    ).toEqual(requested.dataset);
  });
});

describe("seriesNameByIndex", () => {
  const names = (config: ExplorationConfig) =>
    getExplorationRenderOpts(config, getFactMetricById).seriesNameByIndex;

  it("annotates every value when the axis mixes modes", () => {
    expect(
      names(
        metricConfig([
          metricValue("revenue", "per_unit"),
          metricValue("maxOrder", "total"),
          metricValue("converted"),
        ]),
      ),
    ).toEqual([
      "revenue (per user_id)",
      "maxOrder (total)",
      "converted (total)",
    ]);
  });

  it("annotates a proportion that shares the axis with a per-unit value", () => {
    expect(
      names(
        metricConfig([
          metricValue("revenue", "per_unit"),
          metricValue("converted"),
        ]),
      ),
    ).toEqual(["revenue (per user_id)", "converted (total)"]);
  });

  it("keeps plain names when the axis title names the shared unit", () => {
    expect(
      names(
        metricConfig([
          metricValue("revenue", "per_unit"),
          metricValue("maxOrder"),
        ]),
      ),
    ).toEqual(["revenue", "maxOrder"]);
  });

  it("annotates each value when per-unit values use different units", () => {
    expect(
      names(
        metricConfig([
          metricValue("revenue", "per_unit", "user_id"),
          metricValue("maxOrder", "per_unit", "device_id"),
        ]),
      ),
    ).toEqual(["revenue (per user_id)", "maxOrder (per device_id)"]);
  });

  it("keeps plain names when every value is a total", () => {
    expect(
      names(
        metricConfig([
          metricValue("revenue", "total"),
          metricValue("converted"),
        ]),
      ),
    ).toEqual(["revenue", "converted"]);
  });

  it("annotates per-unit values under a custom axis title", () => {
    expect(
      names({
        ...metricConfig([metricValue("revenue", "per_unit")]),
        chartSettings: { valueAxisLabel: "Revenue" },
      }),
    ).toEqual(["revenue (per user_id)"]);
  });
});
