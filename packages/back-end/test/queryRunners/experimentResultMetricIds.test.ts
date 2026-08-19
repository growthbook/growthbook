import type { FunnelFactMetricInterface } from "shared/types/fact-table";
import { getExperimentResultMetricIds } from "back-end/src/queryRunners/experimentResultMetricIds";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";

describe("getExperimentResultMetricIds", () => {
  it("includes persisted funnel step results and the parent metric", () => {
    const funnelMetric: FunnelFactMetricInterface = {
      ...factMetricFactory.build({ id: "fact__funnel" }),
      id: "fact__funnel",
      metricType: "funnel",
      numerator: null,
      denominator: null,
      funnelSettings: {
        ordering: "strict",
        steps: ["View", "Signup"].map((name) => ({
          name,
          factTableId: "fact_table",
          rowFilters: [],
          optional: false,
          conversionWindow: null,
        })),
      },
    };
    const standardMetric = factMetricFactory.build({ id: "fact__revenue" });

    expect(
      getExperimentResultMetricIds([funnelMetric, standardMetric]),
    ).toEqual([
      "fact__funnel?step=0",
      "fact__funnel?step=1",
      "fact__funnel",
      "fact__revenue",
    ]);
  });
});
