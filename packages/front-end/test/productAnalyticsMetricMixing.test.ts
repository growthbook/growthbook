import { describe, expect, it } from "vitest";
import type {
  FactMetricInterface,
  FactTableDefinition,
} from "shared/types/fact-table";
import type { MetricValue } from "shared/validators";
import { metricSupportsUnitSelection } from "shared/enterprise";
import {
  getAddMetricConflict,
  getMetricChartPopulationViolations,
  getLockedMixClass,
  getMetricValuesUnitState,
  getMixClassConflict,
  getPopulationConflict,
  getPopulationFactTableId,
  getUnitConflict,
  orderEnabledOptionsFirst,
  populationFitsMetricChart,
  setMetricValuesUnit,
} from "@/enterprise/components/ProductAnalytics/metricMixing";

function makeMetric(
  id: string,
  metricType: FactMetricInterface["metricType"],
  factTableId: string,
  column = "amount",
): FactMetricInterface {
  return {
    id,
    name: id,
    metricType,
    numerator: { factTableId, column, aggregation: "sum" },
    denominator: null,
  } as FactMetricInterface;
}

const metrics = new Map(
  [
    makeMetric("revenue", "mean", "users_and_devices"),
    makeMetric("signups", "proportion", "users_only"),
    makeMetric("installs", "mean", "devices_only"),
    makeMetric("p95", "quantile", "devices_only"),
  ].map((m) => [m.id, m]),
);
const factTables = new Map(
  [
    { id: "users_and_devices", userIdTypes: ["user_id", "device_id"] },
    { id: "users_only", userIdTypes: ["user_id"] },
    { id: "devices_only", userIdTypes: ["device_id"] },
  ].map((ft) => [ft.id, ft as FactTableDefinition]),
);
const getFactMetricById = (id: string) => metrics.get(id) ?? null;
const getFactTableById = (id: string) => factTables.get(id) ?? null;

function value(metricId: string, unit: string | null): MetricValue {
  return {
    type: "metric",
    name: metricId,
    metricId,
    unit,
    denominatorUnit: null,
    rowFilters: [],
  };
}

const RATIO_CONFLICT = "Ratio metrics can't be combined with other metrics.";
const QUANTILE_CONFLICT =
  "Quantile metrics can't be combined with other metrics.";

describe("getLockedMixClass", () => {
  it("locks to the first selected metric's class, skipping empty slots", () => {
    expect(getLockedMixClass([undefined, "ratio", "mean"])).toBe("ratio");
    expect(getLockedMixClass(["proportion"])).toBe("standard");
  });

  it("locks nothing when no metric is selected", () => {
    expect(getLockedMixClass([undefined, null])).toBeNull();
  });
});

describe("getMixClassConflict", () => {
  it("lets standard metric types mix", () => {
    expect(getMixClassConflict("mean", "standard")).toBeNull();
    expect(getMixClassConflict("proportion", "standard")).toBeNull();
  });

  it("allows anything when nothing is locked", () => {
    expect(getMixClassConflict("quantile", null)).toBeNull();
  });

  it("names the ratio or quantile being added to a standard chart", () => {
    expect(getMixClassConflict("ratio", "standard")).toBe(RATIO_CONFLICT);
    expect(getMixClassConflict("quantile", "standard")).toBe(QUANTILE_CONFLICT);
  });

  it("names the chart's class when it's ratio or quantile", () => {
    expect(getMixClassConflict("mean", "ratio")).toBe(RATIO_CONFLICT);
    expect(getMixClassConflict("mean", "quantile")).toBe(QUANTILE_CONFLICT);
  });

  it("allows another metric of the same exclusive class", () => {
    expect(getMixClassConflict("ratio", "ratio")).toBeNull();
  });
});

