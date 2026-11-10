import {
  buildExplorationColumns,
  getDefaultValueAxisName,
  getEffectiveMetricValue,
  getExplorationRenderOpts,
  getShowAsChoice,
  getShowAsOptions,
  isRatioValue,
  normalizeShowAs,
  withRequestedDisplayConfig,
} from "shared/enterprise";
import type {
  ExplorationConfig,
  MetricValue,
  ProductAnalyticsExploration,
  ProductAnalyticsValue,
  ShowAs,
} from "shared/validators";
import { omitRenderOnlyFields } from "shared/validators";
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

describe("getShowAsChoice", () => {
  it("resolves each mean metric independently", () => {
    expect(
      getShowAsChoice(
        metricValue("revenue", "per_unit"),
        undefined,
        getFactMetricById,
      ),
    ).toEqual(mean("per_unit"));
    expect(
      getShowAsChoice(
        metricValue("revenue", "total"),
        undefined,
        getFactMetricById,
      ),
    ).toEqual(mean("total"));
  });

  it("infers the default from each metric's own aggregation", () => {
    expect(
      getShowAsChoice(metricValue("revenue"), undefined, getFactMetricById),
    ).toEqual(mean("total"));
    expect(
      getShowAsChoice(metricValue("maxOrder"), undefined, getFactMetricById),
    ).toEqual(mean("per_unit"));
  });

  it("offers no options and renders totals for other metric types", () => {
    expect(
      getShowAsChoice(
        metricValue("converted", "per_unit"),
        undefined,
        getFactMetricById,
      ),
    ).toEqual(none);
    expect(
      getShowAsChoice(metricValue("aov"), undefined, getFactMetricById),
    ).toEqual(none);
  });

  it("offers no options for a slot with no metric selected", () => {
    expect(
      getShowAsChoice(metricValue(""), undefined, getFactMetricById),
    ).toEqual(none);
  });

  it("renders the saved choice while the metric hasn't loaded", () => {
    const savedPerUnit = { options: [], showAs: "per_unit" };
    expect(
      getShowAsChoice(
        metricValue("loading", "per_unit"),
        undefined,
        getFactMetricById,
      ),
    ).toEqual(savedPerUnit);
    expect(
      getShowAsChoice(metricValue("loading"), "per_unit", getFactMetricById),
    ).toEqual(savedPerUnit);
  });

  it("falls back to the deprecated config-level showAs", () => {
    expect(
      getShowAsChoice(metricValue("revenue"), "per_unit", getFactMetricById),
    ).toEqual(mean("per_unit"));
  });

  it("prefers the value's own showAs over the config-level one", () => {
    expect(
      getShowAsChoice(
        metricValue("revenue", "total"),
        "per_unit",
        getFactMetricById,
      ),
    ).toEqual(mean("total"));
  });

  it("resolves an unsaved draft metric", () => {
    const draft = makeMetric("", "mean", "max");
    expect(
      getShowAsChoice(
        { ...metricValue(""), draftMetric: draft },
        undefined,
        () => null,
      ),
    ).toEqual(mean("per_unit"));
  });

  it("offers no options for non-metric values", () => {
    const factTableValue: ProductAnalyticsValue = {
      type: "fact_table",
      name: "Events",
      valueType: "count",
      valueColumn: null,
      unit: null,
      rowFilters: [],
    };
    expect(
      getShowAsChoice(factTableValue, undefined, getFactMetricById),
    ).toEqual(none);
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

describe("omitRenderOnlyFields", () => {
  it("ignores render-only fields", () => {
    expect(
      omitRenderOnlyFields({
        ...metricValue("revenue", "per_unit"),
        name: "A",
      }),
    ).toEqual(omitRenderOnlyFields({ ...metricValue("revenue"), name: "B" }));
  });

  it("distinguishes values that query differently", () => {
    expect(
      omitRenderOnlyFields(metricValue("revenue", undefined, "user_id")),
    ).not.toEqual(
      omitRenderOnlyFields(metricValue("revenue", undefined, "device_id")),
    );
  });
});

describe("getDefaultValueAxisName", () => {
  it("names the shared mode", () => {
    expect(
      getDefaultValueAxisName(
        getExplorationRenderOpts(
          metricConfig([
            metricValue("revenue", "per_unit"),
            metricValue("maxOrder"),
          ]),
          getFactMetricById,
        ),
      ),
    ).toBe("Per user_id");
  });

  it("ignores values that offer no options", () => {
    expect(
      getDefaultValueAxisName(
        getExplorationRenderOpts(
          metricConfig([metricValue("revenue"), metricValue("converted")]),
          getFactMetricById,
        ),
      ),
    ).toBe("Total");
  });

  it("is empty when a per-unit value shares the axis with a proportion", () => {
    expect(
      getDefaultValueAxisName(
        getExplorationRenderOpts(
          metricConfig([
            metricValue("revenue", "per_unit"),
            metricValue("converted"),
          ]),
          getFactMetricById,
        ),
      ),
    ).toBe("");
  });

  it("is empty when no value offers options", () => {
    expect(
      getDefaultValueAxisName(
        getExplorationRenderOpts(
          metricConfig([metricValue("converted")]),
          getFactMetricById,
        ),
      ),
    ).toBe("");
  });

  it("is empty when values render in different modes", () => {
    expect(
      getDefaultValueAxisName(
        getExplorationRenderOpts(
          metricConfig([
            metricValue("revenue", "total"),
            metricValue("revenue", "per_unit"),
          ]),
          getFactMetricById,
        ),
      ),
    ).toBe("");
  });

  it("is empty when a ratio shares the axis, since a ratio isn't a total", () => {
    expect(
      getDefaultValueAxisName(
        getExplorationRenderOpts(
          metricConfig([metricValue("revenue", "total"), metricValue("aov")]),
          getFactMetricById,
        ),
      ),
    ).toBe("");
  });
});

describe("getEffectiveMetricValue", () => {
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
    expect(
      [0, 1, 2].map((i) => getEffectiveMetricValue(cell, opts.values[i])),
    ).toEqual([100, 25, 100]);
  });
});

describe("isRatioValue", () => {
  it("is true only for values whose metric is a ratio", () => {
    expect(isRatioValue(metricValue("aov"), getFactMetricById)).toBe(true);
    expect(isRatioValue(metricValue("revenue"), getFactMetricById)).toBe(false);
    expect(isRatioValue(metricValue(""), getFactMetricById)).toBe(false);
  });
});

describe("getEffectiveMetricValue for ratios", () => {
  it("divides numerator by denominator whatever the showAs", () => {
    const [opts] = getExplorationRenderOpts(
      metricConfig([metricValue("aov", "total")]),
      getFactMetricById,
    ).values;
    expect(
      getEffectiveMetricValue({ numerator: 100, denominator: 4 }, opts),
    ).toBe(25);
  });
});

describe("withRequestedDisplayConfig", () => {
  it("serves a cached result with the requested names and showAs", () => {
    const cached = {
      config: metricConfig([
        {
          ...metricValue("revenue", "per_unit", "device_id"),
          name: "Old name",
        },
        metricValue("maxOrder", undefined, "device_id"),
      ]),
      result: { rows: [] },
    } as unknown as ProductAnalyticsExploration;
    // The requested unit differs from the cached one, so a result that copied
    // the whole requested dataset would fail: only names and showAs carry over.
    const requested = metricConfig([
      { ...metricValue("revenue", undefined, "user_id"), name: "New name" },
      metricValue("maxOrder", "total", "user_id"),
    ]);
    expect(
      withRequestedDisplayConfig(cached, requested).config.dataset,
    ).toEqual({
      type: "metric",
      values: [
        { ...metricValue("revenue", undefined, "device_id"), name: "New name" },
        metricValue("maxOrder", "total", "device_id"),
      ],
    });
  });
});

describe("seriesName", () => {
  const names = (config: ExplorationConfig) =>
    getExplorationRenderOpts(config, getFactMetricById).values.map(
      (opts) => opts.seriesName,
    );

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

  it("keeps the note in labels, which have no axis title beside them", () => {
    expect(
      getExplorationRenderOpts(
        metricConfig([
          metricValue("revenue", "per_unit"),
          metricValue("maxOrder"),
        ]),
        getFactMetricById,
      ).values.map((opts) => opts.label),
    ).toEqual(["revenue (per user_id)", "maxOrder (per user_id)"]);
  });

  it("annotates a per-unit value whose metric hasn't loaded", () => {
    expect(names(metricConfig([metricValue("loading", "per_unit")]))).toEqual([
      "loading (per user_id)",
    ]);
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

  it("never annotates a ratio, which is neither a total nor per unit", () => {
    expect(
      names(
        metricConfig([metricValue("revenue", "per_unit"), metricValue("aov")]),
      ),
    ).toEqual(["revenue (per user_id)", "aov"]);
    expect(
      names(
        metricConfig([metricValue("revenue", "total"), metricValue("aov")]),
      ),
    ).toEqual(["revenue (total)", "aov"]);
  });

  it("annotates per-unit values under a custom axis title", () => {
    expect(
      names({
        ...metricConfig([metricValue("revenue", "per_unit")]),
        chartSettings: { valueAxisLabel: "Revenue" },
      }),
    ).toEqual(["revenue (per user_id)"]);
  });

  it("names a blank value by its position, keeping the mode note", () => {
    expect(
      names(
        metricConfig([
          metricValue("revenue", "per_unit"),
          { ...metricValue("converted"), name: "  " },
        ]),
      ),
    ).toEqual(["revenue (per user_id)", "Metric 2 (total)"]);
  });

  it("names a blank value by its position when names aren't annotated", () => {
    expect(
      names(metricConfig([{ ...metricValue("revenue"), name: "" }])),
    ).toEqual(["Metric 1"]);
  });
});

describe("buildExplorationColumns", () => {
  const labels = (config: ExplorationConfig) =>
    buildExplorationColumns(
      config,
      getExplorationRenderOpts(config, getFactMetricById),
    )
      .filter((col) => col.kind === "metric")
      .map((col) => col.label);

  it("labels only per-unit columns when no column is a total", () => {
    expect(
      labels(
        metricConfig([
          metricValue("revenue", "per_unit"),
          metricValue("maxOrder", "per_unit"),
        ]),
      ),
    ).toEqual(["revenue (per user_id)", "maxOrder (per user_id)"]);
  });

  it("keeps plain headers when every column is a total", () => {
    expect(
      labels(
        metricConfig([
          metricValue("revenue", "total"),
          metricValue("converted"),
        ]),
      ),
    ).toEqual(["revenue", "converted"]);
  });

  it("splits ratio metrics into numerator, denominator and value columns", () => {
    expect(labels(metricConfig([metricValue("aov")]))).toEqual([
      "aov Numerator",
      "aov Denominator",
      "aov Value",
    ]);
  });

  it("labels totals when they sit beside per-unit columns", () => {
    expect(
      labels(
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
});
