import { MAX_FUNNEL_STEPS } from "../src/funnels";
import {
  postFactMetricValidator,
  updateFactMetricValidator,
} from "../src/validators";

const numerator = {
  factTableId: "ft_orders",
  column: "$$distinctUsers",
};

const step = {
  name: "Viewed product",
  factTableId: "ft_events",
  rowFilters: [
    {
      operator: "=" as const,
      column: "event_name",
      values: ["viewed_product"],
    },
  ],
  optional: false,
  conversionWindow: null,
};

const funnelSettings = {
  steps: [
    step,
    {
      ...step,
      name: "Purchased",
      rowFilters: [{ ...step.rowFilters[0], values: ["purchased"] }],
    },
  ],
};

describe("Fact Metric REST validators", () => {
  it("accepts funnel creation without a numerator", () => {
    expect(() =>
      postFactMetricValidator.bodySchema.parse({
        name: "Checkout funnel",
        metricType: "funnel",
        funnelSettings,
      }),
    ).not.toThrow();
  });

  it("rejects a numerator on funnel creation", () => {
    expect(() =>
      postFactMetricValidator.bodySchema.parse({
        name: "Checkout funnel",
        metricType: "funnel",
        numerator,
        funnelSettings,
      }),
    ).toThrow(/numerator is not allowed/);
  });

  it("requires a numerator for standard metric creation", () => {
    expect(() =>
      postFactMetricValidator.bodySchema.parse({
        name: "Purchases",
        metricType: "proportion",
      }),
    ).toThrow(/numerator is required/);
  });

  it("requires funnel settings when changing metric type to funnel", () => {
    expect(() =>
      updateFactMetricValidator.bodySchema.parse({
        metricType: "funnel",
      }),
    ).toThrow(/funnelSettings is required/);
  });

  it("caps the number of funnel steps", () => {
    expect(() =>
      postFactMetricValidator.bodySchema.parse({
        name: "Oversized funnel",
        metricType: "funnel",
        funnelSettings: {
          steps: Array.from({ length: MAX_FUNNEL_STEPS + 1 }, (_, index) => ({
            ...step,
            name: `Step ${index + 1}`,
          })),
        },
      }),
    ).toThrow();
  });
});