describe("getAddMetricConflict", () => {
  it("blocks adding beside a ratio or quantile, skipping empty slots", () => {
    expect(getAddMetricConflict([undefined, "ratio"])).toBe(RATIO_CONFLICT);
    expect(getAddMetricConflict(["quantile"])).toBe(QUANTILE_CONFLICT);
  });

  it("allows adding beside standard metrics or an empty chart", () => {
    expect(getAddMetricConflict(["mean", "proportion"])).toBeNull();
    expect(getAddMetricConflict([])).toBeNull();
  });
});

describe("getUnitConflict", () => {
  it("rejects a metric whose Fact Table lacks the chart's unit", () => {
    expect(
      getUnitConflict(metrics.get("signups")!, "device_id", getFactTableById),
    ).toBe(
      "This metric's Fact Table has no device_id identifier type. Change the identifier type below to use it.",
    );
  });

  it("accepts a metric whose Fact Table offers the chart's unit", () => {
    expect(
      getUnitConflict(metrics.get("revenue")!, "device_id", getFactTableById),
    ).toBeNull();
  });

  it("accepts any metric when no unit is locked", () => {
    expect(
      getUnitConflict(metrics.get("signups")!, null, getFactTableById),
    ).toBeNull();
  });

  it("ignores the unit for metrics whose unit can't be chosen", () => {
    // p95's Fact Table has no user_id, but quantiles keep their own unit.
    expect(
      getUnitConflict(metrics.get("p95")!, "user_id", getFactTableById),
    ).toBeNull();
  });
});

describe("metricSupportsUnitSelection", () => {
  it("allows unit-counted metrics and distinct-user ratios", () => {
    expect(metricSupportsUnitSelection(metrics.get("revenue")!)).toBe(true);
    expect(metricSupportsUnitSelection(metrics.get("p95")!)).toBe(false);
    expect(
      metricSupportsUnitSelection(
        makeMetric("r", "ratio", "users_only", "$$distinctUsers"),
      ),
    ).toBe(true);
    expect(metricSupportsUnitSelection(makeMetric("r", "ratio", "x"))).toBe(
      false,
    );
    expect(metricSupportsUnitSelection(null)).toBe(false);
  });
});

describe("getMetricValuesUnitState", () => {
  const state = (values: MetricValue[]) =>
    getMetricValuesUnitState(values, getFactMetricById, getFactTableById);

  it("reports the one unit the metrics share", () => {
    expect(
      state([value("revenue", "user_id"), value("signups", "user_id")]),
    ).toEqual({ unit: "user_id", isMixed: false, options: ["user_id"] });
  });

  it("flags a config whose metrics use different units", () => {
    expect(
      state([value("revenue", "device_id"), value("signups", "user_id")]),
    ).toEqual({ unit: null, isMixed: true, options: ["user_id"] });
  });

  it("offers no units when the Fact Tables share none", () => {
    expect(
      state([value("signups", "user_id"), value("installs", "device_id")])
        .options,
    ).toEqual([]);
  });

  it("ignores metrics whose unit can't be chosen and empty slots", () => {
    expect(
      state([
        value("revenue", "user_id"),
        value("p95", "device_id"),
        value("", null),
      ]),
    ).toEqual({
      unit: "user_id",
      isMixed: false,
      options: ["user_id", "device_id"],
    });
  });
});

describe("setMetricValuesUnit", () => {
  it("sets the unit only on metrics whose unit can be chosen", () => {
    expect(
      setMetricValuesUnit(
        [value("revenue", "device_id"), value("p95", "device_id")],
        "user_id",
        getFactMetricById,
      ).map((v) => v.unit),
    ).toEqual(["user_id", "device_id"]);
  });
});

