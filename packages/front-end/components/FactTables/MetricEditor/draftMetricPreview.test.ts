import {
  getDefaultFactMetricProps,
  toFactMetricFormValues,
} from "@/services/metrics";
import { getDraftMetricPreview } from "./draftMetricPreview";

const draft = () => ({
  ...toFactMetricFormValues(
    getDefaultFactMetricProps({
      datasources: [],
      settings: {},
      metricDefaults: {},
    }),
  ),
  datasource: "ds_1",
  numerator: {
    factTableId: "ft_1",
    column: "revenue",
    aggregation: "sum" as const,
    rowFilters: [],
  },
});

describe("getDraftMetricPreview", () => {
  it("uses the current metric calculation and changes the query identity when edited", () => {
    const values = { ...draft(), metricType: "mean" as const };
    const mean = getDraftMetricPreview(values);
    const ratio = getDraftMetricPreview({
      ...values,
      metricType: "ratio",
      denominator: { factTableId: "ft_2", column: "$$count", rowFilters: [] },
    });
    expect(mean?.metricType).toBe("mean");
    expect(mean?.numerator?.column).toBe("revenue");
    expect(ratio?.metricType).toBe("ratio");
    expect(ratio?.denominator?.factTableId).toBe("ft_2");
    expect(JSON.stringify(mean)).not.toBe(JSON.stringify(ratio));
    expect(mean?.minPercentChange).toBe(values.minPercentChange / 100);
    expect(JSON.stringify(getDraftMetricPreview(values))).toBe(
      JSON.stringify(mean),
    );
  });

  it("preserves quantile settings and row filters", () => {
    const values = draft();
    const metric = getDraftMetricPreview({
      ...values,
      metricType: "quantile",
      quantileSettings: { type: "event", quantile: 0.95, ignoreZeros: true },
      numerator: {
        ...values.numerator,
        rowFilters: [{ column: "country", operator: "=", values: ["US"] }],
      },
    });
    expect(metric?.quantileSettings?.quantile).toBe(0.95);
    expect(metric?.numerator?.rowFilters?.[0].values).toEqual(["US"]);
  });

  it("does not query an incomplete definition", () => {
    expect(getDraftMetricPreview({ ...draft(), datasource: "" })).toBeNull();
    expect(
      getDraftMetricPreview({
        ...draft(),
        numerator: { factTableId: "", column: "$$count" },
      }),
    ).toBeNull();
    expect(
      getDraftMetricPreview({
        ...draft(),
        metricType: "funnel",
        funnelSettings: null,
      }),
    ).toBeNull();
  });
});
