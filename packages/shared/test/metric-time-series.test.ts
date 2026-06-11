import { metricTimeSeriesSchema } from "../src/validators/metric-time-series";
import type { MetricTimeSeries } from "../src/validators/metric-time-series";
import {
  isValidDataPoint,
  filterInvalidMetricTimeSeries,
} from "../src/util/metric-time-series";

type DataPoint = MetricTimeSeries["dataPoints"][number];
type Variation = DataPoint["variations"][number];

const control: Variation = { id: "0", name: "Control" };
const realVariation: Variation = {
  id: "1",
  name: "Variation",
  absolute: { value: 1, ci: [0.5, 1.5] },
};
const degenerateVariation: Variation = {
  id: "1",
  name: "Variation",
  absolute: { value: 0, ci: [0, 0] },
};
const noAbsoluteVariation: Variation = { id: "1", name: "Variation" };

function makeDataPoint(variations: Variation[]): DataPoint {
  return { date: new Date("2025-01-01T00:00:00Z"), variations };
}

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

describe("isValidDataPoint", () => {
  it("rejects a point with no variations or only control", () => {
    expect(isValidDataPoint(makeDataPoint([]))).toBe(false);
    expect(isValidDataPoint(makeDataPoint([control]))).toBe(false);
  });

  it("accepts a point with a non-degenerate treatment variation", () => {
    expect(isValidDataPoint(makeDataPoint([control, realVariation]))).toBe(
      true,
    );
  });

  it("rejects a point only when ALL treatment variations are degenerate", () => {
    expect(
      isValidDataPoint(makeDataPoint([control, degenerateVariation])),
    ).toBe(false);
    expect(
      isValidDataPoint(
        makeDataPoint([control, degenerateVariation, degenerateVariation]),
      ),
    ).toBe(false);
  });

  it("keeps a point when at least one treatment variation is non-degenerate", () => {
    expect(
      isValidDataPoint(
        makeDataPoint([control, degenerateVariation, realVariation]),
      ),
    ).toBe(true);
  });

  it("does not treat a missing absolute CI as degenerate", () => {
    expect(
      isValidDataPoint(makeDataPoint([control, noAbsoluteVariation])),
    ).toBe(true);
  });
});

describe("filterInvalidMetricTimeSeries", () => {
  function makeSeries(dataPoints: DataPoint[]): MetricTimeSeries {
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
      dataPoints,
    } as MetricTimeSeries;
  }

  it("drops invalid data points but keeps mixed-validity points", () => {
    const series = makeSeries([
      makeDataPoint([control, degenerateVariation]),
      makeDataPoint([control, degenerateVariation, realVariation]),
    ]);

    const [filtered] = filterInvalidMetricTimeSeries([series]);
    expect(filtered.dataPoints).toHaveLength(1);
    expect(filtered.dataPoints[0].variations).toContain(realVariation);
  });

  it("removes a series whose data points are all invalid", () => {
    const series = makeSeries([makeDataPoint([control, degenerateVariation])]);
    expect(filterInvalidMetricTimeSeries([series])).toHaveLength(0);
  });
});
