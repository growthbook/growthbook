import type {
  FunnelFactMetricInterface,
  MetricFunnelStep,
} from "shared/types/fact-table";
import type { MetricForSnapshot } from "shared/types/experiment-snapshot";
import { isFactFunnelMetric } from "shared/experiments";
import { getMaxHoursToConvert } from "back-end/src/integrations/sql/dates/max-hours-to-convert";
import {
  getMetricConversionWindowHours,
  getOverriddenMetricConversionWindowHours,
  partitionMetricsByConversionWindow,
} from "back-end/src/services/experimentQueries/partitionMetricsByConversionWindow";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";

const shortWindowMetric = factMetricFactory.build({
  id: "fact_short_window",
  metricType: "mean",
  numerator: { factTableId: "ft_events", column: "amount", aggregation: "sum" },
  windowSettings: {
    type: "conversion",
    delayValue: 0,
    delayUnit: "hours",
    windowValue: 1,
    windowUnit: "days",
  },
});

const longWindowMetric = factMetricFactory.build({
  id: "fact_long_window",
  metricType: "mean",
  numerator: { factTableId: "ft_events", column: "amount", aggregation: "sum" },
  windowSettings: {
    type: "conversion",
    delayValue: 1,
    delayUnit: "days",
    windowValue: 3,
    windowUnit: "days",
  },
});

const halfHourMetric = factMetricFactory.build({
  id: "fact_half_hour",
  metricType: "mean",
  numerator: { factTableId: "ft_events", column: "amount", aggregation: "sum" },
  windowSettings: {
    type: "conversion",
    delayValue: 0,
    delayUnit: "minutes",
    windowValue: 30,
    windowUnit: "minutes",
  },
});

function buildStep(
  name: string,
  conversionWindow: MetricFunnelStep["conversionWindow"] = null,
): MetricFunnelStep {
  return {
    name,
    factTableId: "events",
    rowFilters: [],
    optional: false,
    conversionWindow,
  };
}

function buildFunnelMetric({
  windowValueHours,
  delayValueHours = 0,
  steps,
}: {
  windowValueHours: number;
  delayValueHours?: number;
  steps: MetricFunnelStep[];
}): FunnelFactMetricInterface {
  return {
    ...factMetricFactory.build({
      id: "fact__funnel",
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: windowValueHours,
        delayUnit: "hours",
        delayValue: delayValueHours,
      },
    }),
    id: "fact__funnel",
    name: "Signup Funnel",
    metricType: "funnel",
    numerator: null,
    funnelSettings: {
      steps,
      concurrencyWindowSeconds: 0,
    },
  };
}

