import { format } from "shared/sql";
import { ProductAnalyticsConfig } from "shared/validators";
import { SqlHelpers } from "shared/types/sql";
import { generateProductAnalyticsSQL } from "shared/src/enterprise/product-analytics/sql";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";

describe("productAnalytics", () => {
  const datasource: Partial<Pick<DataSourceInterface, "settings">> = {
    settings: {},
  };

  const helpers: SqlHelpers = {
    escapeStringLiteral: (value) => value,
    jsonExtract: (jsonCol, path, isNumeric) =>
      `${jsonCol}:'${path}'::${isNumeric ? "float" : "text"}`,
    evalBoolean: (col, value) => `${col} IS ${value ? "TRUE" : "FALSE"}`,
    dateTrunc: (col, granularity) => `date_trunc('${granularity}', ${col})`,
    percentileApprox: (col, quantile) =>
      `APPROX_PERCENTILE(${col}, ${quantile})`,
    toTimestamp: (d: Date) =>
      // Do not include the timestamp component to make the test deterministic
      `'${d.toISOString().substring(0, 10)} 00:00:00'`,
    formatDialect: "bigquery",
  };

  const factTableMap = new Map<string, FactTableInterface>([
    [
      "orders",
      {
        columns: [],
        datasource: "ds_1",
        filters: [],
        id: "orders",
        name: "Purchases",
        organization: "org_1",
        sql: "SELECT user_id, anonymous_id, timestamp, revenue FROM orders",
        userIdTypes: ["user_id", "anonymous_id"],
        dateCreated: new Date(),
        dateUpdated: new Date(),
        description: "",
        eventName: "",
        owner: "",
        projects: [],
        tags: [],
      },
    ],
  ]);

  const metricMap = new Map<string, FactMetricInterface>();

  it("generates SQL for fact tables", () => {
    const config: ProductAnalyticsConfig = {
      chartType: "line",
      dateRange: {
        predefined: "last7Days",
        startDate: null,
        endDate: null,
        lookbackValue: null,
        lookbackUnit: null,
      },
      dimensions: [
        {
          dimensionType: "date",
          column: null,
          dateGranularity: "day",
        },
      ],
      dataset: {
        type: "fact_table",
        factTableId: "orders",
        values: [
          {
            name: "purchasers",
            rowFilters: [],
            valueType: "unit_count",
            unit: "user_id",
            valueColumn: null,
          },
          {
            name: "revenue",
            rowFilters: [],
            valueType: "sum",
            unit: null,
            valueColumn: "revenue",
          },
        ],
      },
    };

    const { sql } = generateProductAnalyticsSQL(
      config,
      factTableMap,
      metricMap,
      helpers,
      datasource,
    );

    const now = new Date();
    const startTimestamp = new Date(now);
    startTimestamp.setUTCDate(startTimestamp.getUTCDate() - 7);

    const expected = format(
      `
      WITH
        _factTable0 AS (
          SELECT * FROM (
            -- Raw fact table SQL
            SELECT user_id, anonymous_id, timestamp, revenue FROM orders
          ) t
          WHERE timestamp >= ${helpers.toTimestamp(startTimestamp)} AND timestamp <= ${helpers.toTimestamp(now)}
        ),
        _factTable0_rows AS (
          SELECT
            date_trunc('day', timestamp) AS dimension0,
            user_id AS unit0,
            1 AS m0,
            revenue AS m1
          FROM _factTable0
        ),
        _factTable0_unit0 AS (
          SELECT
            unit0,
            dimension0,
            MAX(m0) AS m0,
            SUM(m1) AS m1
          FROM _factTable0_rows
          GROUP BY
            unit0,
            dimension0
        ),
        _factTable0_unit0_rollup AS (
          SELECT
            dimension0,
            SUM(m0) AS m0,
            SUM(m1) AS m1,
            COUNT(m1) AS m1_denominator
          FROM _factTable0_unit0
          GROUP BY
            dimension0
        )
      SELECT
        dimension0,
        MAX(m0) AS m0,
        MAX(m1) AS m1,
        MAX(m1_denominator) AS m1_denominator
      FROM _factTable0_unit0_rollup
      GROUP BY
        dimension0
    `,
      helpers.formatDialect,
    );

    expect(sql).toEqual(expected);
  });
});
