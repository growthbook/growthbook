import { getAdjustedStats, getValueCR, srm } from "../src/services/stats";
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
  it("calculates srm correctly", () => {
    expect(srm([1000, 1200], [0.5, 0.5]).toFixed(9)).toEqual("0.000020079");
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

  it("calculates adjusted mean and stddev", () => {
    const adjusted = getAdjustedStats(
      {
        count: 1000,
        mean: 5,
        stddev: 3,
      },
      2000
    );
    expect(adjusted.mean).toEqual(2.5);
    expect(adjusted.stddev.toFixed(9)).toEqual("3.278852762");
  });
});
