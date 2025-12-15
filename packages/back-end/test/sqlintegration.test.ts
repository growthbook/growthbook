import { format } from "shared/sql";
import BigQuery from "back-end/src/integrations/BigQuery";
import { MetricInterface } from "back-end/types/metric";
import {
  ColumnRef,
  FactMetricInterface,
  FactMetricType,
  MetricCappingSettings,
} from "back-end/types/fact-table";
import { ExposureQuery } from "back-end/types/datasource";
import { factTableFactory } from "./factories/FactTable.factory";
import { factMetricFactory } from "./factories/FactMetric.factory";

describe("bigquery integration", () => {
  let bqIntegration: BigQuery;
  beforeEach(() => {
    // @ts-expect-error -- context not needed for test
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
      bqIntegration["addCaseWhenTimeFilter"]({
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
    const endDateFilter = `AND m.timestamp <= ${bqIntegration["toTimestamp"](
      date,
    )}`;
    expect(
      bqIntegration["addCaseWhenTimeFilter"]({
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
      bqIntegration["getAggregateMetricColumnLegacyMetrics"]({
        metric: customNumberAggMetric,
      }),
    ).toEqual("(CASE WHEN value IS NOT NULL THEN 33 ELSE 0 END)");
    expect(
      bqIntegration["getAggregateMetricColumnLegacyMetrics"]({
        metric: customCountAgg,
      }),
    ).toEqual("COUNT(value) / (5 + COUNT(value))");
    expect(
      bqIntegration["getAggregateMetricColumnLegacyMetrics"]({
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

    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = bqIntegration["getFactMetricCTE"]({
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

    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = bqIntegration["getFactMetricCTE"]({
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

    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = bqIntegration["getFactMetricCTE"]({
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

    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = bqIntegration["getFactMetricCTE"]({
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

    const startDate = new Date("2023-01-01");
    const endDate = new Date("2023-01-31");

    const result = bqIntegration["getFactMetricCTE"]({
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
  beforeEach(() => {
    // @ts-expect-error -- context not needed for test
    bqIntegration = new BigQuery("", {});
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
  const inlineFilters: ColumnRef["inlineFilters"][] = [
    undefined,
    {
      type: ["discount"],
    },
  ];
  const filters: ColumnRef["filters"][] = [[], ["orders.mobile"]];
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
                  if (filter.length > 0 && inlineFilter) {
                    continue;
                  }
                  // skip aggregate filters with pre-defined filters
                  if (aggregateFilter.aggregateFilter && filter.length > 0) {
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
    inlineFilter?: ColumnRef["inlineFilters"];
    filter?: ColumnRef["filters"];
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
      inlineFilter ? `inline_${Object.keys(inlineFilter)[0]}` : "inline_none",
      filter && filter.length > 0
        ? `filter_${filter[0].split(".")[1]}`
        : "filter_none",
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
    const baseConfig = {
      id,
      name: `Generated Metric: ${metricType} (${aggregationType || "sum"} ${column})`,
      metricType,
      numerator: {
        factTableId: "orders",
        column: column,
        aggregation: aggregationType || "sum",
        filters: filter || [],
        inlineFilters: inlineFilter,
        aggregateFilter,
        aggregateFilterColumn,
      } as ColumnRef,
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
          filters: [],
        } as ColumnRef,
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

  const exposureQuery: ExposureQuery = {
    id: "exposure",
    name: "Exposure",
    description: "Exposure",
    query: "*",
    userIdType: "user_id",
    dimensions: [],
  };

  const metricsToTest = generateFactMetrics();

  it("generates all metrics", () => {
    expect(metricsToTest.map((m) => m.id)).toMatchSnapshot();
  });

  it.each(metricsToTest)(
    "generated fact metric SQL is correct for $id",
    (metric) => {
      // Mock the getExposureQuery method to return our test exposureQuery
      const getExposureQuerySpy = jest
        // eslint-disable-next-line
        .spyOn(bqIntegration as any, "getExposureQuery")
        .mockReturnValue(exposureQuery);

      const startDate = new Date("2023-01-01");
      const endDate = new Date("2023-01-31");

      const sql = bqIntegration["getExperimentFactMetricsQuery"]({
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
      });

      // Normalize SQL for consistency
      const normalizedSql = sql.replace(/\s+/g, " ").trim();

      expect(format(normalizedSql, "bigquery")).toMatchSnapshot();

      // Restore the original method
      getExposureQuerySpy.mockRestore();
    },
  );
});
