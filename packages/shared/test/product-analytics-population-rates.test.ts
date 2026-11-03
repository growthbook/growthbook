import {
  buildExplorationColumns,
  getExplorationCellValue,
  getExplorationRenderOpts,
  getRowMetricValue,
  showAsAppliesTo,
} from "shared/enterprise";
import { ExplorationConfig } from "shared/validators";
import { FactMetricInterface } from "shared/types/fact-table";

const metrics: Record<string, FactMetricInterface> = {
  activation: {
    id: "activation",
    metricType: "proportion",
    numerator: { factTableId: "ft_events", column: "$$distinctUsers" },
  } as FactMetricInterface,
  revenue: {
    id: "revenue",
    metricType: "mean",
    numerator: { factTableId: "ft_events", column: "amount" },
  } as FactMetricInterface,
};
const getFactMetricById = (id: string) => metrics[id] ?? null;

function makeConfig(withPopulation: boolean): ExplorationConfig {
  return {
    type: "metric",
    datasource: "ds_1",
    chartType: "line",
    dateRange: {
      predefined: "last30Days",
      lookbackValue: null,
      lookbackUnit: null,
      startDate: null,
      endDate: null,
    },
    dimensions: [
      { dimensionType: "date", column: "date", dateGranularity: "day" },
    ],
    dataset: {
      type: "metric",
      values: [
        {
          type: "metric",
          name: "Activation",
          metricId: "activation",
          unit: "user_id",
          denominatorUnit: null,
          rowFilters: [],
        },
      ],
      ...(withPopulation
        ? {
            population: {
              source: { type: "factTable", factTableId: "ft_events" },
              rowFilters: [],
              unit: "user_id",
            },
          }
        : {}),
    },
  } as ExplorationConfig;
}

// A Proportion metric's denominator equals its numerator; only the
// population count gives the rate.
const row = {
  dimensions: ["2026-09-01"],
  values: [{ metricId: "activation", numerator: 25, denominator: 25 }],
  populationCount: 200,
};

describe("population rates", () => {
  it("divides Proportion metrics by the row's population", () => {
    const opts = getExplorationRenderOpts(makeConfig(true), getFactMetricById);
    expect(opts.populationDenominatorByIndex).toEqual([true]);
    expect(getRowMetricValue(row, 0, opts)).toBe(0.125);
  });

  it("always shows the percentage with a population, with no Show As", () => {
    const config = { ...makeConfig(true), showAs: "total" as const };
    expect(showAsAppliesTo(config, getFactMetricById)).toBe(false);
    const opts = getExplorationRenderOpts(config, getFactMetricById);
    expect(opts.populationDenominatorByIndex).toEqual([true]);
    expect(getRowMetricValue(row, 0, opts)).toBe(0.125);
  });

  it("keeps the count when there's no population", () => {
    const opts = getExplorationRenderOpts(makeConfig(false), getFactMetricById);
    expect(opts.populationDenominatorByIndex).toEqual([]);
    expect(getRowMetricValue(row, 0, opts)).toBe(25);
  });

  it("returns 0 for an empty population instead of dividing by zero", () => {
    const opts = getExplorationRenderOpts(makeConfig(true), getFactMetricById);
    expect(getRowMetricValue({ ...row, populationCount: 0 }, 0, opts)).toBe(0);
  });

  it("splits table columns into count, population and rate", () => {
    const config = makeConfig(true);
    const opts = getExplorationRenderOpts(config, getFactMetricById);
    const cols = buildExplorationColumns(config, getFactMetricById).filter(
      (c) => c.kind === "metric",
    );
    expect(cols.map((c) => c.label)).toEqual([
      "Activation Count",
      "Activation Members",
      "Activation Rate",
    ]);
    expect(cols.map((c) => getExplorationCellValue(row, c, opts))).toEqual([
      25, 200, 0.125,
    ]);
  });
});
