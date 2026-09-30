import {
  getDefaultFactMetricProps,
  toFactMetricFormValues,
} from "@/services/metrics";
import {
  getMetricPreviewUnavailableReason,
  getDraftMetricPreview,
  getMetricPreviewCaveat,
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
  { column: "country", operator: "in" as const, values: [] },
  { column: "country", operator: "!=" as const, values: [""] },
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

it.each([
  { column: "", operator: "=" as const, values: [""] },
  { column: "country", operator: "=" as const, values: [] },
  { column: "country", operator: "=" as const, values: [""] },
])("blocks an unfilled filter the save would drop: %j", (filter) => {
  const values = draft();
  const complete = { column: "plan", operator: "=" as const, values: ["pro"] };
  expect(
    getDraftMetricPreview({
      ...values,
      metricType: "mean",
      numerator: { ...values.numerator, rowFilters: [filter, complete] },
    }),
  ).toBeNull();
});

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

describe("getMetricPreviewCaveat", () => {
  const noWindow = {
    type: "" as const,
    delayValue: 0,
    delayUnit: "days" as const,
    windowValue: 0,
    windowUnit: "days" as const,
  };
  const noCap = { type: "" as const, value: 0 };
  it("names each setting the preview does not apply", () => {
    expect(
      getMetricPreviewCaveat({
        metricType: "mean",
        cappingSettings: noCap,
        windowSettings: noWindow,
      }),
    ).toBeNull();
    expect(
      getMetricPreviewCaveat({
        metricType: "mean",
        cappingSettings: { type: "absolute", value: 10 },
        windowSettings: { ...noWindow, type: "conversion", windowValue: 3 },
      }),
    ).toBe(
      "The preview ignores metric windows and delays, and caps each event instead of each unit's total. Experiment results will differ.",
    );
    expect(
      getMetricPreviewCaveat({
        metricType: "proportion",
        cappingSettings: { type: "absolute", value: 10 },
        windowSettings: { ...noWindow, delayValue: 2 },
      }),
    ).toBe(
      "The preview ignores metric windows and delays. Experiment results will differ.",
    );
    expect(
      getMetricPreviewCaveat({
        metricType: "mean",
        cappingSettings: noCap,
        lowerCappingSettings: { type: "absolute", value: 0 },
        windowSettings: noWindow,
      }),
    ).toBe(
      "The preview ignores the lower cap. Experiment results will differ.",
    );
    expect(
      getMetricPreviewCaveat({
        metricType: "mean",
        cappingSettings: { type: "absolute", value: 10 },
        lowerCappingSettings: { type: "absolute", value: 0 },
        windowSettings: { ...noWindow, type: "conversion", windowValue: 3 },
      }),
    ).toBe(
      "The preview ignores metric windows and delays, caps each event instead of each unit's total, and ignores the lower cap. Experiment results will differ.",
    );
  });
});
