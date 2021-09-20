import { getValueCR } from "../src/services/stats";
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
