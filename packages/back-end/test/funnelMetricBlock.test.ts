import type {
  FunnelFactMetricInterface,
  MetricFunnelStep,
} from "shared/types/fact-table";
import type { ExperimentFactMetricsQueryResponseRows } from "shared/types/integrations";

import { splitFunnelMetricBlock } from "back-end/src/services/experimentQueries/funnelMetricBlock";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";

function buildStep(name: string): MetricFunnelStep {
  return {
    name,
    factTableId: "events",
    rowFilters: [],
    optional: false,
    conversionWindow: null,
  };
}

function buildFunnelMetric(stepNames: string[]): FunnelFactMetricInterface {
  return {
    ...factMetricFactory.build({ id: "fact__funnel" }),
    id: "fact__funnel",
    name: "Signup Funnel",
    metricType: "funnel",
    numerator: null,
    funnelSettings: {
      steps: stepNames.map(buildStep),
      concurrencyWindowSeconds: 0,
    },
  };
}

describe("splitFunnelMetricBlock", () => {
  const metric = buildFunnelMetric(["View", "Add to cart", "Purchase"]);

  const rows: ExperimentFactMetricsQueryResponseRows = [
    {
      variation: "0",
      dim_country: "US",
      users: 100,
      count: 100,
      m0_id: "fact__other",
      m0_main_sum: 42,
      m1_id: "fact__funnel",
      m1_step_0_sum: 80,
      m1_step_1_sum: 30,
      m1_step_2_sum: 10,
    },
    {
      variation: "1",
      dim_country: "US",
      users: 120,
      count: 120,
      m0_id: "fact__other",
      m0_main_sum: 50,
      m1_id: "fact__funnel",
      m1_step_0_sum: 90,
      m1_step_1_sum: 40,
      // Step 2 absent: a variation where no unit reached the last step.
    },
  ] as ExperimentFactMetricsQueryResponseRows;

  it("names one binomial per step plus a parent binomial", () => {
    expect(
      splitFunnelMetricBlock({ metric, slotAlias: "m1", rows }).metrics,
    ).toEqual([
      "fact__funnel",
      "fact__funnel?step=0",
      "fact__funnel?step=1",
      "fact__funnel?step=2",
    ]);
  });

  it("renumbers each step's sum into its own slot's main_sum", () => {
    const result = splitFunnelMetricBlock({ metric, slotAlias: "m1", rows });

    expect(result.rows[0]).toEqual({
      variation: "0",
      dim_country: "US",
      users: 100,
      count: 100,
      m0_id: "fact__funnel?step=0",
      m0_main_sum: 80,
      m1_id: "fact__funnel?step=1",
      m1_main_sum: 30,
      m2_id: "fact__funnel?step=2",
      m2_main_sum: 10,
      m3_id: "fact__funnel",
      m3_main_sum: 10,
    });
  });

  it("treats a missing step column as zero conversions", () => {
    const result = splitFunnelMetricBlock({ metric, slotAlias: "m1", rows });

    expect(result.rows[1]).toMatchObject({
      variation: "1",
      users: 120,
      m2_id: "fact__funnel?step=2",
      m2_main_sum: 0,
      m3_id: "fact__funnel",
      m3_main_sum: 0,
    });
  });

  it("drops the other metrics sharing the query", () => {
    const result = splitFunnelMetricBlock({ metric, slotAlias: "m1", rows });

    expect(result.rows[0]).not.toHaveProperty("m1_step_0_sum");
    expect(
      Object.values(result.rows[0]).includes(42),
      // fact__other's main_sum must not leak into a funnel step slot.
    ).toBe(false);
  });

  it("passes the query sql through", () => {
    expect(
      splitFunnelMetricBlock({
        metric,
        slotAlias: "m1",
        rows,
        sql: "SELECT 1",
      }).sql,
    ).toBe("SELECT 1");
  });
});
