import {
  CreateFactMetricFormProps,
  formatDurationMilliseconds,
  formatDurationSeconds,
  fromFactMetricFormValues,
  getFactMetricTrackProps,
  validateFactMetricFormValues,
} from "@/services/metrics";

describe("formatDurationSeconds", () => {
  it("keeps the same unit for negative values as the matching positive", () => {
    expect(formatDurationSeconds(-2.5)).toBe("-2.5s");
    expect(formatDurationSeconds(2.5)).toBe("2.5s");
  });
});

describe("formatDurationMilliseconds", () => {
  it("does not keep raw milliseconds when the absolute value is at least one second", () => {
    expect(formatDurationMilliseconds(-2500)).toBe("-2.5s");
    expect(formatDurationMilliseconds(2500)).toBe("2.5s");
  });
});

// Form values as the editor holds them (percent fields in whole percents).
function formValues(
  overrides: Partial<CreateFactMetricFormProps> = {},
): CreateFactMetricFormProps {
  return {
    name: "Revenue",
    description: "",
    owner: "",
    tags: [],
    projects: [],
    inverse: false,
    datasource: "ds_1",
    metricType: "mean",
    numerator: { factTableId: "ft_1", column: "amount", rowFilters: [] },
    denominator: null,
    cappingSettings: { type: "", value: 0 },
    windowSettings: {
      type: "",
      windowValue: 3,
      windowUnit: "days",
      delayValue: 0,
      delayUnit: "hours",
    },
    priorSettings: { override: false, proper: false, mean: 0, stddev: 0.3 },
    regressionAdjustmentOverride: false,
    regressionAdjustmentEnabled: false,
    regressionAdjustmentDays: 14,
    winRisk: 0.0025,
    loseRisk: 0.0125,
    minPercentChange: 0.5,
    maxPercentChange: 50,
    minSampleSize: 150,
    targetMDE: 10,
    managedBy: "",
    quantileSettings: null,
    funnelSettings: null,
    ...overrides,
  } as CreateFactMetricFormProps;
}

const placeholder = {
  column: "event_name",
  operator: "=" as const,
  values: [""],
};
const realFilter = { column: "plan", operator: "=" as const, values: ["pro"] };

describe("fromFactMetricFormValues", () => {
  it("drops unfilled inline-filter placeholders but keeps real filters", () => {
    const result = fromFactMetricFormValues(
      formValues({
        metricType: "ratio",
        numerator: {
          factTableId: "ft_1",
          column: "amount",
          rowFilters: [placeholder, realFilter],
        },
        denominator: {
          factTableId: "ft_1",
          column: "$$count",
          rowFilters: [placeholder],
        },
      }),
    );
    expect(result.numerator.rowFilters).toEqual([realFilter]);
    expect(result.denominator?.rowFilters).toEqual([]);
  });

  it("drops placeholders from funnel steps", () => {
    const step = {
      name: "Step 1",
      factTableId: "ft_1",
      rowFilters: [placeholder, realFilter],
      optional: false,
      conversionWindow: null,
    };
    const result = fromFactMetricFormValues(
      formValues({
        metricType: "funnel",
        funnelSettings: { steps: [step, step] },
      }),
    );
    expect(result.funnelSettings?.steps[0].rowFilters).toEqual([realFilter]);
  });

  it("normalizes a proportion seed the way the old modal did", () => {
    const result = fromFactMetricFormValues(
      formValues({
        metricType: "proportion",
        numerator: {
          factTableId: "ft_1",
          column: "$$count",
          aggregation: "sum",
          rowFilters: [],
        },
        cappingSettings: { type: "absolute", value: 100 },
        quantileSettings: { type: "unit", quantile: 5, ignoreZeros: false },
      }),
    );
    expect(result.numerator.column).toBe("$$distinctUsers");
    expect(result.numerator.aggregation).toBeUndefined();
    expect(result.cappingSettings.type).toBe("");
    expect(result.quantileSettings).toBeNull();
  });

  it("clears a ratio user filter unless the numerator counts unique users", () => {
    const withFilter = (column: string) =>
      fromFactMetricFormValues(
        formValues({
          metricType: "ratio",
          numerator: {
            factTableId: "ft_1",
            column,
            rowFilters: [],
            aggregateFilterColumn: "$$count",
            aggregateFilter: ">= 3",
          },
          denominator: {
            factTableId: "ft_1",
            column: "$$count",
            rowFilters: [],
          },
        }),
      ).numerator;
    expect(withFilter("amount").aggregateFilterColumn).toBeUndefined();
    expect(withFilter("amount").aggregateFilter).toBeUndefined();
    expect(withFilter("$$distinctUsers").aggregateFilter).toBe(">= 3");
  });
});

