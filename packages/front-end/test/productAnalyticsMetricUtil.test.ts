import { describe, expect, it } from "vitest";
import type {
  FactMetricInterface,
  FactTableDefinition,
} from "shared/types/fact-table";
import type { ExplorationConfig, MetricValue, ShowAs } from "shared/validators";
import {
  fillMissingUnits,
  getMetricValuesUnitState,
  metricSupportsUnitSelection,
  setMetricValuesUnit,
  toFetchKey,
} from "@/enterprise/components/ProductAnalytics/util";

function metricConfig(showAs?: ShowAs): ExplorationConfig {
  return {
    type: "metric",
    datasource: "ds",
    chartType: "line",
    dimensions: [],
    dateRange: { predefined: "last30Days" },
    dataset: {
      type: "metric",
      values: [
        {
          type: "metric",
          name: "Revenue",
          metricId: "revenue",
          unit: "user_id",
          denominatorUnit: null,
          rowFilters: [],
          ...(showAs ? { showAs } : {}),
        },
      ],
    },
  };
}

describe("toFetchKey", () => {
  it("ignores per-value showAs, which only affects rendering", () => {
    expect(toFetchKey(metricConfig("per_unit"))).toEqual(
      toFetchKey(metricConfig()),
    );
  });
});

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

describe("fillMissingUnits", () => {
  it("fills a missing unit with the unit the other metrics share", () => {
    const config: ExplorationConfig = {
      type: "metric",
      datasource: "ds",
      chartType: "line",
      dimensions: [],
      dateRange: { predefined: "last30Days" },
      dataset: {
        type: "metric",
        // revenue's Fact Table lists user_id first, so only the shared
        // device_id preference explains a device_id result.
        values: [value("installs", "device_id"), value("revenue", null)],
      },
    };
    const filled = fillMissingUnits(
      config,
      getFactTableById,
      getFactMetricById,
    );
    expect(
      filled.dataset.type === "metric" &&
        filled.dataset.values.map((v) => v.unit),
    ).toEqual(["device_id", "device_id"]);
  });
});
