import { describe, expect, it } from "vitest";
import type {
  FactMetricInterface,
  FactTableDefinition,
} from "shared/types/fact-table";
import type { ExplorationConfig, MetricValue, ShowAs } from "shared/validators";
import {
  buildExplorationColumns,
  getExplorationRenderOpts,
  getShowAsChoice,
  getValueAxisName,
} from "@/enterprise/components/ProductAnalytics/util";
import {
  getReadOnlyUnit,
  getUnitPicker,
} from "@/enterprise/components/ProductAnalytics/metricMixing";

function makeMetric(
  id: string,
  metricType: FactMetricInterface["metricType"],
  factTableId: string,
  aggregation: "sum" | "max" = "sum",
): FactMetricInterface {
  return {
    id,
    name: id,
    metricType,
    numerator: { factTableId, column: "amount", aggregation },
    denominator: null,
  } as FactMetricInterface;
}

const metrics = new Map(
  [
    makeMetric("revenue", "mean", "users_and_devices"),
    makeMetric("maxOrder", "mean", "users_and_devices", "max"),
    makeMetric("signups", "proportion", "users_only"),
    makeMetric("installs", "mean", "devices_only"),
    makeMetric("aov", "ratio", "users_and_devices"),
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

function value(
  metricId: string,
  unit: string | null = "user_id",
  showAs?: ShowAs,
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

function metricChart(
  values: MetricValue[],
  valueAxisLabel?: string,
): ExplorationConfig {
  return {
    type: "metric",
    datasource: "ds",
    chartType: "line",
    dimensions: [],
    dateRange: { predefined: "last30Days" },
    dataset: { type: "metric", values },
    ...(valueAxisLabel !== undefined
      ? { chartSettings: { valueAxisLabel } }
      : {}),
  };
}

/**
 * Everything the Explorer shows about how a metric chart's values are
 * calculated, built from the same functions the components call.
 */
function describeExplorerDisplay(config: ExplorationConfig) {
  const values = config.dataset.type === "metric" ? config.dataset.values : [];
  return {
    axisTitle: getValueAxisName(config, getFactMetricById),
    seriesNames: getExplorationRenderOpts(config, getFactMetricById).map(
      (opts) => opts.seriesName,
    ),
    columnHeaders: buildExplorationColumns(config, getFactMetricById)
      .filter((col) => col.kind === "metric")
      .map((col) => col.label),
    unitPicker: getUnitPicker(values, getFactMetricById, getFactTableById),
    cards: values.map((v) => {
      const { options, showAs } = getShowAsChoice(
        v,
        config.showAs,
        getFactMetricById,
      );
      return {
        showAsOptions: options,
        showAs,
        readOnlyUnit: getReadOnlyUnit(
          v,
          values,
          getFactMetricById,
          getFactTableById,
        ),
      };
    }),
  };
}

describe("describeExplorerDisplay", () => {
  it("two per-unit means on one unit: the axis names the unit", () => {
    expect(
      describeExplorerDisplay(
        metricChart([
          value("revenue", "user_id", "per_unit"),
          // No stored showAs: a max aggregation defaults to per unit.
          value("maxOrder"),
        ]),
      ),
    ).toEqual({
      axisTitle: "Per user_id",
      seriesNames: ["revenue", "maxOrder"],
      columnHeaders: ["revenue (per user_id)", "maxOrder (per user_id)"],
      unitPicker: {
        value: "user_id",
        placeholder: "Select identifier type...",
        options: ["user_id", "device_id"],
        disabledReason: null,
      },
      cards: [
        {
          showAsOptions: ["total", "per_unit"],
          showAs: "per_unit",
          readOnlyUnit: null,
        },
        {
          showAsOptions: ["total", "per_unit"],
          showAs: "per_unit",
          readOnlyUnit: null,
        },
      ],
    });
  });

  it("an old chart with mixed units: cards show their units read-only", () => {
    expect(
      describeExplorerDisplay(
        metricChart([
          value("signups", "user_id"),
          // A different unit, from a Fact Table with no user_id.
          value("installs", "device_id"),
        ]),
      ),
    ).toEqual({
      axisTitle: "Total",
      seriesNames: ["signups", "installs"],
      columnHeaders: ["signups", "installs"],
      unitPicker: {
        value: null,
        placeholder: "Mixed identifier types",
        options: [],
        disabledReason:
          "The Fact Tables of these metrics share no identifier type.",
      },
      cards: [
        { showAsOptions: [], showAs: "total", readOnlyUnit: "user_id" },
        {
          showAsOptions: ["total", "per_unit"],
          showAs: "total",
          readOnlyUnit: "device_id",
        },
      ],
    });
  });

  it("a lone quantile: no Show as and no identifier type picker", () => {
    expect(
      // Quantiles can't change unit or Show as.
      describeExplorerDisplay(metricChart([value("p95", "device_id")])),
    ).toEqual({
      axisTitle: "",
      seriesNames: ["p95"],
      columnHeaders: ["p95"],
      unitPicker: null,
      cards: [{ showAsOptions: [], showAs: "total", readOnlyUnit: null }],
    });
  });
});
