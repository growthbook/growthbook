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

    const binomialMetric = { ...baseMetric };
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
      bqIntegration["getAggregateMetricColumn"](binomialMetric, "noWindow")
    ).toEqual("MAX(1)");
    expect(
      bqIntegration["getAggregateMetricColumn"](binomialMetric, "post")
    ).toEqual(
      "MAX((CASE WHEN m.timestamp >= d.conversion_start THEN 1 ELSE NULL END))"
    );
    expect(
      bqIntegration["getAggregateMetricColumn"](binomialMetric, "pre")
    ).toEqual(
      "MAX((CASE WHEN m.timestamp < d.preexposure_end THEN 1 ELSE NULL END))"
    );
    expect(
      bqIntegration["getAggregateMetricColumn"](
        customNumberAggMetric,
        "noWindow"
      )
    ).toEqual("MAX(33)");
    expect(
      bqIntegration["getAggregateMetricColumn"](customNumberAggMetric, "post")
    ).toEqual(
      "MAX((CASE WHEN m.timestamp >= d.conversion_start THEN 33 ELSE NULL END))"
    );
    expect(
      bqIntegration["getAggregateMetricColumn"](customNumberAggMetric, "pre")
    ).toEqual(
      "MAX((CASE WHEN m.timestamp < d.preexposure_end THEN 33 ELSE NULL END))"
    );
    expect(
      bqIntegration["getAggregateMetricColumn"](customCountAgg, "noWindow")
    ).toEqual("COUNT(*) / (5 + COUNT(*))");
    expect(
      bqIntegration["getAggregateMetricColumn"](customCountAgg, "post")
    ).toEqual("COUNT(*) / (5 + COUNT(*))");
    expect(
      bqIntegration["getAggregateMetricColumn"](customCountAgg, "pre")
    ).toEqual("COUNT(*) / (5 + COUNT(*))");
    expect(
      bqIntegration["getAggregateMetricColumn"](normalSqlMetric, "noWindow")
    ).toEqual("SUM(m.value)");
    expect(
      bqIntegration["getAggregateMetricColumn"](normalSqlMetric, "post")
    ).toEqual(
      "SUM((CASE WHEN m.timestamp >= d.conversion_start THEN m.value ELSE NULL END))"
    );
    expect(
      bqIntegration["getAggregateMetricColumn"](normalSqlMetric, "pre")
    ).toEqual(
      "SUM((CASE WHEN m.timestamp < d.preexposure_end THEN m.value ELSE NULL END))"
    );
  });
});
