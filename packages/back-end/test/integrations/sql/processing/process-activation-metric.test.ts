import { processActivationMetric } from "back-end/src/integrations/sql/processing/process-activation-metric";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";

const settings = { metricSettings: [] };

describe("processActivationMetric", () => {
  it("returns null without an activation metric", () => {
    expect(processActivationMetric(null, settings)).toBeNull();
  });

  it("clones a proportion metric", () => {
    const metric = factMetricFactory.build({ metricType: "proportion" });
    const result = processActivationMetric(metric, settings);
    expect(result).toEqual(metric);
    expect(result).not.toBe(metric);
  });

  it("rejects a metric converted to compound after being chosen", () => {
    const metric = {
      ...factMetricFactory.build({ name: "Viewed and ordered" }),
      metricType: "compound" as const,
      numerator: null,
      funnelSettings: null,
      compoundSettings: {
        components: [
          { factTableId: "ft_a", rowFilters: [] },
          { factTableId: "ft_b", rowFilters: [] },
        ],
      },
    };
    expect(() => processActivationMetric(metric, settings)).toThrow(
      '"Viewed and ordered" is now a compound metric and cannot be used for activation. Remove it as the experiment\'s activation metric.',
    );
  });
});
