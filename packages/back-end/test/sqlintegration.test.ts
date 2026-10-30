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
import { DimensionInterface } from "shared/types/dimension";
import { Dimension } from "shared/types/integrations";
import { SegmentInterface } from "shared/types/segment";
import { SqlDialect } from "shared/types/sql";
import { getRowFilterSQL } from "shared/experiments";
import { buildUnitsQuerySettingsFromSnapshot } from "shared/util";
import {
  bigQueryDialect,
  mysqlDialect,
  clickHouseDialect,
  snowflakeDialect,
  redshiftDialect,
  databricksDialect,
  mssqlDialect,
  postgresDialect,
  prestoDialect,
  verticaDialect,
  adobeExperiencePlatformQueryServiceDialect,
} from "shared/dialects";
import { getInformationSchemaColumns } from "back-end/src/services/informationSchema";
import Snowflake from "back-end/src/integrations/Snowflake";
import BigQuery from "back-end/src/integrations/BigQuery";
import { addCaseWhenTimeFilter } from "back-end/src/integrations/sql/clauses/add-case-when-time-filter";
import { getAggregateMetricColumnLegacyMetrics } from "back-end/src/integrations/sql/columns/aggregate-metric-column-legacy-metrics";
import { getMaxHoursToConvert } from "back-end/src/integrations/sql/dates/max-hours-to-convert";
import { getFactMetricCTE } from "back-end/src/integrations/sql/ctes/fact-metric-cte";
import { getExperimentFactMetricsQuery } from "back-end/src/integrations/sql/queries/experiment-fact-metrics-query";
import {
  MAX_ROWS_CLUSTER_UNITS_QUERY,
  N_STAR_VALUES,
} from "back-end/src/services/experimentQueries/constants";
import { getFeatureEvalDiagnosticsQuery } from "back-end/src/integrations/sql/queries/feature-eval-diagnostics-query";
import { getExperimentExposuresQuery } from "back-end/src/integrations/sql/queries/experiment-exposures-query";
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

  it("escapes backslash and single quotes for Redshift", () => {
    expect(redshiftDialect.escapeStringLiteral(`test\\'string`)).toEqual(
      `test\\\\''string`,
    );
  });

  describe("ClickHouse jsonExtract JSON path quoting", () => {
    it("backtick-quotes a native-JSON key that isn't a safe identifier", () => {
      const sql = clickHouseDialect.jsonExtract(
        "attributes",
        "company id",
        false,
      );
      expect(sql).toContain("attributes.`company id`::Nullable(String)");
      // Fallback (String column) branch still passes the raw key as a literal.
      expect(sql).toContain("JSONExtractString(attributes, 'company id')");
    });

    it("leaves a safe identifier key unquoted", () => {
      const sql = clickHouseDialect.jsonExtract(
        "attributes",
        "company_id",
        false,
      );
      expect(sql).toContain("attributes.company_id::Nullable(String)");
    });

    it("quotes the key in the numeric branch too", () => {
      const sql = clickHouseDialect.jsonExtract(
        "attributes",
        "company id",
        true,
      );
      expect(sql).toContain(
        "toFloat64OrNull(attributes.`company id`::Nullable(String))",
      );
    });

    it("escapes backticks within a key", () => {
      const sql = clickHouseDialect.jsonExtract("attributes", "a`b", false);
      expect(sql).toContain("attributes.`a``b`::Nullable(String)");
    });
  });

  describe("LIKE row filters with real dialects", () => {
    const factTable = factTableFactory.build({
      columns: [
        {
          column: "event_name",
          datatype: "string",
          dateCreated: new Date(),
          dateUpdated: new Date(),
          description: "",
          numberFormat: "",
          name: "Event Name",
          deleted: false,
        },
      ],
    });

    const likeSQL = (dialect: SqlDialect, value: string) =>
      getRowFilterSQL({
        factTable,
        rowFilter: {
          column: "event_name",
          operator: "starts_with",
          values: [value],
        },
        escapeStringLiteral: dialect.escapeStringLiteral,
        jsonExtract: dialect.jsonExtract,
        evalBoolean: dialect.evalBoolean,
        stringMatch: dialect.stringMatch,
      });

    it("emits a valid BigQuery pattern with no ESCAPE clause", () => {
      expect(likeSQL(bigQueryDialect, "foo_bar")).toEqual(
        String.raw`(event_name LIKE 'foo\\_bar%')`,
      );
    });

    it("emits a valid ClickHouse pattern with no ESCAPE clause", () => {
      expect(likeSQL(clickHouseDialect, "foo_bar")).toEqual(
        String.raw`(event_name LIKE 'foo\\_bar%')`,
      );
    });

    it("emits a Snowflake pattern with a doubled-backslash ESCAPE clause", () => {
      expect(likeSQL(snowflakeDialect, "foo_bar")).toEqual(
        String.raw`(event_name LIKE 'foo\\_bar%' ESCAPE '\\')`,
      );
    });

    it("emits a Redshift pattern with a doubled-backslash ESCAPE clause", () => {
      expect(likeSQL(redshiftDialect, "foo_bar")).toEqual(
        String.raw`(event_name LIKE 'foo\\_bar%' ESCAPE '\\')`,
      );
    });

    it("matches a literal backslash on Redshift", () => {
      expect(likeSQL(redshiftDialect, String.raw`a\b`)).toEqual(
        String.raw`(event_name LIKE 'a\\\\b%' ESCAPE '\\')`,
      );
    });

    it("emits a valid MySQL pattern with no ESCAPE clause", () => {
      expect(likeSQL(mysqlDialect, "foo_bar")).toEqual(
        String.raw`(event_name LIKE 'foo\\_bar%')`,
      );
    });

    it("emits a valid Databricks pattern with no ESCAPE clause", () => {
      expect(likeSQL(databricksDialect, "foo_bar")).toEqual(
        String.raw`(event_name LIKE 'foo\\_bar%')`,
      );
    });

    it("emits a valid Adobe Experience Platform Query Service pattern with no ESCAPE clause", () => {
      expect(
        likeSQL(adobeExperiencePlatformQueryServiceDialect, "foo_bar"),
      ).toEqual(String.raw`(event_name LIKE 'foo\\_bar%')`);
    });

    it("emits a valid Postgres pattern with no ESCAPE clause", () => {
      expect(likeSQL(postgresDialect, "foo_bar")).toEqual(
        String.raw`(event_name LIKE 'foo\_bar%')`,
      );
    });

    it("emits a valid Vertica pattern with no ESCAPE clause", () => {
      expect(likeSQL(verticaDialect, "foo_bar")).toEqual(
        String.raw`(event_name LIKE 'foo\_bar%')`,
      );
    });

    it("brackets wildcards for SQL Server instead of an ESCAPE clause", () => {
      expect(likeSQL(mssqlDialect, "foo_bar")).toEqual(
        `(event_name LIKE 'foo[_]bar%')`,
      );
    });

    it("brackets the [ metacharacter for SQL Server", () => {
      expect(likeSQL(mssqlDialect, "a[b")).toEqual(
        `(event_name LIKE 'a[[]b%')`,
      );
    });

    it("leaves ] bare for SQL Server", () => {
      expect(likeSQL(mssqlDialect, "a]b[c")).toEqual(
        `(event_name LIKE 'a]b[[]c%')`,
      );
    });
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

  it("uses the fact table's timestamp column and aliases it to timestamp", () => {
    const factTable = factTableFactory.build({
      sql: "SELECT user_id, anonymous_id, event_time, value FROM events",
      timestampColumn: "event_time",
    });
    const factMetric = factMetricFactory.build({
      metricType: "mean",
      numerator: {
        factTableId: factTable.id,
        column: "value",
        aggregation: "sum",
      },
    });

    const result = getFactMetricCTE(bigQueryDialect, {
      metricsWithIndices: [{ metric: factMetric, index: 0 }],
      factTable,
      baseIdType: "user_id",
      idJoinMap: {},
      startDate: new Date("2023-01-01"),
      endDate: new Date("2023-01-31"),
    });

    expect(result).toContain("CAST(m.event_time as DATETIME) as timestamp");
    expect(result).toContain(
      "WHERE m.event_time >= '2023-01-01 00:00:00' AND m.event_time <= '2023-01-31 00:00:00'",
    );
    expect(result).not.toContain("m.timestamp");
  });

  it("maps identifier columns and aliases them back to the id type", () => {
    const factTable = factTableFactory.build({
      sql: "SELECT userId, anonId, props, timestamp, value FROM events",
      userIdColumns: { user_id: "userId", anonymous_id: "anonId" },
    });
    const factMetric = factMetricFactory.build({
      metricType: "mean",
      numerator: {
        factTableId: factTable.id,
        column: "value",
        aggregation: "sum",
      },
    });

    const params = {
      metricsWithIndices: [{ metric: factMetric, index: 0 }],
      factTable,
      startDate: new Date("2023-01-01"),
      endDate: new Date("2023-01-31"),
    };

    // Base id type is on the fact table: select the mapped column directly.
    const result = getFactMetricCTE(bigQueryDialect, {
      ...params,
      baseIdType: "user_id",
      idJoinMap: {},
    });
    expect(result).toContain("userId as user_id");
    expect(result).not.toContain("user_id as user_id");

    // Base id type isn't on the fact table: join on the mapped column instead.
    const joined = getFactMetricCTE(bigQueryDialect, {
      ...params,
      baseIdType: "device_id",
      idJoinMap: { anonymous_id: "__identities" },
    });
    expect(joined).toContain(
      "JOIN __identities i ON (i.anonymous_id = m.anonId)",
    );

    // A mapped virtual column inlines its expression in the identifier position.
    const virtual = getFactMetricCTE(bigQueryDialect, {
      ...params,
      factTable: factTableFactory.build({
        id: factTable.id,
        sql: "SELECT userId, anonId, timestamp, value FROM events",
        userIdColumns: { user_id: "combined_id" },
        columns: [
          {
            column: "combined_id",
            name: "combined_id",
            description: "",
            datatype: "string",
            numberFormat: "",
            deleted: false,
            dateCreated: new Date(0),
            dateUpdated: new Date(0),
            isVirtual: true,
            sql: "COALESCE(userId, anonId)",
          },
        ],
      }),
      baseIdType: "user_id",
      idJoinMap: {},
    });
    // No alias prefix here: the expression sits directly in the SELECT over
    // the fact table subquery, same as the plain mapped column above.
    expect(virtual).toContain("(COALESCE(userId, anonId)) as user_id");
    expect(virtual).toContain("m.value as m0_value");
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
      type: "bigquery",
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

      const settings = {
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
        attributionModel: "firstExposure" as const,
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
      };

      const sql = getExperimentFactMetricsQuery(
        bigQueryDialect,
        bqIntegration.datasource,
        {
          settings,
          unitsSource: "exposureQuery",
          unitsSettings: buildUnitsQuerySettingsFromSnapshot(settings, {
            query: testExposureQuery.query,
            identifierType: testExposureQuery.userIdType,
          }),
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
    type: "bigquery",
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
    const settings = {
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
      attributionModel: "firstExposure" as const,
      experimentId: "",
      queryFilter: "",
      segment: "",
      skipPartialData: false,
      datasourceId: "",
      exposureQueryId: "",
      startDate: new Date("2023-01-01"),
      endDate: new Date("2023-01-31"),
      variations: [],
    };

    return getExperimentFactMetricsQuery(
      dialect,
      datasourceIntegration.datasource,
      {
        settings,
        unitsSource: "exposureQuery",
        unitsSettings: buildUnitsQuerySettingsFromSnapshot(settings, {
          query: testExposureQuery.query,
          identifierType: testExposureQuery.userIdType,
        }),
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
        type: "bigquery",
        settings: { queries: { exposure: [testExposureQuery] } },
      });
      // @ts-expect-error -- context not needed for test
      const sf = new Snowflake("", {
        type: "snowflake",
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
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-03-24T12:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("replaces template variables in the feature usage query", () => {
    const datasource = {
      type: "bigquery",
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

describe("getExperimentExposuresQuery", () => {
  const params = {
    experimentId: "exp_123",
    experimentTrackingKey: "my-experiment",
    exposureQuery: {
      query:
        "SELECT ts AS timestamp, uid AS user_id, vid AS variation_id, eid AS experiment_id FROM t WHERE eid = '{{experimentId}}' AND ts BETWEEN '{{startDateISO}}' AND '{{endDateISO}}'",
      identifierType: "user_id",
    },
    startDate: new Date("2025-03-01T00:00:00.000Z"),
    endDate: new Date("2025-03-08T00:00:00.000Z"),
    dimensions: ["country"],
    limit: 1000,
  };

  it("substitutes every template variable, including experimentId", () => {
    const sql = getExperimentExposuresQuery(bigQueryDialect, params);

    expect(sql).not.toContain("{{experimentId}}");
    expect(sql).not.toContain("{{startDateISO}}");
    expect(sql).not.toContain("{{endDateISO}}");
    // A missing experimentId falls back to "%", which would scan every
    // experiment in the customer's warehouse.
    expect(sql).not.toContain("= '%'");
    expect(sql).toContain("my-experiment");
  });

  it("selects every column so extra fields reach the expandable row", () => {
    const sql = getExperimentExposuresQuery(bigQueryDialect, params);
    expect(sql).toMatch(/SELECT\s+\*/);
  });

  it("filters, orders and row-filters on mapped columns", () => {
    const sql = getExperimentExposuresQuery(bigQueryDialect, {
      ...params,
      exposureQuery: {
        query: "SELECT * FROM t",
        identifierType: "user_id",
        columnMapping: {
          userIdColumns: { user_id: "uid" },
          timestampColumn: "ts",
          experimentIdColumn: "eid",
          variationIdColumn: "vid",
        },
      },
      rowFilters: [{ operator: "=", column: "variation_id", values: ["1"] }],
    });
    expect(sql).toContain("`eid` = 'my-experiment'");
    expect(sql).toContain("`ts` >=");
    expect(sql).toMatch(/ORDER BY\s+`ts` DESC,\s+`uid` DESC,\s+`vid` DESC/);
    expect(sql).toContain("LOWER(cast(`vid` as string))");
    expect(sql).not.toMatch(/`(timestamp|experiment_id|variation_id|user_id)`/);
  });

  it("applies the phase filter the analysis applies", () => {
    const phaseParams = {
      ...params,
      exposureQuery: {
        ...params.exposureQuery,
        query:
          "SELECT * FROM t WHERE eid = '{{experimentId}}'{{#if phase.index}} AND phase_index = {{phase.index}}{{/if}}",
      },
    };

    expect(
      getExperimentExposuresQuery(bigQueryDialect, {
        ...phaseParams,
        phase: { index: "2" },
      }),
    ).toContain("phase_index = 2");
    expect(
      getExperimentExposuresQuery(bigQueryDialect, phaseParams),
    ).not.toContain("phase_index");
  });

  it("substitutes custom fields", () => {
    const sql = getExperimentExposuresQuery(bigQueryDialect, {
      ...params,
      exposureQuery: {
        ...params.exposureQuery,
        query:
          "SELECT * FROM t WHERE eid = '{{experimentId}}'{{#if customFields.region}} AND region = '{{customFields.region}}'{{/if}}",
      },
      customFields: { region: "emea" },
    });
    expect(sql).toContain("'emea'");
  });

  it("fetches one extra row to detect a truncated buffer", () => {
    const sql = getExperimentExposuresQuery(bigQueryDialect, params);
    expect(sql).toMatch(/LIMIT\s+1001/);
  });

  it("uses deterministic tie-breakers for pagination", () => {
    const sql = getExperimentExposuresQuery(bigQueryDialect, params);
    expect(sql).toMatch(
      /ORDER BY\s+`timestamp` DESC,\s+`user_id` DESC,\s+`variation_id` DESC,\s+`country` DESC/,
    );
  });

  it("clamps the buffer to SQL_ROW_LIMIT", () => {
    const sql = getExperimentExposuresQuery(bigQueryDialect, {
      ...params,
      limit: 5000,
    });
    expect(sql).toMatch(/LIMIT\s+1001/);
  });

  it("escapes quotes in the tracking key and filter values", () => {
    const sql = getExperimentExposuresQuery(bigQueryDialect, {
      ...params,
      experimentTrackingKey: "it's-mine",
      rowFilters: [{ column: "user_id", operator: "=", values: ["o'brien"] }],
    });
    expect(sql).not.toMatch(/experiment_id = 'it's-mine'/);
    expect(sql).toContain("o\\'brien");
  });

  it("compiles row filters into the WHERE clause", () => {
    const sql = getExperimentExposuresQuery(bigQueryDialect, {
      ...params,
      rowFilters: [
        { column: "variation_id", operator: "=", values: ["0"] },
        { column: "country", operator: "in", values: ["US", "GB"] },
      ],
    });
    expect(sql).toContain("LOWER(cast(`variation_id` as string))) = '0'");
    expect(sql).toMatch(/LOWER\(cast\(`country` as string\)\)\) IN/);
    expect(sql).toContain("'us'");
    expect(sql).toContain("'gb'");
  });

  it("supports the string operators the filter panel offers", () => {
    const sql = getExperimentExposuresQuery(bigQueryDialect, {
      ...params,
      rowFilters: [
        { column: "user_id", operator: "contains", values: ["abc"] },
        { column: "country", operator: "not_null", values: [] },
      ],
    });
    expect(sql).toMatch(/LOWER\(cast\(`user_id` as string\)\)\) LIKE '%abc%'/);
    expect(sql).toContain("LOWER(cast(`country` as string))) IS NOT NULL");
  });

  it("casts filtered columns to string so INT64 columns compare", () => {
    // BigQuery has no implicit INT64/STRING coercion, so an uncast comparison
    // against a numeric user_id or variation_id is a hard query error. Filter
    // values are always strings, so the column is cast to match.
    const sql = getExperimentExposuresQuery(bigQueryDialect, {
      ...params,
      rowFilters: [
        { column: "variation_id", operator: "=", values: ["0"] },
        { column: "user_id", operator: "contains", values: ["abc"] },
      ],
    });
    expect(sql).toContain("cast(`variation_id` as string)");
    expect(sql).toContain("cast(`user_id` as string)");
  });

  it("casts with the dialect's own spelling", () => {
    const sql = getExperimentExposuresQuery(mssqlDialect, {
      ...params,
      rowFilters: [{ column: "variation_id", operator: "=", values: ["0"] }],
    });
    expect(sql).toContain('cast("variation_id" as varchar(8000))');
  });

  it("does not cap a SQL Server filter at the castToString width", () => {
    // castToString is varchar(256), sized for GROUP BY and sort keys. Using
    // it here would compare only the first 256 characters of a value the
    // table displays in full, so a filter could miss its own row.
    const sql = getExperimentExposuresQuery(mssqlDialect, {
      ...params,
      rowFilters: [{ column: "user_id", operator: "=", values: ["x"] }],
    });
    expect(sql).not.toContain("varchar(256)");
  });

  it("lowercases both sides so the warehouse matches like the client does", () => {
    // The panel narrows loaded rows case-insensitively. Without this the same
    // filter returns a different set before and after a Refresh.
    const sql = getExperimentExposuresQuery(bigQueryDialect, {
      ...params,
      rowFilters: [{ column: "country", operator: "=", values: ["US"] }],
    });
    expect(sql).toContain("LOWER(cast(`country` as string))) = 'us'");
    expect(sql).not.toContain("'US'");
  });

  it("lowercases a pattern's value too", () => {
    const sql = getExperimentExposuresQuery(bigQueryDialect, {
      ...params,
      rowFilters: [
        { column: "user_id", operator: "matches_pattern", values: ["USR*"] },
      ],
    });
    expect(sql).toContain("LIKE 'usr%'");
  });

  it("folds case with ClickHouse's unicode-aware function", () => {
    // ClickHouse's lower() is ASCII only, while the client's toLowerCase()
    // is not, so lower() would disagree on non-ASCII dimension values.
    const sql = getExperimentExposuresQuery(clickHouseDialect, {
      ...params,
      rowFilters: [{ column: "country", operator: "=", values: ["US"] }],
    });
    expect(sql).toContain("lowerUTF8(toString(\"country\"))) = 'us'");
  });

  it("does not cast the ORDER BY columns", () => {
    // Ordering on the native type is correct and cheaper; only the comparison
    // needs both sides to be strings.
    const sql = getExperimentExposuresQuery(bigQueryDialect, {
      ...params,
      rowFilters: [{ column: "variation_id", operator: "=", values: ["0"] }],
    });
    expect(sql).toMatch(
      /ORDER BY\s+`timestamp` DESC,\s+`user_id` DESC,\s+`variation_id` DESC/,
    );
  });

  it("quotes the required columns", () => {
    const sql = getExperimentExposuresQuery(bigQueryDialect, params);
    // The tracking key is always a string, and it is the predicate most likely
    // to drive partition pruning.
    expect(sql).toContain("`experiment_id` = 'my-experiment'");
    expect(sql).toContain("`timestamp` >=");
  });

  it("quotes reserved-word columns", () => {
    const sql = getExperimentExposuresQuery(bigQueryDialect, {
      ...params,
      dimensions: ["order"],
      rowFilters: [{ column: "order", operator: "=", values: ["first"] }],
    });
    expect(sql).toContain("LOWER(cast(`order` as string))) = 'first'");
    expect(sql).toContain("`order` DESC");
  });

  it("folds quoted identifiers the way the warehouse folds bare aliases", () => {
    expect(
      getExperimentExposuresQuery(snowflakeDialect, {
        ...params,
        exposureQuery: { ...params.exposureQuery, identifierType: "userId" },
      }),
    ).toContain('"USERID" DESC');
    expect(
      getExperimentExposuresQuery(postgresDialect, {
        ...params,
        exposureQuery: { ...params.exposureQuery, identifierType: "userId" },
      }),
    ).toContain('"userid" DESC');
  });

  it("rejects dimension names that are not identifier-shaped", () => {
    // Silently dropping the filter would render unfiltered rows as filtered.
    expect(() =>
      getExperimentExposuresQuery(bigQueryDialect, {
        ...params,
        dimensions: ["bad name"],
      }),
    ).toThrow(/not a supported column name/);
  });

  it("rejects a row filter on a column the exposure query does not return", () => {
    expect(() =>
      getExperimentExposuresQuery(bigQueryDialect, {
        ...params,
        rowFilters: [{ column: "evil", operator: "=", values: ["x"] }],
      }),
    ).toThrow(/not available on this exposure query/);
  });

  it("refuses sql_expr, whose value would reach the WHERE clause verbatim", () => {
    // rowFilters arrive as JSON on an HTTP request. getRowFilterSQL inlines a
    // sql_expr value with no escaping, so accepting it would hand any caller
    // with health-query permission arbitrary SQL against the warehouse.
    expect(() =>
      getExperimentExposuresQuery(bigQueryDialect, {
        ...params,
        rowFilters: [
          {
            operator: "sql_expr",
            values: ["1=1) UNION ALL SELECT * FROM secrets --"],
          },
        ],
      }),
    ).toThrow(/not supported for exposure logs/);
  });

  it("refuses saved_filter, which also carries raw SQL", () => {
    expect(() =>
      getExperimentExposuresQuery(bigQueryDialect, {
        ...params,
        rowFilters: [{ operator: "saved_filter", values: ["flt_abc"] }],
      }),
    ).toThrow(/not supported for exposure logs/);
  });

  it("refuses a numeric operator the client cannot evaluate the same way", () => {
    expect(() =>
      getExperimentExposuresQuery(bigQueryDialect, {
        ...params,
        rowFilters: [{ column: "country", operator: ">", values: ["A"] }],
      }),
    ).toThrow(/not supported for exposure logs/);
  });

  it("refuses an incomplete row filter rather than widening the result", () => {
    expect(() =>
      getExperimentExposuresQuery(bigQueryDialect, {
        ...params,
        rowFilters: [{ column: "country", operator: "=", values: [] }],
      }),
    ).toThrow(/incomplete/);
  });

  it("uses the dialect's row limit, keeping the filter and ordering", () => {
    expect(getExperimentExposuresQuery(bigQueryDialect, params)).toMatch(
      /LIMIT\s+1001/,
    );
    // SQL Server has no LIMIT keyword; TOP goes on the SELECT, so the WHERE and
    // ORDER BY still have to survive.
    const mssql = getExperimentExposuresQuery(mssqlDialect, params);
    expect(mssql).not.toMatch(/\bLIMIT\b/);
    expect(mssql).toMatch(/SELECT\s+TOP\s+1001\s+\*/);
    expect(mssql).toMatch(/WHERE/);
    expect(mssql).toMatch(/ORDER\s+BY/);
    expect(getExperimentExposuresQuery(prestoDialect, params)).toMatch(
      /LIMIT\s+1001/,
    );
  });
});

describe("custom dimensions (cutoff & combo) - bigquery", () => {
  const testExposureQuery: ExposureQuery = {
    id: "anonymous_id",
    name: "Exposure",
    description: "Exposure",
    query: "*",
    userIdType: "user_id",
    dimensions: ["country", "browser"],
  };

  const ordersFactTable = factTableFactory.build({
    id: "orders",
    name: "Orders Fact Table",
    sql: "*",
  });
  const factTableMap = new Map([[ordersFactTable.id, ordersFactTable]]);

  // @ts-expect-error -- context not needed for test
  const datasourceIntegration = new BigQuery("", {
    type: "bigquery",
    settings: { queries: { exposure: [testExposureQuery] } },
  });

  const metric = factMetricFactory.build({
    id: "fact_custom_dim",
    metricType: "mean",
    numerator: {
      factTableId: "orders",
      column: "amount",
      aggregation: "sum",
    },
  });

  const settings = {
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
    attributionModel: "firstExposure" as const,
    experimentId: "",
    queryFilter: "",
    segment: "",
    skipPartialData: false,
    datasourceId: "",
    exposureQueryId: "",
    startDate: new Date("2023-01-01"),
    endDate: new Date("2023-01-31"),
    variations: [],
  };

  const buildSql = (dimensions: Dimension[]): string =>
    getExperimentFactMetricsQuery(
      bigQueryDialect,
      datasourceIntegration.datasource,
      {
        settings,
        unitsSource: "exposureQuery",
        unitsSettings: buildUnitsQuerySettingsFromSnapshot(
          { ...settings, dimensions },
          {
            query: testExposureQuery.query,
            identifierType: testExposureQuery.userIdType,
          },
        ),
        activationMetric: null,
        dimensions,
        segment: null,
        metrics: [metric],
        factTableMap,
      },
    );

  it("emits a before/after CASE over first_exposure_timestamp for a datecutoff dimension", () => {
    const cutoff = new Date("2023-01-15T00:12:00.000Z");
    const sql = buildSql([{ type: "datecutoff", cutoff }]);

    expect(sql).toContain("AS dim_cutoff");
    expect(sql).toContain("'Before 2023-01-15 00:12 UTC'");
    expect(sql).toContain("'After 2023-01-15 00:12 UTC'");
    expect(sql).toMatch(/first_exposure_timestamp\s*</);
    // Computed at analysis time from first_exposure_timestamp; the units
    // query must not materialize a cutoff column
    expect(sql).not.toContain("dim_exp_");
  });

  it("emits a labeled CONCAT and materializes constituents for a combo dimension", () => {
    const userDimension: DimensionInterface = {
      id: "dim_u1",
      organization: "org1",
      owner: "",
      datasource: "ds1",
      userIdType: "user_id",
      name: "Browser",
      sql: "SELECT user_id, browser AS value FROM users",
      dateCreated: null,
      dateUpdated: null,
    };
    const sql = buildSql([
      {
        type: "combo",
        dimensions: [
          { type: "experiment", id: "country" },
          { type: "user", dimension: userDimension },
        ],
      },
    ]);

    // Constituent columns materialized on the units source
    expect(sql).toContain("dim_exp_country");
    expect(sql).toContain("__dim_unit_dim_u1");

    // The analysis column is the labeled concat, not the constituents.
    // Nested binary CONCAT — Redshift/Vertica/Presto reject 3+ arguments.
    expect(sql).toContain("AS dim_combo");
    expect(sql).toMatch(/CONCAT\(\s*CONCAT\(/);
    expect(sql).toMatch(/CONCAT\(\s*'country: ',\s*COALESCE\(/);
    expect(sql).toContain("' & '");
    expect(sql).toContain("'Browser: '");
    expect(sql).toContain("'__NULL_DIMENSION'");
  });
});

// Cluster experiment: randomize on the cluster (region_id) but run the
// metric pipeline at the nested sub-unit grain (user_id) so GrowthBook's per-unit
// percentile capping is applied per sub-unit, then roll up to one row per
// cluster for cluster-robust ratio inference (n = #clusters).
describe("cluster experiment ratio analysis - bigquery", () => {
  // The assignment query declares both the cluster (region_id) and the sub-unit
  // (user_id) identifier types.
  const clusterExposureQuery: ExposureQuery = {
    id: "cluster_exposure",
    name: "Cluster Exposure",
    description: "Cluster Exposure",
    query: "*",
    userIdType: "region_id",
    userIdTypes: ["region_id", "user_id"],
    dimensions: [],
  };

  const ordersFactTable = factTableFactory.build({
    id: "orders",
    name: "Orders Fact Table",
    sql: "*",
    userIdTypes: ["user_id", "region_id"],
  });
  const regionSpendFactTable = factTableFactory.build({
    id: "region_spend",
    name: "Region Spend Fact Table",
    sql: "*",
    userIdTypes: ["region_id"],
  });
  const factTableMap = new Map([
    [ordersFactTable.id, ordersFactTable],
    [regionSpendFactTable.id, regionSpendFactTable],
  ]);

  // @ts-expect-error -- context not needed for test
  const datasourceIntegration = new BigQuery("", {
    type: "bigquery",
    settings: { queries: { exposure: [clusterExposureQuery] } },
  });

  const baseSettings = {
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
    attributionModel: "firstExposure" as const,
    experimentId: "exp_cluster",
    queryFilter: "",
    segment: "",
    skipPartialData: false,
    datasourceId: "",
    exposureQueryId: "cluster_exposure",
    exposureQueryIdentifierType: "region_id",
    startDate: new Date("2023-01-01"),
    endDate: new Date("2023-01-31"),
    variations: [],
    isClusterExperiment: true,
    clusterSubUnitIdentifier: "user_id",
  };

  const buildClusterSql = (
    metric: FactMetricInterface,
    settings: typeof baseSettings & {
      clusterLevelMetricIds?: string[];
    } = baseSettings,
  ): string =>
    getExperimentFactMetricsQuery(
      bigQueryDialect,
      datasourceIntegration.datasource,
      {
        settings,
        unitsSource: "exposureQuery",
        unitsSettings: buildUnitsQuerySettingsFromSnapshot(baseSettings, {
          query: clusterExposureQuery.query,
          identifierType: "region_id",
        }),
        activationMetric: null,
        dimensions: [],
        segment: null,
        metrics: [metric],
        factTableMap,
      },
    );

  it("runs a percentile-capped mean metric at the sub-unit grain and caps before the cluster rollup", () => {
    const metric = factMetricFactory.build({
      id: "fact_cluster_mean",
      metricType: "mean",
      numerator: {
        factTableId: "orders",
        column: "amount",
        aggregation: "sum",
      },
      cappingSettings: { type: "percentile", value: 0.99, ignoreZeros: false },
    });

    const sql = buildClusterSql(metric);
    const normalized = sql.replace(/\s+/g, " ").trim();

    // baseIdType is the sub-unit (user_id), not the cluster (region_id): the
    // per-sub-unit aggregate and the fact join key are user_id.
    expect(normalized).toMatch(/__userMetricJoin.*m\.user_id = d\.user_id/);

    // The cluster id is carried through for the rollup grouping.
    expect(normalized).toContain("region_id");

    // The percentile cap is computed over per-sub-unit values (__capValue reads
    // the per-sub-unit aggregate).
    expect(normalized).toContain("__capValue");

    // Capping happens BEFORE the cluster aggregation: the rollup sums the capped
    // per-sub-unit value (LEAST(..., cap)) grouped by cluster.
    expect(normalized).toContain("__clusterRollup");
    // SUM(LEAST(per-sub-unit value, cap)) — cap applied per sub-unit, inside the
    // per-cluster SUM.
    expect(normalized).toMatch(/SUM\(\s*LEAST\(/);
    expect(normalized).toContain("cap.m0_value_cap");
    expect(normalized).toMatch(/GROUP BY m\.variation\s*,\s*m\.region_id/);

    // Converted metric denominator = count of exposed sub-units per cluster.
    expect(normalized).toContain("COUNT(*) AS m0_denominator");

    // The statistics CTE reads the already-capped per-cluster rollup and emits
    // ratio columns; n = #clusters.
    expect(normalized).toContain("FROM __clusterRollup m");
    expect(normalized).toContain("COUNT(*) AS users");
    expect(normalized).toContain("AS m0_main_sum");
    expect(normalized).toContain("AS m0_denominator_sum");
    expect(normalized).toContain("m0_main_denominator_sum_product");

    // The percentile cap threshold is carried through the rollup and surfaced
    // by the statistics CTE (so the applied cap is still reported downstream),
    // even though the clamp itself happened per sub-unit before the rollup.
    expect(normalized).toMatch(/MAX\(cap\.m0_value_cap\) AS m0_value_cap/);
    expect(normalized).toContain("m0_main_cap_value");

    // Metric Drilldowns: the uncapped per-cluster value is carried through the
    // rollup (SUM of the uncapped per-sub-unit value) and the statistics CTE
    // emits the uncapped sum/sum-of-squares over clusters.
    expect(normalized).toMatch(
      /SUM\(CAST\(COALESCE\(m\.m0_value, 0\) AS FLOAT64\)\) AS m0_value_uncapped/,
    );
    expect(normalized).toContain("m0_main_sum_uncapped");

    // No regression adjustment unless configured on the metric.
    expect(normalized).not.toContain("m0_covariate_sum");

    expect(format(normalized, "bigquery")).toMatchSnapshot();
  });

  it("rolls a native ratio metric up to the cluster by summing capped per-sub-unit numerator and denominator", () => {
    const metric = factMetricFactory.build({
      id: "fact_cluster_ratio",
      metricType: "ratio",
      numerator: {
        factTableId: "orders",
        column: "amount",
        aggregation: "sum",
      },
      denominator: {
        factTableId: "orders",
        column: "qty",
        aggregation: "sum",
      },
    });

    const normalized = buildClusterSql(metric).replace(/\s+/g, " ").trim();

    // Native ratio: the rollup denominator is the SUM of the per-sub-unit
    // denominator, NOT a sub-unit count.
    expect(normalized).toContain("__clusterRollup");
    expect(normalized).toContain("AS m0_value");
    expect(normalized).toContain("AS m0_denominator");
    expect(normalized).not.toContain(
      "COUNT(DISTINCT m.user_id) AS m0_denominator",
    );

    // Cluster-robust ratio statistics on the rollup.
    expect(normalized).toContain("FROM __clusterRollup m");
    expect(normalized).toContain("m0_main_denominator_sum_product");
  });

  it("applies CUPED by aggregating the pre-exposure covariate to the cluster grain (ratio_ra)", () => {
    const metric = factMetricFactory.build({
      id: "fact_cluster_mean_ra",
      metricType: "mean",
      numerator: {
        factTableId: "orders",
        column: "amount",
        aggregation: "sum",
      },
      cappingSettings: { type: "percentile", value: 0.99, ignoreZeros: false },
      regressionAdjustmentOverride: true,
      regressionAdjustmentEnabled: true,
      regressionAdjustmentDays: 14,
    });

    const normalized = buildClusterSql(metric).replace(/\s+/g, " ").trim();

    // The per-sub-unit pipeline computes the pre-exposure covariate window.
    expect(normalized).toContain("m0_preexposure_start");
    expect(normalized).toContain("m0_covariate_value");

    // The rollup carries the cluster-aggregated covariate. The covariate is
    // capped per sub-unit (same cap as the value), then summed to the cluster.
    expect(normalized).toContain("__clusterRollup");
    expect(normalized).toContain("AS m0_covariate_value");
    // Converted mean: covariate denominator mirrors the denominator = count of
    // exposed sub-units (D_pre = D_post = cluster size).
    expect(normalized).toMatch(/COUNT\(\*\) AS m0_covariate_denominator/);

    // The statistics CTE reads the per-cluster covariate columns and emits the
    // full ratio_ra set of sum-of-products over clusters.
    expect(normalized).toContain("FROM __clusterRollup m");
    expect(normalized).toContain("AS m0_covariate_sum");
    expect(normalized).toContain("AS m0_denominator_pre_sum");
    expect(normalized).toContain("m0_main_covariate_sum_product");
    expect(normalized).toContain("m0_main_post_denominator_pre_sum_product");
    expect(normalized).toContain("m0_main_pre_denominator_post_sum_product");
    expect(normalized).toContain("m0_main_pre_denominator_pre_sum_product");
    expect(normalized).toContain(
      "m0_denominator_post_denominator_pre_sum_product",
    );

    // Metric Drilldowns: the uncapped per-cluster aggregates are carried through
    // the rollup (parallel to the capped ones), so the statistics CTE emits the
    // full uncapped ratio_ra sum-of-products set over clusters.
    expect(normalized).toContain("m0_value_uncapped");
    expect(normalized).toContain("m0_covariate_value_uncapped");
    expect(normalized).toContain("m0_main_sum_uncapped");
    expect(normalized).toContain("m0_covariate_sum_uncapped");
    expect(normalized).toContain("m0_denominator_pre_sum_uncapped");
    expect(normalized).toContain("m0_main_covariate_sum_product_uncapped");
    expect(normalized).toContain(
      "m0_main_post_denominator_pre_sum_product_uncapped",
    );
    expect(normalized).toContain(
      "m0_denominator_post_denominator_pre_sum_product_uncapped",
    );

    // The percentile cap threshold is carried through the rollup and surfaced
    // downstream even though the clamp happened per sub-unit before the rollup.
    expect(normalized).toMatch(/MAX\(cap\.m0_value_cap\) AS m0_value_cap/);
    expect(normalized).toContain("m0_main_cap_value");

    // Metric Drilldowns: the per-cluster sub-unit count is carried through the
    // rollup and summed downstream, so drilldowns can show user counts even for
    // ratio metrics (whose denominator is the denominator metric, not users).
    expect(normalized).toMatch(/COUNT\(DISTINCT m\.user_id\) AS sub_count/);
    expect(normalized).toMatch(
      /SUM\(COALESCE\(m\.sub_count, 0\)\) AS sub_count/,
    );
    expect(normalized).not.toContain("m0_sub_count");

    expect(format(normalized, "bigquery")).toMatchSnapshot();
  });

  it("analyzes a cluster-level metric with one unit row per cluster, joined on the cluster id", () => {
    const metric = factMetricFactory.build({
      id: "fact_region_spend",
      metricType: "mean",
      numerator: {
        factTableId: "region_spend",
        column: "amount",
        aggregation: "sum",
      },
      regressionAdjustmentEnabled: false,
    });

    const sql = buildClusterSql(metric, {
      ...baseSettings,
      clusterLevelMetricIds: ["fact_region_spend"],
    });
    const normalized = sql.replace(/\s+/g, " ").trim();

    // Units stay keyed on the sub-unit, then collapse to exactly one row per
    // cluster (GROUP BY the cluster id only). A cluster whose sub-units span
    // multiple variations is flagged '__multiple__' so it is not emitted once
    // per arm (which would double-count its events, since the fact join is on
    // the cluster id). This mirrors the incremental-refresh path.
    expect(normalized).toMatch(
      /__distinctUsers AS \( SELECT region_id[\s\S]*?CASE WHEN COUNT\(DISTINCT variation\) > 1 THEN '__multiple__' ELSE MAX\(variation\) END\s*\) AS variation,\s*MIN\(timestamp\) AS timestamp[\s\S]*? FROM __distinctSubUnits GROUP BY region_id \)/,
    );
    // variation must NOT appear in the cluster roll-up GROUP BY.
    expect(normalized).not.toMatch(
      /FROM __distinctSubUnits GROUP BY region_id,\s*variation/,
    );
    expect(normalized).toMatch(/__userMetricJoin.*m\.region_id = d\.region_id/);

    // Multi-cluster sub-units (region_id = '__multiple__') are dropped before the
    // region collapse, so they never form a phantom cluster in the analysis.
    expect(normalized).toContain("region_id <> '__multiple__'");

    // A standard per-unit analysis: no sub-unit rollup or mean-to-ratio conversion.
    expect(normalized).not.toContain("__clusterRollup");
    expect(normalized).not.toContain("m0_denominator");
    // Cluster-level metrics are already at the cluster grain, so there is no
    // sub-unit rollup and thus no sub-unit count.
    expect(normalized).not.toContain("sub_count");
    expect(normalized).toContain("FROM __userMetricAgg m");
    expect(normalized).toContain("COUNT(*) AS users");
  });

  it("buckets cluster-spanning breakdown dimensions as __multiple__ for a cluster-level metric", () => {
    // The cluster exposure must declare the breakdown dimension so the units
    // query materializes a dim_exp_browser column.
    const clusterExposureQueryWithDim: ExposureQuery = {
      ...clusterExposureQuery,
      dimensions: ["browser"],
    };
    // @ts-expect-error -- context not needed for test
    const integration = new BigQuery("", {
      type: "bigquery",
      settings: { queries: { exposure: [clusterExposureQueryWithDim] } },
    });

    const metric = factMetricFactory.build({
      id: "fact_region_spend",
      metricType: "mean",
      numerator: {
        factTableId: "region_spend",
        column: "amount",
        aggregation: "sum",
      },
      regressionAdjustmentEnabled: false,
    });

    const dimensions: Dimension[] = [{ type: "experiment", id: "browser" }];
    const sql = getExperimentFactMetricsQuery(
      bigQueryDialect,
      integration.datasource,
      {
        settings: {
          ...baseSettings,
          clusterLevelMetricIds: ["fact_region_spend"],
        },
        unitsSource: "exposureQuery",
        unitsSettings: buildUnitsQuerySettingsFromSnapshot(
          { ...baseSettings, dimensions },
          {
            query: clusterExposureQueryWithDim.query,
            identifierType: "region_id",
          },
        ),
        activationMetric: null,
        dimensions,
        segment: null,
        metrics: [metric],
        factTableMap,
      },
    );
    const normalized = sql.replace(/\s+/g, " ").trim();

    // A cluster-level metric is one value per cluster. When a cluster spans more
    // than one browser there is no non-arbitrary slice to own that value, so it
    // is bucketed as '__multiple__' (mirroring the variation collapse) instead
    // of silently assigning the whole cluster to one browser via MIN.
    // MAX(...) is cast to a string so the CASE does not mix a numeric breakdown
    // column with the '__multiple__' marker (BigQuery rejects mixed-type CASE
    // branches, which would otherwise fail the full refresh for numeric
    // dimensions / cluster ids).
    expect(normalized).toMatch(
      /CASE WHEN COUNT\(DISTINCT dim_exp_browser\) > 1 THEN '__multiple__' ELSE cast\(MAX\(dim_exp_browser\) as string\) END\s*\)\s*AS dim_exp_browser/,
    );
    expect(normalized).not.toMatch(/MIN\(dim_exp_browser\)/);
  });

  it("joins a cluster-keyed segment through the cluster column, not the sub-unit", () => {
    const metric = factMetricFactory.build({
      id: "fact_cluster_mean",
      metricType: "mean",
      numerator: {
        factTableId: "orders",
        column: "amount",
        aggregation: "sum",
      },
    });

    const makeSegment = (userIdType: string): SegmentInterface => ({
      id: `seg_${userIdType}`,
      organization: "org",
      owner: "",
      datasource: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      name: `${userIdType} segment`,
      description: "",
      userIdType,
      type: "SQL",
      sql: `SELECT ${userIdType}, date FROM subscribers`,
    });

    const buildWithSegment = (segment: SegmentInterface): string =>
      getExperimentFactMetricsQuery(
        bigQueryDialect,
        datasourceIntegration.datasource,
        {
          settings: baseSettings,
          unitsSource: "exposureQuery",
          unitsSettings: buildUnitsQuerySettingsFromSnapshot(baseSettings, {
            query: clusterExposureQuery.query,
            identifierType: "region_id",
          }),
          activationMetric: null,
          dimensions: [],
          segment,
          metrics: [metric],
          factTableMap,
        },
      )
        .replace(/\s+/g, " ")
        .trim();

    // A segment keyed on the cluster column (region_id) is already carried by the
    // exposure rows, so it must join through region_id and request NO identity
    // join table. The base id type is forced to the sub-unit (user_id), so a
    // region_id -> user_id join table does not exist and getIdentitiesCTE would
    // otherwise throw "Missing identifier join table".
    const clusterKeyedSql = buildWithSegment(makeSegment("region_id"));
    expect(clusterKeyedSql).toContain(
      "JOIN __segment s ON (s.region_id = e.region_id)",
    );
    expect(clusterKeyedSql).not.toContain(
      "JOIN __segment s ON (s.user_id = e.user_id)",
    );

    // A segment keyed on the sub-unit (user_id) still joins on the sub-unit.
    const subUnitKeyedSql = buildWithSegment(makeSegment("user_id"));
    expect(subUnitKeyedSql).toContain(
      "JOIN __segment s ON (s.user_id = e.user_id)",
    );
  });

  it("refuses to mix cluster-level and sub-unit metrics in one query", () => {
    const subUnitMetric = factMetricFactory.build({
      id: "fact_orders",
      metricType: "mean",
      numerator: {
        factTableId: "orders",
        column: "amount",
        aggregation: "sum",
      },
    });
    const clusterMetric = factMetricFactory.build({
      id: "fact_region_spend",
      metricType: "mean",
      numerator: {
        factTableId: "region_spend",
        column: "amount",
        aggregation: "sum",
      },
    });

    expect(() =>
      getExperimentFactMetricsQuery(
        bigQueryDialect,
        datasourceIntegration.datasource,
        {
          settings: {
            ...baseSettings,
            clusterLevelMetricIds: ["fact_region_spend"],
          },
          unitsSource: "exposureQuery",
          unitsSettings: buildUnitsQuerySettingsFromSnapshot(baseSettings, {
            query: clusterExposureQuery.query,
            identifierType: "region_id",
          }),
          activationMetric: null,
          dimensions: [],
          segment: null,
          metrics: [subUnitMetric, clusterMetric],
          factTableMap,
        },
      ),
    ).toThrow("cannot share a metric source cache");
  });

  const buildClusterTrafficSql = (clusterGrain: boolean): string =>
    datasourceIntegration.getExperimentAggregateUnitsQuery({
      settings: baseSettings,
      unitsSettings: buildUnitsQuerySettingsFromSnapshot(baseSettings, {
        query: clusterExposureQuery.query,
        identifierType: "region_id",
      }),
      activationMetric: null,
      dimensions: [],
      segment: null,
      factTableMap,
      useUnitsTable: true,
      unitsTableFullName: "proj.ds.units",
      clusterGrain,
    });

  it("counts traffic per sub-unit by default (no cluster collapse)", () => {
    const normalized = buildClusterTrafficSql(false)
      .replace(/\s+/g, " ")
      .trim();
    // Without clusterGrain the sub-unit rows are counted directly.
    expect(normalized).not.toContain("__clusterCollapsedUnits");
    expect(normalized).toMatch(/__distinctUnits AS \( SELECT region_id/);
  });

  it("collapses sub-units to one row per cluster for cluster-grain traffic", () => {
    const normalized = buildClusterTrafficSql(true).replace(/\s+/g, " ").trim();

    // Sub-units are rolled up to one row per cluster before counting, so the
    // downstream COUNT(*) counts clusters (the randomization unit), not users.
    expect(normalized).toContain("__clusterCollapsedUnits");
    expect(normalized).toMatch(
      /__clusterCollapsedUnits AS \([\s\S]*GROUP BY region_id/,
    );
    // The collapsed set resolves a single variation and exposure date per cluster.
    expect(normalized).toMatch(/MIN\(first_exposure_timestamp\)/);
    // __distinctUnits then reads the collapsed per-cluster set.
    expect(normalized).toMatch(
      /__distinctUnits AS \( SELECT region_id[\s\S]*FROM __clusterCollapsedUnits/,
    );
  });

  const buildClusterHealthSql = (useUnitsTable: boolean): string =>
    datasourceIntegration.getExperimentClusterHealthQuery({
      settings: baseSettings,
      unitsSettings: buildUnitsQuerySettingsFromSnapshot(baseSettings, {
        query: clusterExposureQuery.query,
        identifierType: "region_id",
      }),
      activationMetric: null,
      dimensions: [],
      segment: null,
      factTableMap,
      useUnitsTable,
      unitsTableFullName: useUnitsTable ? "proj.ds.units" : undefined,
    });

  it("aggregates clusters once and reuses the aggregate for every branch", () => {
    const normalized = buildClusterHealthSql(true).replace(/\s+/g, " ").trim();

    // A single per-cluster aggregate (cluster id, min/max assignment, sub-unit
    // count) is computed once from the units table and reused by all branches.
    expect(normalized).toMatch(
      /__clusterAgg AS \([\s\S]*region_id AS cluster_id[\s\S]*MIN\(variation\) AS min_variation[\s\S]*MAX\(variation\) AS max_variation[\s\S]*COUNT\(DISTINCT user_id\) AS units[\s\S]*FROM proj\.ds\.units[\s\S]*GROUP BY region_id/,
    );
    // The units table is scanned once (by __clusterAgg); branches read the CTEs.
    expect((normalized.match(/FROM proj\.ds\.units/g) ?? []).length).toBe(1);
    expect(normalized).not.toContain("__rawExperiment");
    expect(normalized).not.toContain("__experimentUnits");
  });

  it("emits a reliability branch with top-N clusters by sub-unit count", () => {
    const normalized = buildClusterHealthSql(true).replace(/\s+/g, " ").trim();

    // Share of all surviving sub-units: numerator over a window SUM.
    expect(normalized).toMatch(/\/ SUM\(units\) OVER \(\s*\) AS pct/);
    // Reliability rows carry the cluster id, variation, and counts.
    expect(normalized).toContain("'reliability' AS kind");
    // Largest clusters first, capped at the row limit.
    expect(normalized).toMatch(/ORDER BY units DESC/);
    expect(normalized).toMatch(
      new RegExp(`LIMIT ${MAX_ROWS_CLUSTER_UNITS_QUERY}`),
    );
  });

  it("emits an assignment branch with total and mixed cluster counts", () => {
    const normalized = buildClusterHealthSql(true).replace(/\s+/g, " ").trim();

    expect(normalized).toContain("'assignment' AS kind");
    // Counts every cluster, flagging those with mixed assignment, off the shared
    // per-cluster aggregate.
    expect(normalized).toMatch(/COUNT\(\*\)[\s\S]*AS metric_a/);
    // A cluster whose sub-units all carry the multi-variation marker has
    // min_variation = max_variation = '__multiple__', so it must be flagged as
    // mixed explicitly (otherwise it looks consistent).
    expect(normalized).toMatch(
      /SUM\(\s*CASE WHEN min_variation <> max_variation OR max_variation = '__multiple__' THEN 1 ELSE 0 END\s*\)[\s\S]*AS metric_b/,
    );
    expect(normalized).toMatch(/'assignment' AS kind[\s\S]*FROM __clusterAgg/);
    // The __multiple__ pseudo-cluster is excluded so it does not inflate the
    // total or mixed cluster counts.
    expect(normalized).toMatch(
      /'assignment' AS kind[\s\S]*?FROM __clusterAgg[\s\S]*?WHERE cluster_id <> '__multiple__'[\s\S]*?UNION ALL SELECT 'mapping'/,
    );
    // The unused cluster_id/variation placeholders use a dialect-safe empty
    // string, never a NULL cast: `CAST(NULL AS VARCHAR)` fails on MySQL (no
    // VARCHAR cast target) and ClickHouse (non-nullable String).
    expect(normalized).toContain("'' AS cluster_id");
    expect(normalized).toContain("'' AS variation");
    expect(normalized).not.toMatch(/CAST\(\s*NULL\s+AS/i);
  });

  it("emits a mapping branch counting multi-cluster sub-units", () => {
    const normalized = buildClusterHealthSql(true).replace(/\s+/g, " ").trim();

    expect(normalized).toContain("'mapping' AS kind");
    expect(normalized).toMatch(/SUM\(units\)[\s\S]*AS metric_a/);
    expect(normalized).toMatch(
      /SUM\(\s*CASE WHEN cluster_id = '__multiple__' THEN units ELSE 0 END\s*\)[\s\S]*AS metric_b/,
    );
    expect(normalized).toMatch(/'mapping' AS kind[\s\S]*FROM __clusterAgg/);
  });

  it("emits an exposures branch counting sub-units that saw multiple variations", () => {
    const normalized = buildClusterHealthSql(true).replace(/\s+/g, " ").trim();

    // The per-cluster aggregate also tallies sub-units bucketed to the
    // multi-variation marker, counted at the sub-unit grain before any
    // cluster-consistency filter removes them.
    expect(normalized).toMatch(
      /COUNT\(\s*DISTINCT CASE WHEN variation = '__multiple__' THEN user_id END\s*\) AS multi_exposed_units/,
    );
    expect(normalized).toContain("'exposures' AS kind");
    // Totals are summed from the shared aggregate (no extra scan of the units
    // table): total distinct sub-units (denominator) and multi-variation ones.
    expect(normalized).toMatch(
      /'exposures' AS kind[\s\S]*SUM\(units\)[\s\S]*AS metric_a/,
    );
    expect(normalized).toMatch(
      /'exposures' AS kind[\s\S]*SUM\(multi_exposed_units\)[\s\S]*AS metric_b/,
    );
    expect(normalized).toMatch(/'exposures' AS kind[\s\S]*FROM __clusterAgg/);
  });

  it("drops multi-cluster sub-units and mixed clusters from the reliability branch", () => {
    const normalized = buildClusterHealthSql(true).replace(/\s+/g, " ").trim();

    // The reliability set only keeps real, single-assignment clusters. A cluster
    // whose sub-units are all the multi-variation marker (min = max =
    // '__multiple__') is mixed, not consistent, so it is excluded explicitly.
    expect(normalized).toMatch(
      /__realClusters AS \([\s\S]*WHERE cluster_id <> '__multiple__'[\s\S]*AND min_variation = max_variation[\s\S]*AND max_variation <> '__multiple__'/,
    );
  });

  it("builds units inline when no units table is available", () => {
    const normalized = buildClusterHealthSql(false).replace(/\s+/g, " ").trim();

    // Builds the sub-unit-grained units set inline, then aggregates per cluster.
    expect(normalized).toContain("__rawExperiment");
    expect(normalized).toContain("__experimentUnits");
    expect(normalized).toMatch(
      /__clusterAgg AS \([\s\S]*FROM __experimentUnits/,
    );
  });

  it("marks a sub-unit's cluster id as __multiple__ when it maps to >1 cluster", () => {
    // The inline units build collapses to one row per sub-unit and flags
    // sub-units observed in more than one cluster. The surviving id is cast to a
    // string so the CASE shares a type with the '__multiple__' sentinel (a bare
    // numeric id would make the CASE type-mismatch on BigQuery/Postgres) and so
    // the downstream `<> '__multiple__'` filters compare like types.
    const normalized = buildClusterHealthSql(false).replace(/\s+/g, " ").trim();

    expect(normalized).toMatch(
      /CASE WHEN count\(distinct e\.region_id\) > 1 THEN '__multiple__' ELSE cast\(max\(e\.region_id\) as string\) END\s*\) AS region_id/,
    );
  });

  it("drops multi-cluster sub-units from the traffic query", () => {
    const normalized = buildClusterTrafficSql(false)
      .replace(/\s+/g, " ")
      .trim();

    expect(normalized).toContain("region_id <> '__multiple__'");
  });
});

describe("event tracker date limits", () => {
  // @ts-expect-error -- context not needed for test
  const bq = new BigQuery("", { type: "bigquery", settings: {} });

  it.each(["segment", "rudderstack", "amplitude"] as const)(
    "%s bounds only the start date",
    (schemaFormat) => {
      const { getDateLimitClause } = bq.getSchemaFormatConfig(schemaFormat);
      expect(getDateLimitClause()).toMatch(
        / >= '\{\{date startDateISO "yyyy-MM-dd"\}\}'$/,
      );
    },
  );
});

describe("getInformationSchemaColumns", () => {
  it("flags partition columns, whether reported as a number or a string", () => {
    expect(
      getInformationSchemaColumns([
        { column_name: "user_id", data_type: "STRING", is_partition: 0 },
        { column_name: "ts", data_type: "TIMESTAMP", is_partition: "1" },
        { column_name: "dt", data_type: "DATE", is_partition: 1 },
      ]),
    ).toEqual([
      { columnName: "user_id", dataType: "STRING" },
      { columnName: "ts", dataType: "TIMESTAMP", isPartition: true },
      { columnName: "dt", dataType: "DATE", isPartition: true },
    ]);
  });
});