describe("getPopulationFactTableId", () => {
  const populationMetrics = new Map(
    [
      makeMetric("signups", "proportion", "users_only"),
      makeMetric("purchases", "proportion", "users_only"),
      makeMetric("installs", "proportion", "devices_only"),
      makeMetric("revenue", "mean", "users_only"),
      makeMetric("p95", "quantile", "users_only"),
    ].map((m) => [m.id, m]),
  );
  const getMetric = (id: string) => populationMetrics.get(id) ?? null;

  it("returns the Fact Table every metric shares", () => {
    expect(
      getPopulationFactTableId(
        [value("signups", "user_id"), value("purchases", "user_id")],
        getMetric,
      ),
    ).toBe("users_only");
    expect(
      getPopulationFactTableId(
        [value("signups", "user_id"), value("revenue", "user_id")],
        getMetric,
      ),
    ).toBe("users_only");
  });

  it("returns null when a metric's type can't take a Population", () => {
    expect(
      getPopulationFactTableId(
        [value("signups", "user_id"), value("p95", "user_id")],
        getMetric,
      ),
    ).toBeNull();
  });

  it("returns null when the metrics use different Fact Tables", () => {
    expect(
      getPopulationFactTableId(
        [value("signups", "user_id"), value("installs", "device_id")],
        getMetric,
      ),
    ).toBeNull();
  });

  it("returns null when there are no metrics or every slot is empty", () => {
    expect(getPopulationFactTableId([], getMetric)).toBeNull();
    expect(getPopulationFactTableId([value("", null)], getMetric)).toBeNull();
  });

  it("skips an empty slot next to a proportion", () => {
    expect(
      getPopulationFactTableId(
        [value("signups", "user_id"), value("", null)],
        getMetric,
      ),
    ).toBe("users_only");
  });

  it("skips a metric that hasn't loaded yet", () => {
    expect(
      getPopulationFactTableId(
        [value("signups", "user_id"), value("loading", "user_id")],
        getMetric,
      ),
    ).toBe("users_only");
    expect(
      getPopulationFactTableId([value("loading", "user_id")], getMetric),
    ).toBeNull();
  });
});

describe("orderEnabledOptionsFirst", () => {
  const option = (value: string) => ({ label: value, value });
  const isDisabled = (value: string) => value.startsWith("off");

  it("moves enabled options first, keeping each set's order", () => {
    expect(
      orderEnabledOptionsFirst(
        ["off1", "on1", "off2", "on2"].map(option),
        isDisabled,
      ),
    ).toEqual(["on1", "on2", "off1", "off2"].map(option));
  });

  it("orders within each group, keeping the groups in place", () => {
    expect(
      orderEnabledOptionsFirst(
        [
          { label: "Official", options: ["off1", "on1"].map(option) },
          { label: "", options: ["off2", "on2"].map(option) },
        ],
        isDisabled,
      ),
    ).toEqual([
      { label: "Official", options: ["on1", "off1"].map(option) },
      { label: "", options: ["on2", "off2"].map(option) },
    ]);
  });
});

describe("populationFitsMetricChart", () => {
  type Candidate = Parameters<typeof populationFitsMetricChart>[0];
  type Chart = Parameters<typeof populationFitsMetricChart>[1];
  const step = {
    source: { type: "factTable" as const, factTableId: "users_only" },
    rowFilters: [],
  };
  const candidate: Candidate = {
    id: "pop_1",
    projects: [],
    datasource: "ds",
    userIdTypes: ["user_id"],
    steps: [step],
  };
  const chart: Chart = {
    project: "",
    datasource: "ds",
    factTableId: "users_only",
    unit: "user_id",
  };

  it("offers a Population that matches the chart", () => {
    expect(populationFitsMetricChart(candidate, chart)).toBe(true);
  });

  it("offers any identifier type before one is chosen", () => {
    expect(
      populationFitsMetricChart(
        { ...candidate, userIdTypes: ["device_id"] },
        { ...chart, unit: null },
      ),
    ).toBe(true);
  });

  it.each<[string, Partial<Candidate>, Partial<Chart>]>([
    ["in another Project", { projects: ["other"] }, { project: "current" }],
    ["on another Data Source", { datasource: "other" }, {}],
    ["on another Fact Table", {}, { factTableId: "devices_only" }],
    ["when the metrics share no Fact Table", {}, { factTableId: null }],
    ["without the chart's identifier type", {}, { unit: "device_id" }],
    ["with more than one step", { steps: [step, step] }, {}],
  ])("skips a Population %s", (_, candidateChanges, chartChanges) => {
    expect(
      populationFitsMetricChart(
        { ...candidate, ...candidateChanges },
        { ...chart, ...chartChanges },
      ),
    ).toBe(false);
  });
});

