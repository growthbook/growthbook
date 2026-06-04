import { format } from "shared/sql";
import { MetricInterface } from "shared/types/metric";
import {
  ColumnRef,
  FactMetricInterface,
  FactMetricType,
  MetricCappingSettings,
  RowFilter,
} from "shared/types/fact-table";
import { ExposureQuery } from "shared/types/datasource";
import { SqlDialect } from "shared/types/sql";
import BigQuery from "back-end/src/integrations/BigQuery";
import Snowflake from "back-end/src/integrations/Snowflake";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { mysqlDialect } from "back-end/src/integrations/dialects/mysql";
import { clickHouseDialect } from "back-end/src/integrations/dialects/clickhouse";
import { snowflakeDialect } from "back-end/src/integrations/dialects/snowflake";
import { addCaseWhenTimeFilter } from "back-end/src/integrations/sql/clauses/add-case-when-time-filter";
import { getAggregateMetricColumnLegacyMetrics } from "back-end/src/integrations/sql/columns/aggregate-metric-column-legacy-metrics";
import { getMaxHoursToConvert } from "back-end/src/integrations/sql/dates/max-hours-to-convert";
import { getFactMetricCTE } from "back-end/src/integrations/sql/ctes/fact-metric-cte";
import { getExperimentFactMetricsQuery } from "back-end/src/integrations/sql/queries/experiment-fact-metrics-query";
import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";
import { getFeatureEvalDiagnosticsQuery } from "back-end/src/integrations/sql/queries/feature-eval-diagnostics-query";
import { factMetricFactory } from "./factories/FactMetric.factory";
import { factTableFactory } from "./factories/FactTable.factory";

