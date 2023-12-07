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
      bqIntegration["addCaseWhenTimeFilter"](
        "val",
        normalSqlMetric,
        false,
        false
      ).replace(/\s+/g, " ")
    ).toEqual(
      "(CASE WHEN m.timestamp >= d.timestamp AND m.timestamp <= DATETIME_ADD(d.timestamp, INTERVAL 72 HOUR) THEN val ELSE NULL END)"
    );

    expect(
      bqIntegration["addCaseWhenTimeFilter"](
        "val",
        normalSqlMetric,
        true,
        false
      ).replace(/\s+/g, " ")
    ).toEqual("(CASE WHEN m.timestamp >= d.timestamp THEN val ELSE NULL END)");

    expect(
      bqIntegration["addCaseWhenTimeFilter"](
        "val",
        normalSqlMetric,
        true,
        true
      ).replace(/\s+/g, " ")
    ).toEqual(
      "(CASE WHEN m.timestamp >= d.timestamp AND date_trunc(m.timestamp, DAY) <= dr.day THEN val ELSE NULL END)"
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
  it("correctly picks date windows", () => {
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

    const numeratorMetric: MetricInterface = {
      ...baseMetric,
      ...{
        conversionDelayHours: -4,
        conversionWindowHours: 24,
      },
    };
    const denominatorCountMetric: MetricInterface = {
      ...baseMetric,
      ...{
        type: "count",
        conversionDelayHours: 0,
        conversionWindowHours: 1,
      },
    };
    const denominatorBinomialMetric: MetricInterface = {
      ...baseMetric,
      ...{
        conversionDelayHours: 0,
        conversionWindowHours: 1,
      },
    };
    const activationMetric: MetricInterface = {
      ...baseMetric,
      ...{
        conversionDelayHours: 0,
        conversionWindowHours: 72,
      },
    };

    // standard metric
    expect(
      bqIntegration["getMaxHoursToConvert"](false, [numeratorMetric], null)
    ).toEqual(20);

    // funnel metric
    expect(
      bqIntegration["getMaxHoursToConvert"](
        true,
        [denominatorBinomialMetric].concat([numeratorMetric]),
        null
      )
    ).toEqual(21);

    // ratio metric
    expect(
      bqIntegration["getMaxHoursToConvert"](
        false,
        [denominatorCountMetric].concat([numeratorMetric]),
        null
      )
    ).toEqual(20);

    // ratio metric activated
    expect(
      bqIntegration["getMaxHoursToConvert"](
        false,
        [denominatorCountMetric].concat([numeratorMetric]),
        activationMetric
      )
    ).toEqual(92);
  });
});
