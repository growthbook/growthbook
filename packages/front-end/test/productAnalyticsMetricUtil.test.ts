import { describe, expect, it } from "vitest";
import type {
  FactMetricInterface,
  FactTableDefinition,
} from "shared/types/fact-table";
import type { ExplorationConfig, MetricValue, ShowAs } from "shared/validators";
import {
  fillMissingUnits,
  toFetchKey,
} from "@/enterprise/components/ProductAnalytics/util";

function metricConfig(showAs?: ShowAs, unit = "user_id"): ExplorationConfig {
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
          unit,
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

  it("changes when a value's unit changes, which changes the query", () => {
    expect(toFetchKey(metricConfig(undefined, "device_id"))).not.toEqual(
      toFetchKey(metricConfig(undefined, "user_id")),
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
    makeMetric("p50", "quantile", "users_only"),
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

  it("ignores units of metrics whose unit can't be chosen", () => {
    const config: ExplorationConfig = {
      type: "metric",
      datasource: "ds",
      chartType: "line",
      dimensions: [],
      dateRange: { predefined: "last30Days" },
      dataset: {
        type: "metric",
        // The quantile's user_id doesn't make the chart's unit mixed.
        values: [
          value("installs", "device_id"),
          value("p50", "user_id"),
          value("revenue", null),
        ],
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
    ).toEqual(["device_id", "user_id", "device_id"]);
  });

  it("falls back to the Fact Table's first unit when it lacks the shared one", () => {
    const config: ExplorationConfig = {
      type: "metric",
      datasource: "ds",
      chartType: "line",
      dimensions: [],
      dateRange: { predefined: "last30Days" },
      dataset: {
        type: "metric",
        // signups' Fact Table only offers user_id, so it can't join device_id.
        values: [value("installs", "device_id"), value("signups", null)],
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
    ).toEqual(["device_id", "user_id"]);
  });
});
