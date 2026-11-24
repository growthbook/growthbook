import {
  buildExplorationColumns,
  getExplorationCellValue,
  getDefaultValueAxisName,
  getEffectiveMetricValue,
  getSecondaryValueAxisName,
  getExplorationRenderOpts,
  dividesByPopulationCount,
  getShowAsChoice,
  getShowAsOptions,
  hasShowAsChoice,
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
    makeMetric("p90", "quantile"),
    makeMetric("retained", "retention"),
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
const none = { options: [], showAs: null };
const proportionTotal = { options: ["total"], showAs: "total" };
const mean = (showAs: ShowAs) => ({ options: MEAN_OPTIONS, showAs });

describe("getShowAsOptions", () => {
  it("lists the modes of every metric type", () => {
    expect(getShowAsOptions("mean", false)).toEqual(MEAN_OPTIONS);
    expect(getShowAsOptions("proportion", false)).toEqual(["total"]);
    expect(getShowAsOptions("retention", false)).toEqual(["total"]);
    expect(getShowAsOptions("dailyParticipation", false)).toEqual(["total"]);
    expect(getShowAsOptions("ratio", false)).toEqual([]);
    expect(getShowAsOptions("quantile", false)).toEqual([]);
    expect(getShowAsOptions("funnel", false)).toEqual([]);
    expect(getShowAsOptions("compound", false)).toEqual([]);
    expect(getShowAsOptions(undefined, false)).toEqual([]);
  });

  it("adds population modes only to means and proportions", () => {
    expect(getShowAsOptions("retention", true)).toEqual(["total"]);
    expect(getShowAsOptions("dailyParticipation", true)).toEqual(["total"]);
    expect(getShowAsOptions("ratio", true)).toEqual([]);
  });
});

describe("getShowAsChoice", () => {
  it("resolves each mean metric independently", () => {
    expect(
      getShowAsChoice(
        metricValue("revenue", "per_unit"),
        undefined,
        getFactMetricById,
        false,
      ),
    ).toEqual(mean("per_unit"));
    expect(
      getShowAsChoice(
        metricValue("revenue", "total"),
        undefined,
        getFactMetricById,
        false,
      ),
    ).toEqual(mean("total"));
  });

  it("infers the default from each metric's own aggregation", () => {
    expect(
      getShowAsChoice(
        metricValue("revenue"),
        undefined,
        getFactMetricById,
        false,
      ),
    ).toEqual(mean("total"));
    expect(
      getShowAsChoice(
        metricValue("maxOrder"),
        undefined,
        getFactMetricById,
        false,
      ),
    ).toEqual(mean("per_unit"));
  });

  it("renders other metric types as totals, ignoring a mode they don't offer", () => {
    expect(
      getShowAsChoice(
        metricValue("converted", "per_unit"),
        undefined,
        getFactMetricById,
        false,
      ),
    ).toEqual(proportionTotal);
    expect(
      getShowAsChoice(metricValue("aov"), undefined, getFactMetricById, false),
    ).toEqual(none);
  });

  it("offers no options for a slot with no metric selected", () => {
    expect(
      getShowAsChoice(metricValue(""), undefined, getFactMetricById, false),
    ).toEqual(none);
  });

  it("offers only the saved choice when the metric isn't found", () => {
    expect(
      getShowAsChoice(
        metricValue("loading", "per_unit"),
        undefined,
        getFactMetricById,
        false,
      ),
    ).toEqual({ options: ["per_unit"], showAs: "per_unit" });
    expect(
      getShowAsChoice(
        metricValue("loading"),
        "per_unit",
        getFactMetricById,
        false,
      ),
    ).toEqual({ options: ["per_unit"], showAs: "per_unit" });
    // A total could belong to a mean or a proportion with a population.
    expect(
      getShowAsChoice(
        metricValue("loading", "total"),
        undefined,
        getFactMetricById,
        true,
      ),
    ).toEqual({ options: ["total"], showAs: "total" });
  });

  it("offers no choice for an unloaded value without a saved choice", () => {
    expect(
      getShowAsChoice(
        metricValue("loading"),
        undefined,
        getFactMetricById,
        false,
      ),
    ).toEqual(none);
    expect(
      getShowAsChoice(
        metricValue("", "per_unit"),
        undefined,
        getFactMetricById,
        false,
      ),
    ).toEqual(none);
  });

  it("falls back to the deprecated config-level showAs", () => {
    expect(
      getShowAsChoice(
        metricValue("revenue"),
        "per_unit",
        getFactMetricById,
        false,
      ),
    ).toEqual(mean("per_unit"));
  });

  it("prefers the value's own showAs over the config-level one", () => {
    expect(
      getShowAsChoice(
        metricValue("revenue", "total"),
        "per_unit",
        getFactMetricById,
        false,
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
        false,
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
      getShowAsChoice(factTableValue, undefined, getFactMetricById, false),
    ).toEqual(none);
  });
});

describe("hasShowAsChoice", () => {
  it("shows a picker only when there is more than one mode", () => {
    expect(hasShowAsChoice(getShowAsOptions("mean", false))).toBe(true);
    expect(hasShowAsChoice(getShowAsOptions("proportion", false))).toBe(false);
    expect(hasShowAsChoice(getShowAsOptions("proportion", true))).toBe(true);
    expect(hasShowAsChoice(getShowAsOptions("ratio", true))).toBe(false);
    expect(hasShowAsChoice(["per_unit"])).toBe(false);
  });
});

describe("dividesByPopulationCount", () => {
  it("is true only for the modes a population adds", () => {
    expect(dividesByPopulationCount("percent_of_population")).toBe(true);
    expect(dividesByPopulationCount("per_population_member")).toBe(true);
    expect(dividesByPopulationCount("total")).toBe(false);
    expect(dividesByPopulationCount("per_unit")).toBe(false);
    expect(dividesByPopulationCount(null)).toBe(false);
    expect(dividesByPopulationCount(undefined)).toBe(false);
  });
});

describe("normalizeShowAs", () => {
  it("keeps total on a proportion without a population", () => {
    const config = metricConfig([metricValue("converted", "total")]);
    expect(normalizeShowAs(config, getFactMetricById)).toBe(config);
  });

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

  it("keeps showAs on values whose metric isn't found", () => {
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

  it("names the total when a mean and a proportion both render as totals", () => {
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

  it("names the total when every value is a proportion", () => {
    expect(
      getDefaultValueAxisName(
        getExplorationRenderOpts(
          metricConfig([metricValue("converted"), metricValue("converted")]),
          getFactMetricById,
        ),
      ),
    ).toBe("Total");
  });

  it("is empty for a ratio, which offers no options and isn't a total", () => {
    expect(
      getDefaultValueAxisName(
        getExplorationRenderOpts(
          metricConfig([metricValue("aov")]),
          getFactMetricById,
        ),
      ),
    ).toBe("");
  });

  it("names the total when every value is a retention metric", () => {
    expect(
      getDefaultValueAxisName(
        getExplorationRenderOpts(
          metricConfig([metricValue("retained"), metricValue("retained")]),
          getFactMetricById,
        ),
      ),
    ).toBe("Total");
  });

  it.each(["aov", "p90"])(
    "is empty when a count metric shares the chart with %s, which has no mode",
    (metricId) => {
      const opts = getExplorationRenderOpts(
        metricConfig([metricValue("converted"), metricValue(metricId)]),
        getFactMetricById,
      );
      expect(getDefaultValueAxisName(opts)).toBe("");
      // Only the value with a mode is annotated.
      expect(opts.values.map((v) => v.seriesName)).toEqual([
        "converted (total)",
        metricId,
      ]);
    },
  );

  it("leaves the primary axis untitled when a ratio sits beside % of Population", () => {
    const values = [
      metricValue("converted", "percent_of_population"),
      metricValue("aov"),
    ];
    const opts = getExplorationRenderOpts(
      {
        ...metricConfig(values),
        dataset: {
          type: "metric",
          values,
          population: { populationId: "pop", unit: "user_id" },
        },
      },
      getFactMetricById,
    );
    expect(getSecondaryValueAxisName(opts)).toBe("% of Population");
    expect(getDefaultValueAxisName(opts)).toBe("");
  });

  it("ignores a value whose metric isn't found", () => {
    expect(
      getDefaultValueAxisName(
        getExplorationRenderOpts(
          metricConfig([metricValue("converted"), metricValue("loading")]),
          getFactMetricById,
        ),
      ),
    ).toBe("Total");
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
      [0, 1, 2].map((i) =>
        getEffectiveMetricValue(cell, opts.values[i], undefined),
      ),
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
      getEffectiveMetricValue(
        { numerator: 100, denominator: 4 },
        opts,
        undefined,
      ),
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

  it("keeps the requested Population when another one's rules match", () => {
    const withPopulation = (populationId: string): ExplorationConfig => {
      const config = metricConfig([metricValue("converted")]);
      return {
        ...config,
        dataset: {
          type: "metric",
          values: [metricValue("converted")],
          population: { populationId, unit: "user_id" },
        },
      };
    };
    const cached = {
      config: withPopulation("pop_a"),
      result: { rows: [] },
    } as unknown as ProductAnalyticsExploration;
    const served = withRequestedDisplayConfig(cached, withPopulation("pop_b"));
    expect(
      served.config.dataset.type === "metric" &&
        served.config.dataset.population,
    ).toEqual({ populationId: "pop_b", unit: "user_id" });
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

describe("proportions with a population", () => {
  const population = { populationId: "pop_1", unit: "user_id" };
  function populationConfig(values: MetricValue[]): ExplorationConfig {
    const config = metricConfig(values);
    if (config.dataset.type === "metric")
      config.dataset.population = population;
    return config;
  }

  it("offers percent of population only with a population", () => {
    expect(getShowAsOptions("proportion", true)).toEqual([
      "total",
      "percent_of_population",
    ]);
    expect(getShowAsOptions("proportion", false)).toEqual(["total"]);
  });

  it("defaults to % of Population, keeping an explicit choice", () => {
    const options = ["total", "percent_of_population"];
    expect(
      getShowAsChoice(
        metricValue("converted"),
        undefined,
        getFactMetricById,
        true,
      ),
    ).toEqual({ options, showAs: "percent_of_population" });
    expect(
      getShowAsChoice(
        metricValue("converted", "total"),
        undefined,
        getFactMetricById,
        true,
      ),
    ).toEqual({ options, showAs: "total" });
  });

  it("defaults proportions to totals without a population", () => {
    expect(
      getShowAsChoice(
        metricValue("converted"),
        undefined,
        getFactMetricById,
        false,
      ),
    ).toEqual(proportionTotal);
  });

  it("divides by the population count as a percentage", () => {
    const [opts] = getExplorationRenderOpts(
      populationConfig([metricValue("converted", "percent_of_population")]),
      getFactMetricById,
    ).values;
    const cell = { numerator: 25, denominator: 25 };
    expect(getEffectiveMetricValue(cell, opts, 200)).toBe(12.5);
    expect(
      getEffectiveMetricValue(
        { numerator: null, denominator: null },
        opts,
        200,
      ),
    ).toBe(0);
  });

  it("has no data when the row has no population members", () => {
    const config = populationConfig([
      metricValue("converted", "percent_of_population"),
    ]);
    const renderOpts = getExplorationRenderOpts(config, getFactMetricById);
    const [column] = buildExplorationColumns(config, renderOpts).filter(
      (c) => c.kind === "metric",
    );
    for (const populationCount of [0, undefined]) {
      for (const numerator of [0, null]) {
        const cell = { numerator, denominator: null };
        expect(
          getEffectiveMetricValue(cell, renderOpts.values[0], populationCount),
        ).toBeNull();
        expect(
          getExplorationCellValue(
            { dimensions: [], values: [cell], populationCount },
            column,
            renderOpts,
          ),
        ).toBeNull();
      }
    }
  });

  it("strips percent of population once the population is removed", () => {
    const withPopulation = populationConfig([
      metricValue("converted", "percent_of_population"),
    ]);
    expect(normalizeShowAs(withPopulation, getFactMetricById)).toBe(
      withPopulation,
    );
    const withoutPopulation = metricConfig([
      metricValue("converted", "percent_of_population"),
    ]);
    expect(
      normalizeShowAs(withoutPopulation, getFactMetricById).dataset,
    ).toEqual({ type: "metric", values: [metricValue("converted")] });
  });

  it("adds the Population count as the last table column", () => {
    const config = populationConfig([metricValue("converted")]);
    const renderOpts = getExplorationRenderOpts(config, getFactMetricById);
    const columns = buildExplorationColumns(config, renderOpts);
    const lastColumn = columns[columns.length - 1];
    expect(lastColumn).toEqual({
      kind: "populationCount",
      key: "__population_count__",
      label: "Population count",
    });
    const row = {
      dimensions: [],
      values: [{ numerator: 25, denominator: 25 }],
      populationCount: 200,
    };
    expect(getExplorationCellValue(row, lastColumn, renderOpts)).toBe(200);

    const withoutPopulation = metricConfig([metricValue("converted")]);
    const columnsWithoutPopulation = buildExplorationColumns(
      withoutPopulation,
      getExplorationRenderOpts(withoutPopulation, getFactMetricById),
    );
    for (const column of columnsWithoutPopulation) {
      expect(column.kind).not.toBe("populationCount");
    }
  });

  it("shows 0% in the table when no member converted", () => {
    const config = populationConfig([
      metricValue("converted", "percent_of_population"),
      metricValue("converted", "total"),
    ]);
    const renderOpts = getExplorationRenderOpts(config, getFactMetricById);
    const [percentColumn, totalColumn] = buildExplorationColumns(
      config,
      renderOpts,
    ).filter((column) => column.kind === "metric");
    const noConversions = { numerator: null, denominator: 0 };
    const row = {
      dimensions: [],
      values: [noConversions, noConversions],
      populationCount: 200,
    };
    expect(getExplorationCellValue(row, percentColumn, renderOpts)).toBe(0);
    expect(getExplorationCellValue(row, totalColumn, renderOpts)).toBeNull();
    expect(
      getExplorationCellValue(
        { ...row, populationCount: 0 },
        percentColumn,
        renderOpts,
      ),
    ).toBeNull();
  });

  it("moves % of Population to a right-hand axis when mixed with totals", () => {
    const renderOpts = getExplorationRenderOpts(
      populationConfig([
        metricValue("converted", "total"),
        metricValue("converted", "percent_of_population"),
      ]),
      getFactMetricById,
    );
    expect(renderOpts.values.map((v) => v.valueAxis)).toEqual([
      "primary",
      "secondary",
    ]);
    expect(getDefaultValueAxisName(renderOpts)).toBe("Total");
    expect(getSecondaryValueAxisName(renderOpts)).toBe("% of Population");
  });

  // Render opts don't depend on compare, so compare-mode bars get the same
  // second axis as a plain bar chart.
  it.each([
    ["a horizontal bar chart", "horizontalBar"],
    ["a stacked horizontal bar chart", "stackedHorizontalBar"],
    ["a bar chart, including in compare mode", "bar"],
  ] as const)(
    "gives % of Population its own axis for mixed modes on %s",
    (_, chartType) => {
      const renderOpts = getExplorationRenderOpts(
        {
          ...populationConfig([
            metricValue("converted", "total"),
            metricValue("converted", "percent_of_population"),
          ]),
          chartType,
        },
        getFactMetricById,
      );
      expect(renderOpts.values.map((v) => v.valueAxis)).toEqual([
        "primary",
        "secondary",
      ]);
      expect(getDefaultValueAxisName(renderOpts)).toBe("Total");
      expect(getSecondaryValueAxisName(renderOpts)).toBe("% of Population");
    },
  );

  it("keeps one axis when every value is a % of Population", () => {
    const renderOpts = getExplorationRenderOpts(
      populationConfig([
        metricValue("converted", "percent_of_population"),
        metricValue("converted", "percent_of_population"),
      ]),
      getFactMetricById,
    );
    expect(renderOpts.values.every((v) => v.valueAxis === "primary")).toBe(
      true,
    );
    expect(getSecondaryValueAxisName(renderOpts)).toBeNull();
    expect(getDefaultValueAxisName(renderOpts)).toBe("% of Population");
  });

  it("titles the value axis", () => {
    const renderOpts = getExplorationRenderOpts(
      populationConfig([metricValue("converted", "percent_of_population")]),
      getFactMetricById,
    );
    expect(getDefaultValueAxisName(renderOpts)).toBe("% of Population");
  });
});

describe("means with a population", () => {
  const population = { populationId: "pop_1", unit: "user_id" };
  function populationConfig(values: MetricValue[]): ExplorationConfig {
    const config = metricConfig(values);
    if (config.dataset.type === "metric")
      config.dataset.population = population;
    return config;
  }
  const options = ["total", "per_unit", "per_population_member"];

  it("offers per Population member only with a population", () => {
    expect(getShowAsOptions("mean", true)).toEqual(options);
    expect(getShowAsOptions("mean", false)).toEqual(MEAN_OPTIONS);
  });

  it("defaults every aggregation to per Population member, keeping an explicit choice", () => {
    for (const metricId of ["revenue", "maxOrder"]) {
      expect(
        getShowAsChoice(
          metricValue(metricId),
          undefined,
          getFactMetricById,
          true,
        ),
      ).toEqual({ options, showAs: "per_population_member" });
    }
    expect(
      getShowAsChoice(
        metricValue("revenue", "per_unit"),
        undefined,
        getFactMetricById,
        true,
      ),
    ).toEqual({ options, showAs: "per_unit" });
  });

  it("divides by every member, counting members without events as 0", () => {
    const config = populationConfig([
      metricValue("revenue", "per_population_member"),
    ]);
    const renderOpts = getExplorationRenderOpts(config, getFactMetricById);
    const [column] = buildExplorationColumns(config, renderOpts).filter(
      (c) => c.kind === "metric",
    );
    // 50 of the 200 members had events.
    const cell = { numerator: 500, denominator: 50 };
    expect(getEffectiveMetricValue(cell, renderOpts.values[0], 200)).toBe(2.5);
    expect(
      getExplorationCellValue(
        {
          dimensions: [],
          values: [{ numerator: null, denominator: 0 }],
          populationCount: 200,
        },
        column,
        renderOpts,
      ),
    ).toBe(0);
    for (const populationCount of [0, undefined]) {
      expect(
        getEffectiveMetricValue(cell, renderOpts.values[0], populationCount),
      ).toBeNull();
    }
  });

  it("strips per Population member once the population is removed", () => {
    const withoutPopulation = metricConfig([
      metricValue("revenue", "per_population_member"),
    ]);
    expect(
      normalizeShowAs(withoutPopulation, getFactMetricById).dataset,
    ).toEqual({ type: "metric", values: [metricValue("revenue")] });
  });

  it("names the axis, and shares it with other modes except % of Population", () => {
    const allPerMember = getExplorationRenderOpts(
      populationConfig([metricValue("revenue"), metricValue("maxOrder")]),
      getFactMetricById,
    );
    expect(getDefaultValueAxisName(allPerMember)).toBe("Per Population member");
    expect(allPerMember.values.map((v) => v.seriesName)).toEqual([
      "revenue",
      "maxOrder",
    ]);

    const mixed = getExplorationRenderOpts(
      populationConfig([
        metricValue("revenue"),
        metricValue("revenue", "per_unit"),
        metricValue("converted"),
      ]),
      getFactMetricById,
    );
    expect(mixed.values.map((v) => v.valueAxis)).toEqual([
      "primary",
      "primary",
      "secondary",
    ]);
    expect(mixed.values[0].seriesName).toBe("revenue (per Population member)");
    expect(getDefaultValueAxisName(mixed)).toBe("");
  });
});
