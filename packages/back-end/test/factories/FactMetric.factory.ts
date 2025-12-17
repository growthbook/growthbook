import { Factory } from "fishery";
import { FactMetricInterface } from "../../types/fact-table";

export const factMetricFactory = Factory.define<FactMetricInterface>(
  ({ sequence, params }) => ({
    id: `fact_${sequence}`,
    organization: "org_1",
    datasource: "test-datasource",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: "Test Fact Metric",
    description: "A test fact metric",
    owner: "test-owner",
    projects: [],
    tags: [],

    inverse: false,

    metricType: params.metricType ?? "mean",
    numerator: {
      factTableId: params.numerator?.factTableId ?? `ft_${sequence}`,
      column: params.numerator?.column ?? "value",
      aggregation: params.numerator?.aggregation ?? "sum",
      rowFilters: params.numerator?.rowFilters ?? [],
    },
    denominator: params.denominator
      ? {
          factTableId: params.denominator?.factTableId ?? `ft_${sequence}`,
          column: params.denominator?.column ?? "value",
          aggregation: params.denominator?.aggregation ?? "sum",
          rowFilters: params.denominator?.rowFilters ?? [],
        }
      : null,

    cappingSettings: {
      type: params.cappingSettings?.type ?? "",
      value: params.cappingSettings?.value ?? 1000,
      ignoreZeros: params.cappingSettings?.ignoreZeros ?? false,
    },
    windowSettings: {
      type: params.windowSettings?.type ?? "",
      delayValue: params.windowSettings?.delayValue ?? 1,
      delayUnit: params.windowSettings?.delayUnit ?? "days",
      windowValue: params.windowSettings?.windowValue ?? 1,
      windowUnit: params.windowSettings?.windowUnit ?? "days",
    },
    priorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: 1,
    },
    quantileSettings: null,

    maxPercentChange: 100,
    minPercentChange: 0.1,
    minSampleSize: 100,
    targetMDE: 0.1,
    displayAsPercentage: false,
    winRisk: 0.1,
    loseRisk: 0.05,
    regressionAdjustmentOverride: true,
    regressionAdjustmentEnabled: params.regressionAdjustmentEnabled ?? false,
    regressionAdjustmentDays: 10,
  }),
);
