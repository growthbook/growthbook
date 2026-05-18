import { metricTimeSeriesSchema } from "../src/validators/metric-time-series";

function makeMetricTimeSeries(overrides: Record<string, unknown> = {}) {
  return {
    id: "mts_1",
    organization: "org_1",
    dateCreated: new Date("2025-01-01T00:00:00Z"),
    dateUpdated: new Date("2025-01-01T00:00:00Z"),
    metricId: "met_1",
    source: "experiment",
    sourceId: "exp_1",
    sourcePhase: 0,
    lastExperimentSettingsHash: "experiment_hash",
    lastMetricSettingsHash: "metric_hash",
    dataPoints: [
      {
        date: new Date("2025-01-01T00:00:00Z"),
        variations: [
          { id: "0", name: "Control" },
          {
            id: "1",
            name: "Variation",
            absolute: { value: 1, ci: [0.5, 1.5] },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("metricTimeSeriesSchema", () => {
  it("accepts main-series docs without dimension fields", () => {
    expect(
      metricTimeSeriesSchema.safeParse(makeMetricTimeSeries()).success,
    ).toBe(true);
  });

  it("accepts dimension-series docs with a dimension tuple", () => {
    expect(
      metricTimeSeriesSchema.safeParse(
        makeMetricTimeSeries({
          dimensionId: "precomputed:country",
          dimensionValue: "US",
        }),
      ).success,
    ).toBe(true);
  });

  it("accepts dimension-series docs with an empty string dimension value", () => {
    expect(
      metricTimeSeriesSchema.safeParse(
        makeMetricTimeSeries({
          dimensionId: "precomputed:country",
          dimensionValue: "",
        }),
      ).success,
    ).toBe(true);
  });

  it.each([
    { dimensionId: "precomputed:country" },
    { dimensionValue: "US" },
    { dimensionId: "", dimensionValue: "US" },
  ])("rejects invalid dimension tuple %#", (overrides) => {
    expect(
      metricTimeSeriesSchema.safeParse(makeMetricTimeSeries(overrides)).success,
    ).toBe(false);
  });
});