describe("validateFactMetricFormValues", () => {
  const validate = (overrides: Partial<CreateFactMetricFormProps>) => () =>
    validateFactMetricFormValues(
      fromFactMetricFormValues(formValues(overrides)),
    );
  const window = (w: Partial<CreateFactMetricFormProps["windowSettings"]>) => ({
    windowSettings: { ...formValues().windowSettings, ...w },
  });

  it("accepts a valid metric", () => {
    expect(validate({})).not.toThrow();
  });

  it("rejects a zero or empty metric window", () => {
    expect(validate(window({ type: "conversion", windowValue: 0 }))).toThrow(
      /window/,
    );
    expect(validate(window({ type: "lookback", windowValue: NaN }))).toThrow(
      /window/,
    );
  });

  it("allows a negative delay except for retention", () => {
    expect(validate(window({ delayValue: -2 }))).not.toThrow();
    expect(
      validate({
        metricType: "retention",
        ...window({ delayValue: 0 }),
      }),
    ).toThrow(/retention delay/);
  });

  it("rejects a percentile cap entered as a whole percent", () => {
    expect(
      validate({ cappingSettings: { type: "percentile", value: 95 } }),
    ).toThrow(/decimal/);
    expect(
      validate({ cappingSettings: { type: "percentile", value: 0.95 } }),
    ).not.toThrow();
  });

  it("rejects an invalid CUPED lookback only when overriding", () => {
    expect(
      validate({
        regressionAdjustmentOverride: true,
        regressionAdjustmentEnabled: true,
        regressionAdjustmentDays: 0,
      }),
    ).toThrow(/CUPED/);
    expect(validate({ regressionAdjustmentDays: 0 })).not.toThrow();
  });

  it("rejects cleared numeric fields", () => {
    expect(validate({ minSampleSize: NaN })).toThrow(/Minimum sample size/);
  });

  it("requires a threshold comparison", () => {
    expect(
      validate({
        metricType: "proportion",
        numerator: {
          factTableId: "ft_1",
          column: "$$distinctUsers",
          rowFilters: [],
          aggregateFilterColumn: "$$count",
          aggregateFilter: "",
        },
      }),
    ).toThrow(/threshold comparison/);
  });

  it("rejects capping with a ratio user filter", () => {
    expect(
      validate({
        metricType: "ratio",
        cappingSettings: { type: "percentile", value: 0.9 },
        numerator: {
          factTableId: "ft_1",
          column: "$$distinctUsers",
          rowFilters: [],
          aggregateFilterColumn: "$$count",
          aggregateFilter: ">= 3",
        },
        denominator: { factTableId: "ft_1", column: "$$count", rowFilters: [] },
      }),
    ).toThrow(/capping and a user filter/);
  });
});

