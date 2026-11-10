import type {
  FunnelFactMetricInterface,
  MetricFunnelStep,
  MetricWindowSettings,
} from "shared/types/fact-table";

import { getMaxHoursToConvert } from "back-end/src/integrations/sql/dates/max-hours-to-convert";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";

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
  windowType = "conversion",
  windowValueHours,
  delayValueHours = 0,
  steps,
}: {
  windowType?: MetricWindowSettings["type"];
  windowValueHours: number;
  delayValueHours?: number;
  steps: MetricFunnelStep[];
}): FunnelFactMetricInterface {
  return {
    ...factMetricFactory.build({
      id: "fact__funnel",
      windowSettings: {
        type: windowType,
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

describe("getMaxHoursToConvert for fact funnel metrics", () => {
  it("uses the sum of step windows when every step is windowed and the sum is shorter than the metric window", () => {
    // 1h + 0.5h + 0.5h = 2h < 30-day metric window
    const metric = buildFunnelMetric({
      windowValueHours: 30 * 24,
      steps: [
        buildStep("View", { value: 1, unit: "hours" }),
        buildStep("Cart", { value: 30, unit: "minutes" }),
        buildStep("Purchase", { value: 30, unit: "minutes" }),
      ],
    });
    expect(getMaxHoursToConvert(false, [metric], null)).toEqual(2);
  });

  it("caps at the metric window when every step is windowed but the sum is longer", () => {
    // 10d + 10d + 10d = 30d > 7-day metric window
    const metric = buildFunnelMetric({
      windowValueHours: 7 * 24,
      steps: [
        buildStep("View", { value: 10, unit: "days" }),
        buildStep("Cart", { value: 10, unit: "days" }),
        buildStep("Purchase", { value: 10, unit: "days" }),
      ],
    });
    expect(getMaxHoursToConvert(false, [metric], null)).toEqual(7 * 24);
  });

  it("falls back to the metric window when any step lacks a conversion window", () => {
    // Step 2 can fire anywhere inside the envelope, so the step sum is not a bound
    const metric = buildFunnelMetric({
      windowValueHours: 72,
      steps: [
        buildStep("View", { value: 1, unit: "hours" }),
        buildStep("Cart"),
        buildStep("Purchase", { value: 30, unit: "minutes" }),
      ],
    });
    expect(getMaxHoursToConvert(false, [metric], null)).toEqual(72);
  });

  it("includes the metric delay on top of the funnel completion bound", () => {
    const metric = buildFunnelMetric({
      windowValueHours: 72,
      delayValueHours: 4,
      steps: [
        buildStep("View", { value: 1, unit: "hours" }),
        buildStep("Purchase", { value: 1, unit: "hours" }),
      ],
    });
    expect(getMaxHoursToConvert(false, [metric], null)).toEqual(6);
  });

  describe("without a metric conversion window", () => {
    const windowedSteps = [
      buildStep("View", { value: 1, unit: "hours" }),
      buildStep("Purchase", { value: 30, unit: "minutes" }),
    ];

    it("uses the delay plus the sum of step windows when every step is windowed", () => {
      const metric = buildFunnelMetric({
        windowType: "",
        windowValueHours: 72,
        delayValueHours: 4,
        steps: windowedSteps,
      });
      expect(getMaxHoursToConvert(false, [metric], null)).toEqual(5.5);
    });

    it("is unbounded when any step lacks a conversion window", () => {
      const metric = buildFunnelMetric({
        windowType: "",
        windowValueHours: 72,
        delayValueHours: 4,
        steps: [...windowedSteps, buildStep("Refund")],
      });
      expect(getMaxHoursToConvert(false, [metric], null)).toEqual(0);
    });

    it("ignores step windows for lookback windows", () => {
      const metric = buildFunnelMetric({
        windowType: "lookback",
        windowValueHours: 72,
        delayValueHours: 4,
        steps: windowedSteps,
      });
      expect(getMaxHoursToConvert(false, [metric], null)).toEqual(0);
    });
  });
});
