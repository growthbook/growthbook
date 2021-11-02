import { getValueCR, mergeMetricStats } from "../src/services/stats";
import { MetricInterface } from "../types/metric";

const baseMetric: MetricInterface = {
  id: "",
  datasource: "",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  description: "",
  earlyStart: false,
  inverse: false,
  name: "",
  organization: "",
  type: "revenue",
  queries: [],
  runStarted: new Date(),
  ignoreNulls: false,
};

describe("stats", () => {
  it("merges metric stats", () => {
    const a = {
      count: 100,
      mean: 10,
      stddev: 5,
    };
    const b = {
      count: 150,
      mean: 15,
      stddev: 3,
    };
    const merged = mergeMetricStats(a, b);

    expect(merged).toEqual({
      count: 250,
      mean: 13,
      stddev: 4.62054083310184,
    });
  });

  it("gets value and conversion rate", () => {
    expect(
      getValueCR(
        {
          ...baseMetric,
          ignoreNulls: false,
        },
        500,
        1000,
        10000
      )
    ).toEqual({
      cr: 0.05,
      users: 10000,
      value: 500,
    });

    expect(
      getValueCR(
        {
          ...baseMetric,
          ignoreNulls: true,
        },
        500,
        1000,
        10000
      )
    ).toEqual({
      cr: 0.5,
      users: 1000,
      value: 500,
    });
  });
});
