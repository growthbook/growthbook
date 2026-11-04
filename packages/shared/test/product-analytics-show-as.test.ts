import {
  getDefaultValueAxisName,
  getExplorationRenderOpts,
  getRenderedMetricValue,
  getShowAsByIndex,
  normalizeShowAs,
  omitRenderOnlyValueFields,
} from "shared/enterprise";
import { toClientJourneyExploration } from "shared/journeys";
import type {
  ExplorationConfig,
  MetricValue,
  ProductAnalyticsExploration,
  ShowAs,
} from "shared/validators";
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

describe("getShowAsByIndex", () => {
  it("resolves each mean metric independently", () => {
    const config = metricConfig([
      metricValue("revenue", "per_unit"),
      metricValue("revenue", "total"),
    ]);
    expect(getShowAsByIndex(config, getFactMetricById)).toEqual([
      "per_unit",
      "total",
    ]);
  });

  it("infers the default from each metric's own aggregation", () => {
    const config = metricConfig([
      metricValue("revenue"),
      metricValue("maxOrder"),
    ]);
    expect(getShowAsByIndex(config, getFactMetricById)).toEqual([
      "total",
      "per_unit",
    ]);
  });

  it("is null for metric types without a meaningful per-unit view", () => {
    const config = metricConfig([
      metricValue("converted", "per_unit"),
      metricValue("aov"),
      metricValue("revenue"),
    ]);
    expect(getShowAsByIndex(config, getFactMetricById)).toEqual([
      null,
      null,
      "total",
    ]);
  });

  it("is null for a slot with no metric selected", () => {
    const config = metricConfig([metricValue("")]);
    expect(getShowAsByIndex(config, getFactMetricById)).toEqual([null]);
  });

  it("falls back to the deprecated config-level showAs", () => {
    const config = metricConfig(
      [metricValue("revenue"), metricValue("revenue", "total")],
      "per_unit",
    );
    expect(getShowAsByIndex(config, getFactMetricById)).toEqual([
      "per_unit",
      "total",
    ]);
  });

  it("resolves an unsaved draft metric", () => {
    const draft = makeMetric("", "mean", "max");
    const config = metricConfig([{ ...metricValue(""), draftMetric: draft }]);
    expect(getShowAsByIndex(config, () => null)).toEqual(["per_unit"]);
  });

  it("is null for every value of a non-metric dataset", () => {
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
    expect(getShowAsByIndex(config, getFactMetricById)).toEqual([null]);
  });
});

describe("normalizeShowAs", () => {
  it("moves the config-level showAs onto the values it applies to", () => {
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

  it("strips showAs from values whose metric doesn't support it", () => {
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

describe("omitRenderOnlyValueFields", () => {
  it("hashes like a value that never had showAs", () => {
    expect(
      JSON.stringify(
        omitRenderOnlyValueFields(metricValue("revenue", "per_unit")),
      ),
    ).toBe(JSON.stringify(metricValue("revenue")));
  });

  it("returns the value itself when it has no render-only fields", () => {
    const value = metricValue("revenue");
    expect(omitRenderOnlyValueFields(value)).toBe(value);
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

  it("ignores values showAs doesn't apply to", () => {
    expect(
      getDefaultValueAxisName(
        metricConfig([metricValue("revenue"), metricValue("converted")]),
        getFactMetricById,
      ),
    ).toBe("Total");
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
  it("serves a cached result with the requested per-value showAs", () => {
    const cached = {
      config: metricConfig([
        metricValue("revenue", "per_unit"),
        metricValue("maxOrder"),
      ]),
      result: { rows: [] },
    } as unknown as ProductAnalyticsExploration;
    const requested = metricConfig([
      metricValue("revenue"),
      metricValue("maxOrder", "total"),
    ]);
    expect(
      toClientJourneyExploration(cached, requested).config.dataset,
    ).toEqual(requested.dataset);
  });
});
