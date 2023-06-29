import BigQuery from "../src/integrations/BigQuery";
import { MetricInterface } from "../types/metric";

describe("bigquery integration", () => {
  it("builds the correct aggregate metric column", () => {
    const bqIntegration = new BigQuery("", {});
    const baseMetric: MetricInterface = {
      datasource: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "",
      id: "",
      ignoreNulls: false,
      inverse: false,
      name: "",
      organization: "",
      owner: "",
      queries: [],
      runStarted: null,
      type: "binomial",
      userIdColumns: {
        user_id: "user_id",
        anonymous_id: "anonymous_id",
      },
      userIdTypes: ["anonymous_id", "user_id"],
    };

    const customNumberAggMetric: MetricInterface = {
      ...baseMetric,
      ...{
        type: "count",
        queryFormat: "sql",
        aggregation: "33",
      },
    };
    const customCountAgg: MetricInterface = {
      ...baseMetric,
      ...{
        type: "count",
        queryFormat: "sql",
        aggregation: "COUNT(*) / (5 + COUNT(*))",
      },
    };
    const normalSqlMetric: MetricInterface = {
      ...baseMetric,
      ...{
        type: "count",
        queryFormat: "sql",
      },
    };
    // builder metrics not tested

    expect(
      bqIntegration["addCaseWhenTimeFilter"]("val", false, false).replace(
        /\s+/g,
        " "
      )
    ).toEqual(
      "(CASE WHEN m.timestamp >= d.conversion_start AND m.timestamp <= d.conversion_end THEN val ELSE NULL END)"
    );

    expect(
      bqIntegration["addCaseWhenTimeFilter"]("val", true, false).replace(
        /\s+/g,
        " "
      )
    ).toEqual(
      "(CASE WHEN m.timestamp >= d.conversion_start THEN val ELSE NULL END)"
    );

    expect(
      bqIntegration["addCaseWhenTimeFilter"]("val", true, true).replace(
        /\s+/g,
        " "
      )
    ).toEqual(
      "(CASE WHEN m.timestamp >= d.conversion_start AND date_trunc(m.timestamp, DAY) <= dr.day THEN val ELSE NULL END)"
    );

    expect(
      bqIntegration["getAggregateMetricColumn"](customNumberAggMetric)
    ).toEqual("(CASE WHEN value IS NOT NULL THEN 33 ELSE 0 END)");
    expect(bqIntegration["getAggregateMetricColumn"](customCountAgg)).toEqual(
      "COUNT(value) / (5 + COUNT(value))"
    );
    expect(bqIntegration["getAggregateMetricColumn"](normalSqlMetric)).toEqual(
      "SUM(COALESCE(value, 0))"
    );
  });
});