describe("bigquery integration", () => {
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
      addCaseWhenTimeFilter(bigQueryDialect, {
        col: "val",
        metric: normalSqlMetric,
        overrideConversionWindows: false,
        endDate: new Date(),
        metricTimestampColExpr: "m.timestamp",
        exposureTimestampColExpr: "d.timestamp",
      }).replace(/\s+/g, " "),
    ).toEqual(
      "(CASE WHEN m.timestamp >= d.timestamp AND m.timestamp <= DATETIME_ADD(d.timestamp, INTERVAL 72 HOUR) THEN val ELSE NULL END)",
    );

    const date = new Date();
    const endDateFilter = `AND m.timestamp <= ${bigQueryDialect.toTimestamp(
      date,
    )}`;
    expect(
      addCaseWhenTimeFilter(bigQueryDialect, {
        col: "val",
        metric: normalSqlMetric,
        overrideConversionWindows: true,
        endDate: date,
        metricTimestampColExpr: "m.timestamp",
        exposureTimestampColExpr: "d.timestamp",
      }).replace(/\s+/g, " "),
    ).toEqual(
      `(CASE WHEN m.timestamp >= d.timestamp ${endDateFilter} THEN val ELSE NULL END)`,
    );

    expect(
      getAggregateMetricColumnLegacyMetrics(bigQueryDialect, {
        metric: customNumberAggMetric,
      }),
    ).toEqual("(CASE WHEN value IS NOT NULL THEN 33 ELSE 0 END)");
    expect(
      getAggregateMetricColumnLegacyMetrics(bigQueryDialect, {
        metric: customCountAgg,
      }),
    ).toEqual("COUNT(value) / (5 + COUNT(value))");
    expect(
      getAggregateMetricColumnLegacyMetrics(bigQueryDialect, {
        metric: normalSqlMetric,
      }),
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
    expect(getMaxHoursToConvert(false, [numeratorMetric], null)).toEqual(20);

    // funnel metric
    expect(
      getMaxHoursToConvert(
        true,
        [denominatorBinomialMetric].concat([numeratorMetric]),
        null,
      ),
    ).toEqual(21);

    // ratio metric
    expect(
      getMaxHoursToConvert(
        false,
        [denominatorCountMetric].concat([numeratorMetric]),
        null,
      ),
    ).toEqual(20);

    // ratio metric activated
    expect(
      getMaxHoursToConvert(
        false,
        [denominatorCountMetric].concat([numeratorMetric]),
        activationMetric,
      ),
    ).toEqual(92);
  });

  it("escape single quotes and backslash correctly", () => {
    expect(bigQueryDialect.escapeStringLiteral(`test\\'string`)).toEqual(
      `test\\\\\\'string`,
    );
  });

  it("escapes backslash and single quotes for MySQL", () => {
    expect(mysqlDialect.escapeStringLiteral(`test\\'string`)).toEqual(
      `test\\\\''string`,
    );
  });

  it("escapes backslash and single quotes for ClickHouse", () => {
    expect(clickHouseDialect.escapeStringLiteral(`test\\'string`)).toEqual(
      `test\\\\''string`,
    );
  });

  it("escapes backslash and single quotes for Snowflake", () => {
    expect(snowflakeDialect.escapeStringLiteral(`test\\'string`)).toEqual(
      `test\\\\''string`,
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
      },
    });

    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = getFactMetricCTE(bigQueryDialect, {
      metricsWithIndices: [{ metric: factMetric, index: 0 }],
      factTable,
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

  it("substitutes {{experimentId}} in fact table SQL when experimentId is provided", () => {
    const factTable = factTableFactory.build({
      sql: "SELECT user_id, timestamp, value FROM events WHERE sample_type = CONCAT('experiment:', '{{experimentId}}')",
    });
    const factMetric = factMetricFactory.build({
      metricType: "mean",
      numerator: {
        factTableId: factTable.id,
        column: "value",
        aggregation: "sum",
      },
    });

    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = getFactMetricCTE(bigQueryDialect, {
      metricsWithIndices: [{ metric: factMetric, index: 0 }],
      factTable,
      baseIdType: "user_id",
      idJoinMap: {},
      startDate,
      endDate,
      experimentId: "my-experiment",
    });

    expect(result).toContain(
      "WHERE sample_type = CONCAT('experiment:', 'my-experiment')",
    );

    // Outside experiment context, falls back to '%' so the variable is still
    // valid (e.g. for `LIKE '{{experimentId}}'` patterns or column introspection).
    const resultNoExperiment = getFactMetricCTE(bigQueryDialect, {
      metricsWithIndices: [{ metric: factMetric, index: 0 }],
      factTable,
      baseIdType: "user_id",
      idJoinMap: {},
      startDate,
      endDate,
    });

    expect(resultNoExperiment).toContain(
      "WHERE sample_type = CONCAT('experiment:', '%')",
    );
  });

  it("substitutes {{phase.index}} in fact table SQL when phase is provided", () => {
    const factTable = factTableFactory.build({
      sql: "SELECT user_id, timestamp, value FROM events WHERE phase_index = '{{phase.index}}'",
    });
    const factMetric = factMetricFactory.build({
      metricType: "mean",
      numerator: {
        factTableId: factTable.id,
        column: "value",
        aggregation: "sum",
      },
    });

    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = getFactMetricCTE(bigQueryDialect, {
      metricsWithIndices: [{ metric: factMetric, index: 0 }],
      factTable,
      baseIdType: "user_id",
      idJoinMap: {},
      startDate,
      endDate,
      phase: { index: "2" },
    });

    expect(result).toContain("WHERE phase_index = '2'");
  });

  it("substitutes {{customFields.*}} in fact table SQL when custom fields are provided", () => {
    const factTable = factTableFactory.build({
      sql: "SELECT user_id, timestamp, value FROM events WHERE region = {{sqlstring customFields.region}}",
    });
    const factMetric = factMetricFactory.build({
      metricType: "mean",
      numerator: {
        factTableId: factTable.id,
        column: "value",
        aggregation: "sum",
      },
    });

    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = getFactMetricCTE(bigQueryDialect, {
      metricsWithIndices: [{ metric: factMetric, index: 0 }],
      factTable,
      baseIdType: "user_id",
      idJoinMap: {},
      startDate,
      endDate,
      customFields: { region: "north-america" },
    });

    expect(result).toContain("WHERE region = 'north-america'");
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
        rowFilters: [
          {
            operator: "saved_filter",
            values: ["filter1"],
          },
        ],
      },
    });
    // inline filter
    const factMetric2 = factMetricFactory.build({
      numerator: {
        factTableId: factTableWithFilters.id,
        column: "value",
        aggregation: "sum",
        rowFilters: [
          {
            operator: "=",
            column: "country",
            values: ["UK"],
          },
        ],
      },
    });

    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = getFactMetricCTE(bigQueryDialect, {
      metricsWithIndices: [factMetric, factMetric2].map((metric, index) => ({
        metric,
        index,
      })),
      factTable: factTableWithFilters,
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
        "WHERE m.timestamp >= '2023-01-01 00:00:00' AND m.timestamp <= '2023-01-31 00:00:00' AND ((event_type = 'purchase')\nOR\n(country = 'UK'))\n" +
        "",
    );

    // fact metric with no filter
    const factMetric3 = factMetricFactory.build({
      numerator: {
        factTableId: factTableWithFilters.id,
        column: "value",
        aggregation: "sum",
      },
    });

    const result2 = getFactMetricCTE(bigQueryDialect, {
      metricsWithIndices: [factMetric, factMetric2, factMetric3].map(
        (metric, index) => ({ metric, index }),
      ),
      factTable: factTableWithFilters,
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
        rowFilters: [
          {
            operator: "saved_filter",
            values: ["filter1"],
          },
        ],
      },
    });
    const factMetric2 = factMetricFactory.build({
      numerator: {
        factTableId: factTableWithFilters.id,
        column: "value2",
        aggregation: "sum",
        rowFilters: [
          {
            operator: "saved_filter",
            values: ["filter1"],
          },
        ],
      },
    });

    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = getFactMetricCTE(bigQueryDialect, {
      metricsWithIndices: [factMetric1, factMetric2].map((metric, index) => ({
        metric,
        index,
      })),
      factTable: factTableWithFilters,
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
        "WHERE m.timestamp >= '2023-01-01 00:00:00' AND m.timestamp <= '2023-01-31 00:00:00' AND (event_type = 'purchase')\n" +
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
        rowFilters: [
          {
            operator: "saved_filter",
            values: ["filter1"],
          },
        ],
      },
      denominator: {
        factTableId: factTableWithFilters.id,
        column: "sessions",
        aggregation: "sum",
        rowFilters: [
          {
            operator: "saved_filter",
            values: ["filter2"],
          },
        ],
      },
    });

    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = getFactMetricCTE(bigQueryDialect, {
      metricsWithIndices: [{ metric: ratioMetric, index: 0 }],
      factTable: factTableWithFilters,
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
        "WHERE m.timestamp >= '2023-01-01 00:00:00' AND m.timestamp <= '2023-01-31 00:00:00' AND ((event_type = 'purchase')\nOR\n(event_type = 'session_start'))\n" +
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
        rowFilters: [
          {
            operator: "saved_filter",
            values: ["filter1"],
          },
        ],
      },
      denominator: {
        factTableId: factTableWithFilters.id,
        column: "sessions",
        aggregation: "sum",
        // No filter
        rowFilters: [],
      },
    });

    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = getFactMetricCTE(bigQueryDialect, {
      metricsWithIndices: [
        { metric: ratioMetricWithDenominatorNoFilter, index: 0 },
      ],
      factTable: factTableWithFilters,
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
        rowFilters: [],
      },
      denominator: {
        factTableId: factTableWithFilters.id,
        column: "sessions",
        aggregation: "sum",
        rowFilters: [
          {
            operator: "saved_filter",
            values: ["filter1"],
          },
        ],
      },
    });

    const result2 = getFactMetricCTE(bigQueryDialect, {
      metricsWithIndices: [
        { metric: ratioMetricWithNumeratorNoFilter, index: 0 },
      ],
      factTable: factTableWithFilters,
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

describe("full fact metric experiment query - bigquery", () => {
  let bqIntegration: BigQuery;

  // Empty exposureQueryId resolves to lookup id "anonymous_id" in getExposureQuery.
  // Real config avoids jest.spyOn on the module export (non-configurable under @swc/jest).
  const testExposureQuery: ExposureQuery = {
    id: "anonymous_id",
    name: "Exposure",
    description: "Exposure",
    query: "*",
    userIdType: "user_id",
    dimensions: [],
  };

  beforeEach(() => {
    // @ts-expect-error -- context not needed for test
    bqIntegration = new BigQuery("", {
      settings: {
        queries: {
          exposure: [testExposureQuery],
        },
      },
    });
  });

  // Create test fact tables
  const ordersFactTable = factTableFactory.build({
    id: "orders",
    name: "Orders Fact Table",
    sql: "*",
    filters: [
      {
        id: "orders.mobile",
        dateCreated: new Date("2023-01-01"),
        dateUpdated: new Date("2023-01-01"),
        name: "Mobile App Orders",
        description: "Filter for mobile app orders",
        value: "app = 'mobile'",
      },
    ],
  });

  const eventsFactTable = factTableFactory.build({
    id: "events",
    name: "Events Fact Table",
    sql: "*",
    filters: [
      {
        id: "events.mobile",
        dateCreated: new Date("2023-01-01"),
        dateUpdated: new Date("2023-01-01"),
        name: "Mobile App Events",
        description: "Filter for mobile app events",
        value: "app = 'mobile'",
      },
    ],
  });

  const cappingTypes: MetricCappingSettings["type"][] = [
    "",
    "percentile",
    "absolute",
  ];
  const aggregationTypes: ColumnRef["aggregation"][] = [
    "sum",
    "count distinct",
    "max",
  ];

  const inlineFilters: (RowFilter | undefined)[] = [
    undefined,
    {
      column: "type",
      operator: "=",
      values: ["discount"],
    },
  ];

  const filters: (RowFilter | undefined)[] = [
    undefined,
    {
      operator: "saved_filter",
      values: ["orders.mobile"],
    },
  ];
  const aggregateFilters: {
    aggregateFilter: ColumnRef["aggregateFilter"];
    aggregateFilterColumn: ColumnRef["aggregateFilterColumn"];
  }[] = [
    { aggregateFilter: undefined, aggregateFilterColumn: undefined },
    {
      aggregateFilter: ">= 3",
      aggregateFilterColumn: "qty",
    },
  ];
  const columns: ColumnRef["column"][] = [
    "amount",
    "$$count",
    "$$distinctUsers",
    "$$distinctDates",
  ];
  const binomialColumns: ColumnRef["column"][] = ["$$distinctUsers"];
  const quantileSettings: FactMetricInterface["quantileSettings"][] = [
    {
      type: "unit",
      quantile: 0.9,
      ignoreZeros: false,
    },
    { type: "unit", quantile: 0.9, ignoreZeros: true },
    { type: "event", quantile: 0.9, ignoreZeros: false },
    { type: "event", quantile: 0.9, ignoreZeros: true },
  ];
  const windowSettings: FactMetricInterface["windowSettings"][] = [
    {
      type: "",
      delayValue: 0,
      delayUnit: "hours",
      windowValue: 0,
      windowUnit: "hours",
    },
    {
      type: "conversion",
      windowUnit: "hours",
      windowValue: 72,
      delayUnit: "hours",
      delayValue: -24,
    },
    {
      type: "lookback",
      delayValue: 0,
      delayUnit: "hours",
      windowValue: 2,
      windowUnit: "days",
    },
  ];
  const retentionWindowSettings: FactMetricInterface["windowSettings"][] = [
    {
      type: "",
      delayValue: 6,
      delayUnit: "days",
      windowValue: 0,
      windowUnit: "days",
    },
  ];
  const regressionAdjustmentSettings: {
    regressionAdjustmentEnabled: boolean;
    regressionAdjustmentDays: number;
  }[] = [
    {
      regressionAdjustmentEnabled: false,
      regressionAdjustmentDays: 0,
    },
    {
      regressionAdjustmentEnabled: true,
      regressionAdjustmentDays: 4,
    },
  ];

  function generateFactMetrics(): FactMetricInterface[] {
    const metrics: FactMetricInterface[] = [];

    // Type-safe metric generators for each metric type
    const generators = {
      mean: () => {
        for (const cappingType of cappingTypes) {
          for (const aggregationType of aggregationTypes) {
            for (const column of columns) {
              for (const inlineFilter of inlineFilters) {
                for (const filter of filters) {
                  for (const windowSetting of windowSettings) {
                    for (const regressionSetting of regressionAdjustmentSettings) {
                      const metric = createMetric({
                        metricType: "mean",
                        cappingType,
                        aggregationType,
                        column,
                        inlineFilter,
                        filter,
                        windowSetting,
                        regressionSetting,
                      });
                      metrics.push(metric);
                    }
                  }
                }
              }
            }
          }
        }
      },

      quantile: () => {
        for (const quantileSetting of quantileSettings) {
          const quantileAggregationTypes =
            quantileSetting?.type === "event" ? [undefined] : aggregationTypes;
          for (const aggregationType of quantileAggregationTypes) {
            const quantileColumns =
              quantileSetting?.type === "event" ? ["amount"] : columns;
            for (const column of quantileColumns) {
              for (const windowSetting of windowSettings) {
                const metric = createMetric({
                  metricType: "quantile",
                  cappingType: undefined,
                  aggregationType,
                  column,
                  inlineFilter: undefined,
                  filter: undefined,
                  windowSetting,
                  regressionSetting: undefined,
                  quantileSetting,
                });
                metrics.push(metric);
              }
            }
          }
        }
      },

      proportion: () => {
        for (const column of binomialColumns) {
          for (const inlineFilter of inlineFilters) {
            for (const filter of filters) {
              for (const aggregateFilter of aggregateFilters) {
                for (const windowSetting of windowSettings) {
                  for (const regressionSetting of regressionAdjustmentSettings) {
                    const metric = createMetric({
                      metricType: "proportion",
                      column,
                      inlineFilter,
                      filter,
                      windowSetting,
                      regressionSetting,
                      aggregateFilter: aggregateFilter.aggregateFilter,
                      aggregateFilterColumn:
                        aggregateFilter.aggregateFilterColumn,
                    });
                    metrics.push(metric);
                  }
                }
              }
            }
          }
        }
      },

      ratio: () => {
        // aggregate filter on numerator not represented
        // also skipping filters for ratio metrics
        for (const cappingType of cappingTypes) {
          // skip absolute capping
          if (cappingType === "absolute") {
            continue;
          }
          for (const aggregationType of aggregationTypes) {
            // skip max aggregation type
            if (aggregationType === "max") {
              continue;
            }
            for (const column of columns) {
              for (const windowSetting of windowSettings) {
                for (const regressionSetting of regressionAdjustmentSettings) {
                  for (const denominatorColumn of columns) {
                    for (const denominatorAggregation of aggregationTypes) {
                      const metric = createMetric({
                        metricType: "ratio",
                        cappingType,
                        aggregationType,
                        column,
                        inlineFilter: undefined,
                        filter: undefined,
                        windowSetting,
                        regressionSetting,
                        denominatorColumn,
                        denominatorAggregation,
                      });
                      metrics.push(metric);
                    }
                  }

                  // cross cross table ratio with only one denominator/aggregation combo
                  const metric = createMetric({
                    metricType: "ratio",
                    cappingType,
                    aggregationType,
                    column,
                    inlineFilter: undefined,
                    filter: undefined,
                    windowSetting,
                    regressionSetting,
                    denominatorColumn: "$$count",
                    denominatorAggregation: undefined,
                    denominatorFactTableId: "events",
                  });
                  metrics.push(metric);
                }
              }
            }
          }
        }
      },

      // retention is mostly just special proportion metrics
      // so there are fewer combinations of tests here to
      // keep the overall set down
      retention: () => {
        for (const column of binomialColumns) {
          for (const inlineFilter of inlineFilters) {
            for (const filter of filters) {
              for (const aggregateFilter of aggregateFilters) {
                for (const windowSetting of retentionWindowSettings) {
                  // skip combined filters
                  if (filter && inlineFilter) {
                    continue;
                  }
                  // skip aggregate filters with pre-defined filters
                  if (aggregateFilter.aggregateFilter && filter) {
                    continue;
                  }
                  const metric = createMetric({
                    metricType: "retention",
                    column,
                    inlineFilter,
                    filter,
                    windowSetting,
                    aggregateFilter: aggregateFilter.aggregateFilter,
                    aggregateFilterColumn:
                      aggregateFilter.aggregateFilterColumn,
                  });
                  metrics.push(metric);
                }
              }
            }
          }
        }
      },
    };

    // Execute all generators
    generators.mean();
    generators.quantile();
    generators.proportion();
    generators.ratio();
    generators.retention();

    return metrics;
  }

  function createMetric(config: {
    metricType: FactMetricType;
    cappingType?: MetricCappingSettings["type"];
    aggregationType?: ColumnRef["aggregation"];
    column: string;
    inlineFilter?: RowFilter | undefined;
    filter?: RowFilter | undefined;
    windowSetting?: FactMetricInterface["windowSettings"];
    regressionSetting?: {
      regressionAdjustmentEnabled: boolean;
      regressionAdjustmentDays: number;
    };
    quantileSetting?: FactMetricInterface["quantileSettings"];
    denominatorColumn?: string;
    denominatorAggregation?: ColumnRef["aggregation"];
    denominatorFactTableId?: string;
    aggregateFilter?: ColumnRef["aggregateFilter"];
    aggregateFilterColumn?: ColumnRef["aggregateFilterColumn"];
  }): FactMetricInterface {
    const {
      metricType,
      cappingType,
      aggregationType,
      column,
      inlineFilter,
      filter,
      windowSetting,
      regressionSetting,
      quantileSetting,
      denominatorColumn,
      denominatorAggregation,
      aggregateFilter,
      aggregateFilterColumn,
      denominatorFactTableId,
    } = config;

    // Generate unique ID based on all settings
    const idParts = [
      `type_${metricType}`,
      cappingType ? `cap_${cappingType}` : "cap_none",
      `agg_${aggregationType?.replace(" ", "_") ?? "none"}`,
      `col_${column.replace("$$", "special_")}`,
      inlineFilter ? `inline_${inlineFilter.column}` : "inline_none",
      filter ? `filter_${filter.values?.[0].split(".")[1]}` : "filter_none",
      windowSetting?.type ? `window_${windowSetting.type}` : "window_none",
      regressionSetting?.regressionAdjustmentEnabled
        ? `regadj_${regressionSetting.regressionAdjustmentDays}d`
        : "regadj_none",
      aggregateFilter
        ? `aggfilter_${aggregateFilter.replace(/[<>=\s]/g, "_")}`
        : "aggfilter_none",
      aggregateFilterColumn
        ? `aggfiltercol_${aggregateFilterColumn}`
        : "aggfiltercol_none",
    ];

    // Add quantile-specific ID parts
    if (quantileSetting) {
      idParts.push(
        `quant_${quantileSetting.type}_${quantileSetting.quantile}_${quantileSetting.ignoreZeros ? "ignoreZeros" : "includeZeros"}`,
      );
    }

    // Add ratio-specific ID parts
    if (denominatorColumn && denominatorAggregation) {
      idParts.push(
        `denom_${denominatorAggregation?.replace(" ", "_")}_${denominatorColumn.replace("$$", "special_")}`,
      );
    }

    if (denominatorFactTableId) {
      idParts.push(`denom_facttable_${denominatorFactTableId}`);
    }

    const id = idParts.join("__");

    // Build base metric configuration
    const baseConfig: Partial<FactMetricInterface> = {
      id,
      name: `Generated Metric: ${metricType} (${aggregationType || "sum"} ${column})`,
      metricType,
      numerator: {
        factTableId: "orders",
        column: column,
        aggregation: aggregationType || "sum",
        rowFilters: [
          ...(inlineFilter ? [inlineFilter] : []),
          ...(filter ? [filter] : []),
        ],
        aggregateFilter,
        aggregateFilterColumn,
      },
      cappingSettings: {
        type: (cappingType || "") as MetricCappingSettings["type"],
        value:
          cappingType === "percentile"
            ? 0.95
            : cappingType === "absolute"
              ? 1000
              : 0,
        ignoreZeros: false,
      },
      windowSettings: windowSetting || {
        type: "",
        delayValue: 0,
        delayUnit: "hours",
        windowValue: 0,
        windowUnit: "hours",
      },
      regressionAdjustmentEnabled:
        regressionSetting?.regressionAdjustmentEnabled || false,
      regressionAdjustmentDays:
        regressionSetting?.regressionAdjustmentDays || 0,
    };

    // Handle metric type specific configurations
    if (metricType === "ratio") {
      // Ratio metrics need a denominator
      return factMetricFactory.build({
        ...baseConfig,
        denominator: {
          factTableId: denominatorFactTableId || "orders",
          column: denominatorColumn || "amount",
          aggregation: denominatorAggregation || "sum",
        },
      });
    } else if (metricType === "quantile") {
      // Quantile metrics need quantileSettings
      return factMetricFactory.build({
        ...baseConfig,
        quantileSettings: quantileSetting || {
          type: "unit",
          quantile: 0.9,
          ignoreZeros: false,
        },
      });
    } else if (metricType === "proportion" || metricType === "retention") {
      // Proportion and retention metrics should use $$count column if not already specified
      return factMetricFactory.build({
        ...baseConfig,
        numerator: {
          ...baseConfig.numerator,
          column:
            column === "$$count" || column === "$$distinctUsers"
              ? column
              : "$$count",
          aggregation: "sum",
        } as ColumnRef,
      });
    } else {
      // Mean and other metrics
      return factMetricFactory.build(baseConfig);
    }
  }

  const factTableMap = new Map([
    [ordersFactTable.id, ordersFactTable],
    [eventsFactTable.id, eventsFactTable],
  ]);

  const metricsToTest = generateFactMetrics();

  it("generates all metrics", () => {
    expect(metricsToTest.map((m) => m.id)).toMatchSnapshot();
  });

  it.each(metricsToTest)(
    "generated fact metric SQL is correct for $id",
    (metric) => {
      const startDate = new Date("2023-01-01");
      const endDate = new Date("2023-01-31");

      const sql = getExperimentFactMetricsQuery(
        bigQueryDialect,
        bqIntegration.datasource,
        {
          settings: {
            manual: false,
            dimensions: [],
            metricSettings: [],
            goalMetrics: [],
            secondaryMetrics: [],
            guardrailMetrics: [],
            activationMetric: null,
            defaultMetricPriorSettings: {
              override: false,
              proper: false,
              mean: 0,
              stddev: 0,
            },
            regressionAdjustmentEnabled: true,
            attributionModel: "firstExposure",
            experimentId: "",
            queryFilter: "",
            segment: "",
            // TODO
            skipPartialData: false,
            datasourceId: "",
            exposureQueryId: "",
            startDate,
            endDate,
            variations: [],
          },
          unitsSource: "exposureQuery",
          activationMetric: null,
          dimensions: [],
          segment: null,
          metrics: [metric],
          factTableMap,
        },
      );

      // Normalize SQL for consistency
      const normalizedSql = sql.replace(/\s+/g, " ").trim();

      expect(format(normalizedSql, "bigquery")).toMatchSnapshot();
    },
  );
});

describe("quantile grid array packing is BigQuery-only", () => {
  // The array-packed quantile grid is gated entirely on
  // dialect.hasArrayQuantileGrid(). This drives two distinct behaviors:
  //   1. SQL generation — getExperimentFactMetricsQuery emits ONE array column
  //      (m0_quantile_grid) instead of N_STAR_VALUES.length * 2 scalar columns.
  //   2. Column budgeting — getSourceProperties().hasArrayQuantileGrid (which
  //      just forwards the dialect flag) flips chunkMetrics into efficient mode.
  // These tests pin both behaviors to BigQuery so the optimization can't
  // silently leak into another warehouse that doesn't actually support arrays.
  const testExposureQuery: ExposureQuery = {
    id: "anonymous_id",
    name: "Exposure",
    description: "Exposure",
    query: "*",
    userIdType: "user_id",
    dimensions: [],
  };

  const ordersFactTable = factTableFactory.build({
    id: "orders",
    name: "Orders Fact Table",
    sql: "*",
  });
  const factTableMap = new Map([[ordersFactTable.id, ordersFactTable]]);

  // A single BigQuery instance only to source a valid (dialect-agnostic)
  // datasource object — the SQL is generated from the dialect we pass in, not
  // from the integration, so the same datasource feeds both branches and the
  // ONLY difference between the two SQL strings is the dialect.
  // @ts-expect-error -- context not needed for test
  const datasourceIntegration = new BigQuery("", {
    settings: { queries: { exposure: [testExposureQuery] } },
  });

  const buildQuantileSql = (
    dialect: SqlDialect,
    quantileSettings: FactMetricInterface["quantileSettings"],
  ): string => {
    const metric = factMetricFactory.build({
      id: "fact_uq1",
      metricType: "quantile",
      quantileSettings,
      numerator: {
        factTableId: "orders",
        column: "amount",
        aggregation: "sum",
      },
    });
    return getExperimentFactMetricsQuery(
      dialect,
      datasourceIntegration.datasource,
      {
        settings: {
          manual: false,
          dimensions: [],
          metricSettings: [],
          goalMetrics: [],
          secondaryMetrics: [],
          guardrailMetrics: [],
          activationMetric: null,
          defaultMetricPriorSettings: {
            override: false,
            proper: false,
            mean: 0,
            stddev: 0,
          },
          regressionAdjustmentEnabled: false,
          attributionModel: "firstExposure",
          experimentId: "",
          queryFilter: "",
          segment: "",
          skipPartialData: false,
          datasourceId: "",
          exposureQueryId: "",
          startDate: new Date("2023-01-01"),
          endDate: new Date("2023-01-31"),
          variations: [],
        },
        unitsSource: "exposureQuery",
        activationMetric: null,
        dimensions: [],
        segment: null,
        metrics: [metric],
        factTableMap,
      },
    );
  };

  describe("dialect flag", () => {
    it.each([
      ["bigquery", bigQueryDialect, true],
      ["snowflake", snowflakeDialect, false],
      ["clickhouse", clickHouseDialect, false],
      ["mysql", mysqlDialect, false],
    ] as const)(
      "%s reports hasArrayQuantileGrid() === %s",
      (_name, dialect, expected) => {
        expect(dialect.hasArrayQuantileGrid()).toBe(expected);
      },
    );

    it("quantileGridArrayLiteral collapses to NULL when the grid has no data", () => {
      // Defensive contract: a dialect must not advertise array support without
      // implementing quantileGridArrayLiteral, and must not have it silently
      // no-op if it doesn't support arrays.
      expect(() =>
        snowflakeDialect.quantileGridArrayLiteral(["1", "2"]),
      ).toThrow();
      // BigQuery rejects a NULL-containing array in a query result, so the grid
      // must collapse to NULL (all-or-nothing) instead of emitting a partial array.
      expect(bigQueryDialect.quantileGridArrayLiteral(["a", "b"])).toBe(
        "IF(a IS NULL, NULL, [a, b])",
      );
    });
  });

  describe("column budgeting (source properties)", () => {
    it("only BigQuery's source properties enable the efficient (array) grid", () => {
      // @ts-expect-error -- context not needed for test
      const bq = new BigQuery("", {
        settings: { queries: { exposure: [testExposureQuery] } },
      });
      // @ts-expect-error -- context not needed for test
      const sf = new Snowflake("", {
        settings: { queries: { exposure: [testExposureQuery] } },
      });

      expect(bq.getSourceProperties().hasArrayQuantileGrid).toBe(true);
      expect(sf.getSourceProperties().hasArrayQuantileGrid).toBe(false);
    });
  });

  describe("SQL generation", () => {
    it.each(["unit", "event"] as const)(
      "%s quantile: BigQuery packs one array column; Snowflake keeps scalar columns",
      (quantileType) => {
        const quantileSettings = {
          type: quantileType,
          quantile: 0.9,
          ignoreZeros: false,
        };
        const bqSql = buildQuantileSql(bigQueryDialect, quantileSettings);
        const sfSql = buildQuantileSql(snowflakeDialect, quantileSettings);

        // BigQuery: single array column, no per-nstar scalar columns.
        expect(bqSql).toMatch(/AS\s+m0_quantile_grid/);
        expect(bqSql).not.toMatch(/m0_quantile_lower_\d+/);
        expect(bqSql).not.toMatch(/m0_quantile_upper_\d+/);

        // Snowflake: per-nstar scalar columns, no packed array column.
        expect(sfSql).not.toContain("m0_quantile_grid");
        expect(sfSql).toMatch(/m0_quantile_lower_\d+/);
        expect(sfSql).toMatch(/m0_quantile_upper_\d+/);

        // The central point estimate and quantile_n are present in both shapes
        // (the read side needs them regardless of the grid encoding).
        expect(bqSql).toContain("m0_quantile_n");
        expect(sfSql).toContain("m0_quantile_n");
      },
    );

    it("Snowflake emits exactly N_STAR_VALUES*2 scalar bound columns (no array)", () => {
      const sfSql = buildQuantileSql(snowflakeDialect, {
        type: "unit",
        quantile: 0.9,
        ignoreZeros: false,
      });

      const lowerCount = (sfSql.match(/AS\s+m0_quantile_lower_\d+/g) || [])
        .length;
      const upperCount = (sfSql.match(/AS\s+m0_quantile_upper_\d+/g) || [])
        .length;

      expect(lowerCount).toBe(N_STAR_VALUES.length);
      expect(upperCount).toBe(N_STAR_VALUES.length);
    });
  });

  // Coverage transfer: the BigQuery snapshot suite above used to be the only
  // thing pinning the exact scalar-column quantile SQL. Now that BigQuery emits
  // an array, that path is exercised only by non-array warehouses — so we pin
  // the exact scalar SQL here, under Snowflake, to keep the unchanged path
  // guarded against unintended structural changes (offsets, CTE shape, etc.).
  describe("exact scalar quantile SQL (Snowflake snapshots)", () => {
    const quantileVariants: {
      label: string;
      settings: FactMetricInterface["quantileSettings"];
    }[] = [
      {
        label: "unit_0.9_includeZeros",
        settings: { type: "unit", quantile: 0.9, ignoreZeros: false },
      },
      {
        label: "unit_0.9_ignoreZeros",
        settings: { type: "unit", quantile: 0.9, ignoreZeros: true },
      },
      {
        label: "event_0.9_includeZeros",
        settings: { type: "event", quantile: 0.9, ignoreZeros: false },
      },
      {
        label: "event_0.9_ignoreZeros",
        settings: { type: "event", quantile: 0.9, ignoreZeros: true },
      },
    ];

    it.each(quantileVariants)(
      "snowflake scalar quantile SQL is correct for $label",
      ({ settings }) => {
        const sql = buildQuantileSql(snowflakeDialect, settings);
        const normalizedSql = sql.replace(/\s+/g, " ").trim();
        expect(format(normalizedSql, "snowflake")).toMatchSnapshot();
      },
    );
  });
});

describe("getFeatureEvalDiagnosticsQuery", () => {
  beforeEach(() => {
    jest.useFakeTimers("modern");
    jest.setSystemTime(new Date("2025-03-24T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("replaces template variables in the feature usage query", () => {
    const datasource = {
      settings: {
        queries: {
          featureUsage: [
            {
              id: "fu1",
              query: `SELECT ts AS timestamp, k AS feature_key FROM t WHERE ts BETWEEN '{{startDateISO}}' AND '{{endDateISO}}'`,
            },
          ],
        },
      },
      params: "",
    };
    // @ts-expect-error -- context not needed for test
    const bqIntegration = new BigQuery("", datasource);

    const sql = getFeatureEvalDiagnosticsQuery(
      bigQueryDialect,
      bqIntegration.datasource,
      {
        feature: "my-feature-key",
      },
    );

    expect(sql).not.toContain("{{startDateISO}}");
    expect(sql).not.toContain("{{endDateISO}}");
    // compileSqlTemplate fills these with ISO-8601 timestamps
    expect(sql).toMatch(
      /BETWEEN '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z' AND '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z'/,
    );
  });
});