describe("partitionMetricsByConversionWindow", () => {
  it("returns a single null partition with all metrics when skipPartialData is off", () => {
    const partitions = partitionMetricsByConversionWindow(
      [shortWindowMetric, longWindowMetric, halfHourMetric],
      false,
      null,
    );
    expect(partitions).toHaveLength(1);
    expect(partitions[0].windowHours).toBeNull();
    expect(partitions[0].windowOrdinal).toBeNull();
    expect(partitions[0].metrics.map((m) => m.id)).toEqual([
      "fact_short_window",
      "fact_long_window",
      "fact_half_hour",
    ]);
  });

  it("groups by conversion window when skipPartialData is on, sorted ascending", () => {
    const partitions = partitionMetricsByConversionWindow(
      [longWindowMetric, shortWindowMetric],
      true,
      null,
    );
    expect(partitions).toHaveLength(2);
    expect(partitions.map((p) => p.windowHours)).toEqual([24, 96]);
    expect(partitions.map((p) => p.windowOrdinal)).toEqual([0, 1]);
    expect(partitions[0].metrics.map((m) => m.id)).toEqual([
      "fact_short_window",
    ]);
    expect(partitions[1].metrics.map((m) => m.id)).toEqual([
      "fact_long_window",
    ]);
  });

  it("keeps same-window metrics in one partition", () => {
    const anotherLong = factMetricFactory.build({
      ...longWindowMetric,
      id: "fact_long_window_2",
    });
    const partitions = partitionMetricsByConversionWindow(
      [longWindowMetric, anotherLong],
      true,
      null,
    );
    expect(partitions).toHaveLength(1);
    expect(partitions[0].windowHours).toBe(96);
    expect(partitions[0].windowOrdinal).toBe(0);
    expect(partitions[0].metrics.map((m) => m.id).sort()).toEqual([
      "fact_long_window",
      "fact_long_window_2",
    ]);
  });

  it("keys sub-hour windows by fractional hours, not a rounded minutes token", () => {
    const partitions = partitionMetricsByConversionWindow(
      [halfHourMetric, shortWindowMetric],
      true,
      null,
    );
    expect(partitions).toHaveLength(2);
    expect(partitions[0].windowHours).toBe(0.5);
    expect(partitions[0].windowOrdinal).toBe(0);
    expect(partitions[0].metrics.map((m) => m.id)).toEqual(["fact_half_hour"]);
    expect(partitions[1].windowHours).toBe(24);
    expect(partitions[1].windowOrdinal).toBe(1);
  });

  it("matches the stats CTE window for a funnel metric", () => {
    const funnel = buildFunnelMetric({
      windowValueHours: 30 * 24,
      steps: [
        buildStep("View", { value: 1, unit: "hours" }),
        buildStep("Cart", { value: 30, unit: "minutes" }),
        buildStep("Purchase", { value: 30, unit: "minutes" }),
      ],
    });
    const expected = getMaxHoursToConvert(
      isFactFunnelMetric(funnel),
      [funnel],
      null,
    );
    expect(expected).toBe(2);
    const partitions = partitionMetricsByConversionWindow([funnel], true, null);
    expect(partitions).toHaveLength(1);
    expect(partitions[0].windowHours).toBe(expected);
    expect(getMetricConversionWindowHours(funnel, null)).toBe(expected);
  });

  it("includes the activation metric in the window the same way the CTE does", () => {
    const activation = factMetricFactory.build({
      id: "activation",
      metricType: "mean",
      numerator: {
        factTableId: "ft_events",
        column: "amount",
        aggregation: "sum",
      },
      windowSettings: {
        type: "conversion",
        delayValue: 0,
        delayUnit: "hours",
        windowValue: 2,
        windowUnit: "hours",
      },
    });
    const partitions = partitionMetricsByConversionWindow(
      [shortWindowMetric, longWindowMetric],
      true,
      activation,
    );
    expect(partitions.map((p) => p.windowHours)).toEqual([26, 98]);
    expect(partitions[0].windowHours).toBe(
      getMaxHoursToConvert(false, [shortWindowMetric], activation),
    );
    expect(partitions[1].windowHours).toBe(
      getMaxHoursToConvert(false, [longWindowMetric], activation),
    );
  });

  it("assigns unique, stable ordinals regardless of input order", () => {
    const forward = partitionMetricsByConversionWindow(
      [longWindowMetric, shortWindowMetric, halfHourMetric],
      true,
      null,
    );
    const reverse = partitionMetricsByConversionWindow(
      [halfHourMetric, shortWindowMetric, longWindowMetric],
      true,
      null,
    );
    expect(forward.map((p) => p.windowHours)).toEqual([0.5, 24, 96]);
    expect(reverse.map((p) => p.windowHours)).toEqual([0.5, 24, 96]);
    expect(forward.map((p) => p.windowOrdinal)).toEqual([0, 1, 2]);
    expect(reverse.map((p) => p.windowOrdinal)).toEqual([0, 1, 2]);
    expect(new Set(forward.map((p) => p.windowOrdinal)).size).toBe(3);
  });

  it("does not emit empty partitions", () => {
    expect(partitionMetricsByConversionWindow([], true, null)).toEqual([]);
  });
});

describe("getOverriddenMetricConversionWindowHours", () => {
  // A metricSettings override shrinking fact_long_window (raw 96h) to a
  // 24h conversion window, mirroring what the snapshot pipeline persists.
  const shortWindowOverride: MetricForSnapshot = {
    id: "fact_long_window",
    computedSettings: {
      regressionAdjustmentEnabled: false,
      regressionAdjustmentAvailable: true,
      regressionAdjustmentDays: 0,
      regressionAdjustmentReason: "",
      properPrior: false,
      properPriorMean: 0,
      properPriorStdDev: 0,
      windowSettings: {
        type: "conversion",
        delayValue: 0,
        delayUnit: "hours",
        windowValue: 1,
        windowUnit: "days",
      },
    },
  };

  it("returns the overridden window, matching what the stats CTE asserts on", () => {
    // Raw window is 96h; the override must win, or the cross-FT grouping key
    // disagrees with getIncrementalRefreshStatisticsQuery's assertion.
    expect(getMetricConversionWindowHours(longWindowMetric, null)).toBe(96);
    expect(
      getOverriddenMetricConversionWindowHours(longWindowMetric, null, {
        metricSettings: [shortWindowOverride],
      }),
    ).toBe(24);
  });

  it("falls back to the raw window when no override targets the metric", () => {
    expect(
      getOverriddenMetricConversionWindowHours(longWindowMetric, null, {
        metricSettings: [],
      }),
    ).toBe(96);
  });

  it("does not mutate the input metric", () => {
    getOverriddenMetricConversionWindowHours(longWindowMetric, null, {
      metricSettings: [shortWindowOverride],
    });
    expect(longWindowMetric.windowSettings.windowValue).toBe(3);
    expect(longWindowMetric.windowSettings.windowUnit).toBe("days");
    expect(longWindowMetric.windowSettings.delayValue).toBe(1);
  });
});