describe("getMetricChartPopulationViolations", () => {
  const factTable = {
    id: "users_only",
    datasource: "ds",
    userIdTypes: ["user_id"],
    columns: [{ column: "country", datatype: "string" }],
    filters: [],
  } as unknown as Parameters<
    typeof getMetricChartPopulationViolations
  >[0]["factTables"][number];
  const check = (
    overrides: Partial<
      Parameters<typeof getMetricChartPopulationViolations>[0]
    > = {},
  ) =>
    getMetricChartPopulationViolations({
      population: { populationId: "pop_1", unit: "user_id" },
      savedPopulation: {
        datasource: "ds",
        userIdTypes: ["user_id"],
        steps: [
          {
            source: { type: "factTable", factTableId: "users_only" },
            rowFilters: [{ operator: "=", column: "country", values: ["US"] }],
          },
        ],
      },
      values: [value("signups", "user_id")],
      dimensions: [],
      datasource: "ds",
      getFactMetricById,
      factTables: [factTable],
      ...overrides,
    });

  it("is empty when the Population fits", () => {
    expect(check()).toEqual([]);
  });

  it("explains a deleted or unreadable Population", () => {
    expect(check({ savedPopulation: null })).toEqual([
      "This Population was deleted or you don't have access to it. Choose another Population or None.",
    ]);
  });

  it("skips values without a metric chosen yet", () => {
    expect(
      check({ values: [value("signups", "user_id"), value("", null)] }),
    ).toEqual([]);
  });

  it("reports a metric that can't be resolved", () => {
    expect(check({ getFactMetricById: () => null })).toEqual([
      "Metric signups not found.",
    ]);
  });
});

describe("getPopulationConflict", () => {
  const usersOnly = { id: "users_only", name: "Users" };

  it("allows a proportion or mean on the Population's Fact Table", () => {
    expect(
      getPopulationConflict(
        metrics.get("signups")!,
        usersOnly,
        getFactTableById,
      ),
    ).toBeNull();
    expect(
      getPopulationConflict(
        makeMetric("revenue_users", "mean", "users_only"),
        usersOnly,
        getFactTableById,
      ),
    ).toBeNull();
  });

  it("rejects another metric type, naming it as the type picker does", () => {
    expect(
      getPopulationConflict(
        makeMetric("p95_users", "quantile", "users_only"),
        usersOnly,
        getFactTableById,
      ),
    ).toBe("Percentile metrics can't be combined with a Population.");
  });

  it("rejects a mean with percentile capping, saying what to use instead", () => {
    expect(
      getPopulationConflict(
        {
          ...makeMetric("revenue_users", "mean", "users_only"),
          cappingSettings: { type: "percentile", value: 0.99 },
        },
        usersOnly,
        getFactTableById,
      ),
    ).toBe(
      "Metrics with percentile capping can't be combined with a Population. Use an absolute cap or no cap instead.",
    );
  });

  it("rejects a proportion on another Fact Table, naming the right one", () => {
    expect(
      getPopulationConflict(
        metrics.get("signups")!,
        { id: "devices_only", name: "Devices" },
        getFactTableById,
      ),
    ).toBe(
      "Charts with this Population only support metrics on the Devices Fact Table.",
    );
  });

  it("falls back to a generic reason when the Fact Table's name is unknown", () => {
    expect(
      getPopulationConflict(
        metrics.get("signups")!,
        { id: "devices_only", name: null },
        getFactTableById,
      ),
    ).toBe("This metric doesn't use the Population's Fact Table.");
  });
});
