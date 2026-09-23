import {
  getDefaultFactMetricProps,
  toFactMetricFormValues,
} from "@/services/metrics";
import {
  getMetricPreviewUnavailableReason,
  getDraftMetricPreview,
} from "./draftMetricPreview";

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

it("allows unit-count previews but disables Active Days and population-dependent rates", () => {
  expect(
    getMetricPreviewUnavailableReason({
      metricType: "proportion",
      numerator: null,
    }),
  ).toBeNull();
  expect(
    getMetricPreviewUnavailableReason({
      metricType: "retention",
      numerator: null,
    }),
  ).not.toBeNull();
  expect(
    getMetricPreviewUnavailableReason({
      metricType: "dailyParticipation",
      numerator: null,
    }),
  ).not.toBeNull();
  expect(
    getMetricPreviewUnavailableReason({
      metricType: "mean",
      numerator: { factTableId: "ft_1", column: "$$distinctDates" },
    }),
  ).toContain("Active Days");
  expect(
    getMetricPreviewUnavailableReason({
      metricType: "mean",
      numerator: { factTableId: "ft_1", column: "$$count" },
    }),
  ).toBeNull();
});

it.each([
  { column: "", operator: "=" as const, values: ["US"] },
  { column: "country", operator: "=" as const, values: [] },
  { column: "country", operator: "=" as const, values: [""] },
])(
  "blocks incomplete numerator, denominator, and funnel filters: %j",
  (filter) => {
    const values = draft();
    const numerator = { ...values.numerator, rowFilters: [filter] };
    expect(
      getDraftMetricPreview({ ...values, metricType: "mean", numerator }),
    ).toBeNull();
    expect(
      getDraftMetricPreview({
        ...values,
        metricType: "ratio",
        denominator: numerator,
      }),
    ).toBeNull();
    const step = {
      name: "Step",
      factTableId: "ft_1",
      rowFilters: [filter],
      optional: false,
      conversionWindow: null,
    };
    expect(
      getDraftMetricPreview({
        ...values,
        metricType: "funnel",
        funnelSettings: { steps: [step, step] },
      }),
    ).toBeNull();
  },
);

it("allows valueless operators and blocks an unfinished aggregate threshold", () => {
  const values = draft();
  expect(
    getDraftMetricPreview({
      ...values,
      numerator: {
        ...values.numerator,
        rowFilters: [{ column: "country", operator: "not_null", values: [] }],
      },
    }),
  ).not.toBeNull();
  expect(
    getDraftMetricPreview({
      ...values,
      numerator: {
        ...values.numerator,
        aggregateFilterColumn: "$$count",
        aggregateFilter: "",
      },
    }),
  ).toBeNull();
});
