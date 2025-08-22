import BigQuery from "back-end/src/integrations/BigQuery";
import { MetricInterface } from "back-end/types/metric";
import { factTableFactory } from "./factories/FactTable.factory";
import { factMetricFactory } from "./factories/FactMetric.factory";

describe("bigquery integration", () => {
  let bqIntegration: BigQuery;
  beforeEach(() => {
    bqIntegration = new BigQuery("", {});
  });

  it("builds the correct aggregate metric column", () => {
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
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 72,
        delayUnit: "hours",
        delayValue: 0,
      },
      priorSettings: {
        override: false,
        proper: false,
        mean: 0,
        stddev: 0.1,
      },
      cappingSettings: {
        type: "",
        value: 0,
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
        new Date(),
      ).replace(/\s+/g, " "),
    ).toEqual(
      "(CASE WHEN m.timestamp >= d.timestamp AND m.timestamp <= DATETIME_ADD(d.timestamp, INTERVAL 72 HOUR) THEN val ELSE NULL END)",
    );

    const date = new Date();
    const endDateFilter = `AND m.timestamp <= ${bqIntegration["toTimestamp"](
      date,
    )}`;
    expect(
      bqIntegration["addCaseWhenTimeFilter"](
        "val",
        normalSqlMetric,
        true,
        date,
      ).replace(/\s+/g, " "),
    ).toEqual(
      `(CASE WHEN m.timestamp >= d.timestamp ${endDateFilter} THEN val ELSE NULL END)`,
    );

    expect(
      bqIntegration["getAggregateMetricColumn"]({
        metric: customNumberAggMetric,
      }),
    ).toEqual("(CASE WHEN value IS NOT NULL THEN 33 ELSE 0 END)");
    expect(
      bqIntegration["getAggregateMetricColumn"]({ metric: customCountAgg }),
    ).toEqual("COUNT(value) / (5 + COUNT(value))");
    expect(
      bqIntegration["getAggregateMetricColumn"]({ metric: normalSqlMetric }),
    ).toEqual("SUM(COALESCE(value, 0))");
  });
  it("correctly picks date windows", () => {
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
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 72,
        delayUnit: "hours",
        delayValue: 0,
      },
      cappingSettings: {
        type: "",
        value: 0,
      },
      priorSettings: {
        override: false,
        proper: false,
        mean: 0,
        stddev: 0.1,
      },
      userIdTypes: ["anonymous_id", "user_id"],
    };

    const numeratorMetric: MetricInterface = {
      ...baseMetric,
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 24,
        delayUnit: "hours",
        delayValue: -4,
      },
    };
    const denominatorCountMetric: MetricInterface = {
      ...baseMetric,
      type: "count",

      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 1,
        delayUnit: "hours",
        delayValue: 0,
      },
    };
    const denominatorBinomialMetric: MetricInterface = {
      ...baseMetric,
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 1,
        delayUnit: "hours",
        delayValue: 0,
      },
    };
    const activationMetric: MetricInterface = {
      ...baseMetric,
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 72,
        delayUnit: "hours",
        delayValue: 0,
      },
    };

    // standard metric
    expect(
      bqIntegration["getMaxHoursToConvert"](false, [numeratorMetric], null),
    ).toEqual(20);

    // funnel metric
    expect(
      bqIntegration["getMaxHoursToConvert"](
        true,
        [denominatorBinomialMetric].concat([numeratorMetric]),
        null,
      ),
    ).toEqual(21);

    // ratio metric
    expect(
      bqIntegration["getMaxHoursToConvert"](
        false,
        [denominatorCountMetric].concat([numeratorMetric]),
        null,
      ),
    ).toEqual(20);

    // ratio metric activated
    expect(
      bqIntegration["getMaxHoursToConvert"](
        false,
        [denominatorCountMetric].concat([numeratorMetric]),
        activationMetric,
      ),
    ).toEqual(92);
  });

  it("escape single quotes and backslash correctly", () => {
    expect(bqIntegration["escapeStringLiteral"](`test\\'string`)).toEqual(
      `test\\\\\\'string`,
    );
  });

  function trimLeadingWhitespace(str: string) {
    return str
      .split("\n")
      .map((line) => line.trimStart())
      .join("\n");
  }

  // ===== FACT METRIC TESTS =====
  it("generates basic fact metric CTE for mean metric", () => {
    const factTable = factTableFactory.build();
    const factMetric = factMetricFactory.build({
      metricType: "mean",
      numerator: {
        factTableId: factTable.id,
        column: "value",
        aggregation: "sum",
        filters: [],
      },
    });

    const factTableMap = new Map([[factTable.id, factTable]]);
    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = bqIntegration["getFactMetricCTE"]({
      metrics: [factMetric],
      factTableMap,
      baseIdType: "user_id",
      idJoinMap: {},
      startDate,
      endDate,
    });

    expect(trimLeadingWhitespace(result)).toEqual(
      "-- Fact Table (Test Fact Table)\n" +
        "SELECT\n" +
        "user_id as user_id,\n" +
        "CAST(m.timestamp as DATETIME) as timestamp,\n" +
        "-- Test Fact Metric\n" +
        "m.value as m0_value\n" +
        "FROM(\n" +
        "SELECT user_id, anonymous_id, timestamp, value FROM events\n" +
        ") m\n" +
        "\n" +
        "WHERE m.timestamp >= '2023-01-01 00:00:00' AND m.timestamp <= '2023-01-31 00:00:00'\n" +
        "",
    );
  });

  it("generates CTE with metric filters in where clause if all metrics have filters", () => {
    const factTableWithFilters = factTableFactory.build({
      filters: [
        {
          id: "filter1",
          dateCreated: new Date("2023-01-01"),
          dateUpdated: new Date("2023-01-01"),
          name: "Test Filter",
          description: "A test filter",
          value: "event_type = 'purchase'",
        },
      ],
    });

    // regular filter
    const factMetric = factMetricFactory.build({
      numerator: {
        factTableId: factTableWithFilters.id,
        column: "value",
        aggregation: "sum",
        filters: ["filter1"],
      },
    });
    // inline filter
    const factMetric2 = factMetricFactory.build({
      numerator: {
        factTableId: factTableWithFilters.id,
        column: "value",
        aggregation: "sum",
        inlineFilters: {
          country: ["UK"],
        },
      },
    });

    const factTableMap = new Map([
      [factTableWithFilters.id, factTableWithFilters],
    ]);
    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = bqIntegration["getFactMetricCTE"]({
      metrics: [factMetric, factMetric2],
      factTableMap,
      baseIdType: "user_id",
      idJoinMap: {},
      startDate,
      endDate,
      addFiltersToWhere: true,
    });

    expect(trimLeadingWhitespace(result)).toEqual(
      "-- Fact Table (Test Fact Table)\n" +
        "SELECT\n" +
        "user_id as user_id,\n" +
        "CAST(m.timestamp as DATETIME) as timestamp,\n" +
        "-- Test Fact Metric\n" +
        "CASE WHEN ((event_type = 'purchase')) THEN m.value ELSE NULL END as m0_value,\n" +
        "-- Test Fact Metric\n" +
        "CASE WHEN ((country = 'UK')) THEN m.value ELSE NULL END as m1_value\n" +
        "FROM(\n" +
        "SELECT user_id, anonymous_id, timestamp, value FROM events\n" +
        ") m\n" +
        "\n" +
        "WHERE m.timestamp >= '2023-01-01 00:00:00' AND m.timestamp <= '2023-01-31 00:00:00' AND (((event_type = 'purchase')) OR ((country = 'UK')))\n" +
        "",
    );

    // fact metric with no filter
    const factMetric3 = factMetricFactory.build({
      numerator: {
        factTableId: factTableWithFilters.id,
        column: "value",
        aggregation: "sum",
        filters: [],
      },
    });

    const result2 = bqIntegration["getFactMetricCTE"]({
      metrics: [factMetric, factMetric2, factMetric3],
      factTableMap,
      baseIdType: "user_id",
      idJoinMap: {},
      startDate,
      endDate,
      addFiltersToWhere: true,
    });

    // Has no filters since there is a metric missing a filter
    expect(trimLeadingWhitespace(result2)).toEqual(
      "-- Fact Table (Test Fact Table)\n" +
        "SELECT\n" +
        "user_id as user_id,\n" +
        "CAST(m.timestamp as DATETIME) as timestamp,\n" +
        "-- Test Fact Metric\n" +
        "CASE WHEN ((event_type = 'purchase')) THEN m.value ELSE NULL END as m0_value,\n" +
        "-- Test Fact Metric\n" +
        "CASE WHEN ((country = 'UK')) THEN m.value ELSE NULL END as m1_value,\n" +
        "-- Test Fact Metric\n" +
        "m.value as m2_value\n" +
        "FROM(\n" +
        "SELECT user_id, anonymous_id, timestamp, value FROM events\n" +
        ") m\n" +
        "\n" +
        "WHERE m.timestamp >= '2023-01-01 00:00:00' AND m.timestamp <= '2023-01-31 00:00:00'\n" +
        "",
    );
  });

  it("generates CTE without duplicate metric filters if they are the same", () => {
    const factTableWithFilters = factTableFactory.build({
      filters: [
        {
          id: "filter1",
          dateCreated: new Date("2023-01-01"),
          dateUpdated: new Date("2023-01-01"),
          name: "Test Filter",
          description: "A test filter",
          value: "event_type = 'purchase'",
        },
      ],
    });
    const factMetric1 = factMetricFactory.build({
      numerator: {
        factTableId: factTableWithFilters.id,
        column: "value",
        aggregation: "sum",
        filters: ["filter1"],
      },
    });
    const factMetric2 = factMetricFactory.build({
      numerator: {
        factTableId: factTableWithFilters.id,
        column: "value2",
        aggregation: "sum",
        filters: ["filter1"], // Same filter as factMetric1
      },
    });

    const factTableMap = new Map([
      [factTableWithFilters.id, factTableWithFilters],
    ]);
    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = bqIntegration["getFactMetricCTE"]({
      metrics: [factMetric1, factMetric2],
      factTableMap,
      baseIdType: "user_id",
      idJoinMap: {},
      startDate,
      endDate,
      addFiltersToWhere: true,
    });

    expect(trimLeadingWhitespace(result)).toEqual(
      "-- Fact Table (Test Fact Table)\n" +
        "SELECT\n" +
        "user_id as user_id,\n" +
        "CAST(m.timestamp as DATETIME) as timestamp,\n" +
        "-- Test Fact Metric\n" +
        "CASE WHEN ((event_type = 'purchase')) THEN m.value ELSE NULL END as m0_value,\n" +
        "-- Test Fact Metric\n" +
        "CASE WHEN ((event_type = 'purchase')) THEN m.value2 ELSE NULL END as m1_value\n" +
        "FROM(\n" +
        "SELECT user_id, anonymous_id, timestamp, value FROM events\n" +
        ") m\n" +
        "\n" +
        "WHERE m.timestamp >= '2023-01-01 00:00:00' AND m.timestamp <= '2023-01-31 00:00:00' AND (((event_type = 'purchase')))\n" +
        "",
    );
  });

  it("generates CTE with metric filters for a ratio metric where two filters are applied", () => {
    const factTableWithFilters = factTableFactory.build({
      filters: [
        {
          id: "filter1",
          dateCreated: new Date("2023-01-01"),
          dateUpdated: new Date("2023-01-01"),
          name: "Conversion Filter",
          description: "Filter for conversions",
          value: "event_type = 'purchase'",
        },
        {
          id: "filter2",
          dateCreated: new Date("2023-01-01"),
          dateUpdated: new Date("2023-01-01"),
          name: "Session Filter",
          description: "Filter for sessions",
          value: "event_type = 'session_start'",
        },
      ],
    });

    const ratioMetric = factMetricFactory.build({
      metricType: "ratio",
      numerator: {
        factTableId: factTableWithFilters.id,
        column: "conversions",
        aggregation: "sum",
        filters: ["filter1"],
      },
      denominator: {
        factTableId: factTableWithFilters.id,
        column: "sessions",
        aggregation: "sum",
        filters: ["filter2"],
      },
    });

    const factTableMap = new Map([
      [factTableWithFilters.id, factTableWithFilters],
    ]);
    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = bqIntegration["getFactMetricCTE"]({
      metrics: [ratioMetric],
      factTableMap,
      baseIdType: "user_id",
      idJoinMap: {},
      startDate,
      endDate,
      addFiltersToWhere: true,
    });

    expect(trimLeadingWhitespace(result)).toEqual(
      "-- Fact Table (Test Fact Table)\n" +
        "SELECT\n" +
        "user_id as user_id,\n" +
        "CAST(m.timestamp as DATETIME) as timestamp,\n" +
        "-- Test Fact Metric\n" +
        "CASE WHEN ((event_type = 'purchase')) THEN m.conversions ELSE NULL END as m0_value,\n" +
        "-- Test Fact Metric (denominator)\n" +
        "CASE WHEN ((event_type = 'session_start')) THEN m.sessions ELSE NULL END as m0_denominator\n" +
        "FROM(\n" +
        "SELECT user_id, anonymous_id, timestamp, value FROM events\n" +
        ") m\n" +
        "\n" +
        "WHERE m.timestamp >= '2023-01-01 00:00:00' AND m.timestamp <= '2023-01-31 00:00:00' AND (((event_type = 'purchase')) OR ((event_type = 'session_start')))\n" +
        "",
    );
  });

  it("generates CTE without metric filters in where clause if a numerator or a denominator has no filter", () => {
    const factTableWithFilters = factTableFactory.build({
      filters: [
        {
          id: "filter1",
          dateCreated: new Date("2023-01-01"),
          dateUpdated: new Date("2023-01-01"),
          name: "Conversion Filter",
          description: "Filter for conversions",
          value: "event_type = 'purchase'",
        },
      ],
    });
    const ratioMetricWithDenominatorNoFilter = factMetricFactory.build({
      metricType: "ratio",
      numerator: {
        factTableId: factTableWithFilters.id,
        column: "conversions",
        aggregation: "sum",
        filters: ["filter1"], // Has filter
      },
      denominator: {
        factTableId: factTableWithFilters.id,
        column: "sessions",
        aggregation: "sum",
        filters: [], // No filter
      },
    });

    const factTableMap = new Map([
      [factTableWithFilters.id, factTableWithFilters],
    ]);
    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = bqIntegration["getFactMetricCTE"]({
      metrics: [ratioMetricWithDenominatorNoFilter],
      factTableMap,
      baseIdType: "user_id",
      idJoinMap: {},
      startDate,
      endDate,
      addFiltersToWhere: true,
    });

    // Has no filters since there is a denominator missing a filter
    expect(trimLeadingWhitespace(result)).toEqual(
      "-- Fact Table (Test Fact Table)\n" +
        "SELECT\n" +
        "user_id as user_id,\n" +
        "CAST(m.timestamp as DATETIME) as timestamp,\n" +
        "-- Test Fact Metric\n" +
        "CASE WHEN ((event_type = 'purchase')) THEN m.conversions ELSE NULL END as m0_value,\n" +
        "-- Test Fact Metric (denominator)\n" +
        "m.sessions as m0_denominator\n" +
        "FROM(\n" +
        "SELECT user_id, anonymous_id, timestamp, value FROM events\n" +
        ") m\n" +
        "\n" +
        "WHERE m.timestamp >= '2023-01-01 00:00:00' AND m.timestamp <= '2023-01-31 00:00:00'\n" +
        "",
    );

    const ratioMetricWithNumeratorNoFilter = factMetricFactory.build({
      metricType: "ratio",
      numerator: {
        factTableId: factTableWithFilters.id,
        column: "conversions",
        aggregation: "sum",
        filters: [], // No filter
      },
      denominator: {
        factTableId: factTableWithFilters.id,
        column: "sessions",
        aggregation: "sum",
        filters: ["filter1"], // No filter
      },
    });

    const result2 = bqIntegration["getFactMetricCTE"]({
      metrics: [ratioMetricWithNumeratorNoFilter],
      factTableMap,
      baseIdType: "user_id",
      idJoinMap: {},
      startDate,
      endDate,
      addFiltersToWhere: true,
    });

    // Has no filters since there is a numerator missing a filter
    expect(trimLeadingWhitespace(result2)).toEqual(
      "-- Fact Table (Test Fact Table)\n" +
        "SELECT\n" +
        "user_id as user_id,\n" +
        "CAST(m.timestamp as DATETIME) as timestamp,\n" +
        "-- Test Fact Metric\n" +
        "m.conversions as m0_value,\n" +
        "-- Test Fact Metric (denominator)\n" +
        "CASE WHEN ((event_type = 'purchase')) THEN m.sessions ELSE NULL END as m0_denominator\n" +
        "FROM(\n" +
        "SELECT user_id, anonymous_id, timestamp, value FROM events\n" +
        ") m\n" +
        "\n" +
        "WHERE m.timestamp >= '2023-01-01 00:00:00' AND m.timestamp <= '2023-01-31 00:00:00'\n" +
        "",
    );
  });
});