describe("lower-tail capping", () => {
  const upper = { type: "percentile" as const, value: 0.95 };
  it("clears the lower tail for uncappable types and absolute on ratio", () => {
    expect(
      fromFactMetricFormValues(
        formValues({
          metricType: "quantile",
          lowerCappingSettings: { type: "absolute", value: 0 },
        }),
      ).lowerCappingSettings,
    ).toBeNull();
    expect(
      fromFactMetricFormValues(
        formValues({
          metricType: "ratio",
          cappingSettings: upper,
          lowerCappingSettings: { type: "absolute", value: 0 },
          denominator: {
            factTableId: "ft_1",
            column: "$$count",
            rowFilters: [],
          },
        }),
      ).lowerCappingSettings,
    ).toBeNull();
  });

  const validateCaps =
    (
      cappingSettings: CreateFactMetricFormProps["cappingSettings"],
      lowerCappingSettings: CreateFactMetricFormProps["lowerCappingSettings"],
    ) =>
    () =>
      validateFactMetricFormValues(
        fromFactMetricFormValues(
          formValues({ cappingSettings, lowerCappingSettings }),
        ),
      );

  it("accepts a zero or negative absolute floor", () => {
    expect(
      validateCaps(
        { type: "absolute", value: 100 },
        { type: "absolute", value: -5 },
      ),
    ).not.toThrow();
  });

  it("rejects a floor at or above the cap", () => {
    expect(
      validateCaps(
        { type: "absolute", value: 100 },
        { type: "absolute", value: 100 },
      ),
    ).toThrow(/Lower tail value/);
    expect(validateCaps(upper, { type: "percentile", value: 0.99 })).toThrow(
      /Lower percentile/,
    );
  });

  it("rejects an out-of-range lower percentile", () => {
    expect(
      validateCaps({ type: "", value: 0 }, { type: "percentile", value: 5 }),
    ).toThrow(/lower percentile cap/);
  });

  it("rejects mismatched ignore-zeros across percentile tails", () => {
    expect(
      validateCaps(
        { ...upper, ignoreZeros: true },
        { type: "percentile", value: 0.05, ignoreZeros: false },
      ),
    ).toThrow(/Ignore zeros/);
  });

  it("rejects a lower cap combined with a user filter", () => {
    expect(() =>
      validateFactMetricFormValues(
        fromFactMetricFormValues(
          formValues({
            metricType: "ratio",
            lowerCappingSettings: { type: "percentile", value: 0.05 },
            numerator: {
              factTableId: "ft_1",
              column: "$$distinctUsers",
              rowFilters: [],
              aggregateFilterColumn: "$$count",
              aggregateFilter: ">= 3",
            },
            denominator: {
              factTableId: "ft_1",
              column: "$$count",
              rowFilters: [],
            },
          }),
        ),
      ),
    ).toThrow(/capping and a user filter/);
  });
});

describe("getFactMetricTrackProps", () => {
  const base = {
    cappingSettings: { type: "percentile" as const, value: 0.99 },
    windowSettings: {
      type: "conversion" as const,
      windowValue: 72,
      windowUnit: "hours" as const,
      delayValue: 0,
      delayUnit: "hours" as const,
    },
  };

  it("describes a ratio metric the way the old modal did", () => {
    expect(
      getFactMetricTrackProps(
        {
          ...base,
          metricType: "ratio",
          numerator: {
            factTableId: "ft_1",
            column: "amount",
            aggregation: "max",
            rowFilters: [{ operator: "=", column: "a", values: ["b"] }],
          },
          denominator: {
            factTableId: "ft_1",
            column: "$$distinctUsers",
            rowFilters: [],
          },
        },
        "blank-state",
        "page",
      ),
    ).toEqual({
      type: "ratio",
      source: "blank-state",
      flow: "page",
      capping: "percentile",
      conversion_window: "72 hours",
      numerator_agg: "max",
      numerator_filters: 1,
      denominator_agg: "distinct_users",
      denominator_filters: 0,
      ratio_same_fact_table: true,
    });
  });

  it("defaults a column without aggregation to sum and no denominator to none", () => {
    const props = getFactMetricTrackProps(
      {
        ...base,
        windowSettings: { ...base.windowSettings, type: "" },
        metricType: "mean",
        numerator: { factTableId: "ft_1", column: "amount", rowFilters: [] },
        denominator: null,
      },
      "fact-table",
      "modal",
    );
    expect(props).toMatchObject({
      conversion_window: "none",
      numerator_agg: "sum",
      denominator_agg: "none",
      ratio_same_fact_table: false,
    });
  });

  it("only reports type and source for funnels", () => {
    expect(
      getFactMetricTrackProps(
        { ...base, metricType: "funnel", numerator: null, denominator: null },
        "get-started",
        "modal",
      ),
    ).toEqual({ type: "funnel", source: "get-started", flow: "modal" });
  });
});
