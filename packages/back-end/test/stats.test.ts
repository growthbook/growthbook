import {
  getValueCR,
  mergeMetricStats,
  addNonconvertingUsersToStats,
  srm,
} from "../src/services/stats";
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

  it("merges stats with not enough users", () => {
    const a = {
      count: 0,
      mean: 0,
      stddev: 0,
    };
    const b = {
      count: 1,
      mean: 15,
      stddev: 0,
    };
    const merged = mergeMetricStats(a, b);

    expect(merged).toEqual({
      count: 1,
      mean: 15,
      stddev: 0,
    });
  });

  it("adjusts stats when ignoreNull is false", () => {
    const res = addNonconvertingUsersToStats(
      {
        count: 100,
        mean: 10,
        stddev: 5,
      },
      500
    );
    expect(res).toEqual({
      mean: 2,
      stddev: 4.58170099067321,
    });
  });

  it("calculates SRM correctly", () => {
    expect(srm([1025, 950], [0.5, 0.5])).toEqual(0.09148192105687125);
  });

  it("calculates SRM when a variation has weight=0", () => {
    expect(srm([1000, 1000, 50], [0.5, 0.5, 0])).toEqual(0.5434834098395639);
  });

  it("returns SRM=1 when not enough users", () => {
    expect(srm([1, 0], [0.5, 0.5])).toEqual(1);
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
