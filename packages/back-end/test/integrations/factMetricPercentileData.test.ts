import { getFactMetricPercentileData } from "back-end/src/integrations/sql/columns/fact-metric-percentile-data";
import { factMetricFactory } from "../factories/FactMetric.factory";

const base = {
  alias: "m0",
  numeratorSourceIndex: 0,
  denominatorSourceIndex: 1,
};

describe("getFactMetricPercentileData", () => {
  it("returns nothing when neither tail is percentile capped", () => {
    const metric = factMetricFactory.build({
      metricType: "mean",
      cappingSettings: { type: "absolute", value: 10 },
      lowerCappingSettings: null,
    });
    expect(
      getFactMetricPercentileData({
        ...base,
        metric,
        ratioMetric: false,
        isUpperPercentileCapped: false,
        isLowerPercentileCapped: false,
      }),
    ).toEqual([]);
  });

  it("emits both tails for the numerator and denominator of a ratio metric", () => {
    const metric = factMetricFactory.build({
      metricType: "ratio",
      cappingSettings: { type: "percentile", value: 0.99, ignoreZeros: true },
      lowerCappingSettings: { type: "percentile", value: 0.01 },
    });
    expect(
      getFactMetricPercentileData({
        ...base,
        metric,
        ratioMetric: true,
        isUpperPercentileCapped: true,
        isLowerPercentileCapped: true,
      }),
    ).toEqual([
      {
        valueCol: "m0_value",
        outputCol: "m0_value_cap",
        percentile: 0.99,
        ignoreZeros: true,
        sourceIndex: 0,
      },
      {
        valueCol: "m0_denominator",
        outputCol: "m0_denominator_cap",
        percentile: 0.99,
        ignoreZeros: true,
        sourceIndex: 1,
      },
      {
        valueCol: "m0_value",
        outputCol: "m0_value_cap_lower",
        percentile: 0.01,
        ignoreZeros: false,
        sourceIndex: 0,
      },
      {
        valueCol: "m0_denominator",
        outputCol: "m0_denominator_cap_lower",
        percentile: 0.01,
        ignoreZeros: false,
        sourceIndex: 1,
      },
    ]);
  });

  it("uses caller-supplied column names for the metric-analysis query", () => {
    const metric = factMetricFactory.build({
      metricType: "mean",
      cappingSettings: { type: "", value: 0 },
      lowerCappingSettings: { type: "percentile", value: 0.05 },
    });
    expect(
      getFactMetricPercentileData(
        {
          ...base,
          metric,
          ratioMetric: false,
          isUpperPercentileCapped: false,
          isLowerPercentileCapped: true,
        },
        { value: "value", denominator: "denominator" },
      ),
    ).toEqual([
      {
        valueCol: "value",
        outputCol: "value_cap_lower",
        percentile: 0.05,
        ignoreZeros: false,
        sourceIndex: 0,
      },
    ]);
  });
});
