import { getFactMetricCommercialFeature } from "@/services/factMetrics";

describe("getFactMetricCommercialFeature", () => {
  it.each([
    ["quantile", "quantile-metrics"],
    ["retention", "retention-metrics"],
    ["funnel", "funnel-metrics"],
    ["mean", null],
    ["proportion", null],
    ["ratio", null],
    ["dailyParticipation", null],
    [undefined, null],
  ] as const)("requires %s to use %s", (metricType, expected) => {
    expect(getFactMetricCommercialFeature(metricType)).toBe(expected);
  });
});
