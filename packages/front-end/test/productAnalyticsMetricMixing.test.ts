import { describe, expect, it } from "vitest";
import type {
  FactMetricInterface,
  FactTableDefinition,
} from "shared/types/fact-table";
import type { MetricValue } from "shared/validators";
import { metricSupportsUnitSelection } from "shared/enterprise";
import {
  getAddMetricConflict,
  getLockedMixClass,
  getMetricValuesUnitState,
  getMixClassConflict,
  getUnitConflict,
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
    ).toBe("This metric's Fact Table has no device_id identifier type.");
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
