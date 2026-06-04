import { generateProductAnalyticsSQL } from "shared/enterprise";
import { format } from "shared/sql";
import { ExplorationConfig } from "shared/validators";
import { SqlDialect } from "shared/types/sql";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { DataSourceInterface } from "shared/types/datasource";

describe("productAnalytics", () => {
  const datasource: Partial<Pick<DataSourceInterface, "settings">> = {
    settings: {},
  };

  const helpers: SqlDialect = {
    escapeStringLiteral: (value) => value,
    jsonExtract: (jsonCol, path, isNumeric) =>
      `${jsonCol}:'${path}'::${isNumeric ? "float" : "text"}`,
    evalBoolean: (col, value) => `${col} IS ${value ? "TRUE" : "FALSE"}`,
    dateTrunc: (col, granularity) => `date_trunc('${granularity}', ${col})`,
    percentileApprox: (col, quantile) =>
      `APPROX_PERCENTILE(${col}, ${quantile})`,
    hllReaggregate: (col) => `HLL_MERGE(${col})`,
    hllCardinality: (col) => `HLL_COUNT(${col})`,
    quantileSketchMergePartial: (col) => `KLL_MERGE(${col})`,
    quantileSketchExtractPoint: (col, quantile) =>
      `KLL_POINT(${col}, ${quantile})`,
    toTimestamp: (d: Date) =>
      // Do not include the timestamp component to make the test deterministic
      `'${d.toISOString().substring(0, 10)} 00:00:00'`,
    formatDialect: "bigquery",
    castToFloat: (col) => `CAST(${col} AS FLOAT)`,
  };

  const factTableMap = new Map<string, FactTableInterface>([
    [
      "orders",
      {
        columns: [
          {
            column: "revenue",
            datatype: "number",
            dateCreated: new Date(),
            dateUpdated: new Date(),
            name: "revenue",
            description: "",
            numberFormat: "currency",
            alwaysInlineFilter: false,
            deleted: false,
            autoSlices: [],
            isAutoSliceColumn: false,
          },
          {
            column: "user_id",
            datatype: "string",
            dateCreated: new Date(),
            dateUpdated: new Date(),
            name: "user_id",
            description: "",
            numberFormat: "",
            alwaysInlineFilter: false,
            deleted: false,
            autoSlices: [],
            isAutoSliceColumn: false,
          },
          {
            column: "anonymous_id",
            datatype: "string",
            dateCreated: new Date(),
            dateUpdated: new Date(),
            name: "anonymous_id",
            description: "",
            numberFormat: "",
            alwaysInlineFilter: false,
            deleted: false,
            autoSlices: [],
            isAutoSliceColumn: false,
          },
          {
            column: "timestamp",
            datatype: "date",
            dateCreated: new Date(),
            dateUpdated: new Date(),
            name: "timestamp",
            description: "",
            numberFormat: "",
            alwaysInlineFilter: false,
            deleted: false,
            autoSlices: [],
            isAutoSliceColumn: false,
          },
        ],
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

  const sketchFactTableMap = new Map<string, FactTableInterface>([
    [
      "sketches",
      {
        ...factTableMap.get("orders")!,
        id: "sketches",
        name: "Sketches",
        sql: "SELECT user_id, timestamp, users_hll, latency_kll FROM sketches",
        columns: [
          ...factTableMap.get("orders")!.columns,
          {
            column: "users_hll",
            datatype: "binary",
            dateCreated: new Date(),
            dateUpdated: new Date(),
            name: "users_hll",
            description: "",
            numberFormat: "",
            alwaysInlineFilter: false,
            deleted: false,
            autoSlices: [],
            isAutoSliceColumn: false,
          },
          {
            column: "latency_kll",
            datatype: "binary",
            dateCreated: new Date(),
            dateUpdated: new Date(),
            name: "latency_kll",
            description: "",
            numberFormat: "",
            alwaysInlineFilter: false,
            deleted: false,
            autoSlices: [],
            isAutoSliceColumn: false,
          },
        ],
      },
    ],
  ]);

  const sketchMetricMap = new Map<string, FactMetricInterface>([
    [
      "hll_metric",
      {
        id: "hll_metric",
        name: "Users HLL",
        metricType: "mean",
        numerator: {
          factTableId: "sketches",
          column: "users_hll",
          aggregation: "hll merge",
        },
        denominator: null,
        cappingSettings: {
          type: "",
          value: 0,
        },
        windowSettings: {
          type: "",
          delayValue: 0,
          delayUnit: "days",
          windowValue: 0,
          windowUnit: "days",
        },
        quantileSettings: null,
      } as FactMetricInterface,
    ],
    [
      "kll_metric",
      {
        id: "kll_metric",
        name: "Latency KLL",
        metricType: "quantile",
        numerator: {
          factTableId: "sketches",
          column: "latency_kll",
          aggregation: "kll merge",
        },
        denominator: null,
        cappingSettings: {
          type: "",
          value: 0,
        },
        windowSettings: {
          type: "",
          delayValue: 0,
          delayUnit: "days",
          windowValue: 0,
          windowUnit: "days",
        },
        quantileSettings: {
          type: "event",
          quantile: 0.9,
          ignoreZeros: false,
        },
      } as FactMetricInterface,
    ],
  ]);

  it("generates SQL for fact tables", () => {
    const config: ExplorationConfig = {
      type: "fact_table",
      datasource: "ds_1",
      chartType: "line",
      showAs: "total",
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
            type: "fact_table",
            rowFilters: [],
            valueType: "unit_count",
            unit: "user_id",
            valueColumn: null,
          },
          {
            name: "revenue",
            type: "fact_table",
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
            MAX(m0) AS m0
          FROM _factTable0_rows
          GROUP BY
            unit0,
            dimension0
        ),
        _factTable0_unit0_rollup AS (
          SELECT
            dimension0,
            CAST(SUM(m0) AS FLOAT) AS m0_numerator,
            CAST(COUNT(m0) AS FLOAT) AS m0_denominator,
            CAST(NULL AS FLOAT) AS m1_numerator
          FROM _factTable0_unit0
          GROUP BY
            dimension0
        ),
        _factTable0_event_rollup AS (
          SELECT
            dimension0,
            CAST(NULL AS FLOAT) AS m0_numerator,
            CAST(NULL AS FLOAT) AS m0_denominator,
            CAST(SUM(m1) AS FLOAT) AS m1_numerator
          FROM _factTable0_rows
          GROUP BY
            dimension0
        ),
        _combined_rollup AS (
          SELECT * FROM _factTable0_unit0_rollup
          UNION ALL
          SELECT * FROM _factTable0_event_rollup
        )
      SELECT
        dimension0,
        MAX(m0_numerator) AS m0_numerator,
        MAX(m0_denominator) AS m0_denominator,
        MAX(m1_numerator) AS m1_numerator
      FROM _combined_rollup
      GROUP BY
        dimension0
    `,
      helpers.formatDialect,
    );

    expect(sql).toEqual(expected);
  });

  it("generates SQL for fact tables with mix of filtered and unfiltered values", () => {
    const config: ExplorationConfig = {
      type: "fact_table",
      datasource: "ds_1",
      chartType: "line",
      showAs: "total",
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
            type: "fact_table",
            rowFilters: [
              {
                operator: ">",
                column: "revenue",
                values: ["100"],
              },
            ],
            valueType: "unit_count",
            unit: "user_id",
            valueColumn: null,
          },
          {
            name: "revenue",
            type: "fact_table",
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
            CASE WHEN ((revenue > 100)) THEN 1 ELSE NULL END AS m0,
            revenue AS m1
          FROM _factTable0
        ),
        _factTable0_unit0 AS (
          SELECT
            unit0,
            dimension0,
            MAX(m0) AS m0
          FROM _factTable0_rows
          GROUP BY
            unit0,
            dimension0
        ),
        _factTable0_unit0_rollup AS (
          SELECT
            dimension0,
            CAST(SUM(m0) AS FLOAT) AS m0_numerator,
            CAST(COUNT(m0) AS FLOAT) AS m0_denominator,
            CAST(NULL AS FLOAT) AS m1_numerator
          FROM _factTable0_unit0
          GROUP BY
            dimension0
        ),
        _factTable0_event_rollup AS (
          SELECT
            dimension0,
            CAST(NULL AS FLOAT) AS m0_numerator,
            CAST(NULL AS FLOAT) AS m0_denominator,
            CAST(SUM(m1) AS FLOAT) AS m1_numerator
          FROM _factTable0_rows
          GROUP BY
            dimension0
        ),
        _combined_rollup AS (
          SELECT * FROM _factTable0_unit0_rollup
          UNION ALL
          SELECT * FROM _factTable0_event_rollup
        )
      SELECT
        dimension0,
        MAX(m0_numerator) AS m0_numerator,
        MAX(m0_denominator) AS m0_denominator,
        MAX(m1_numerator) AS m1_numerator
      FROM _combined_rollup
      GROUP BY
        dimension0
    `,
      helpers.formatDialect,
    );

    expect(sql).toEqual(expected);
  });

  it("generates SQL for fact tables with all values filtered", () => {
    const config: ExplorationConfig = {
      type: "fact_table",
      datasource: "ds_1",
      chartType: "line",
      showAs: "total",
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
            type: "fact_table",
            rowFilters: [
              {
                operator: ">",
                column: "revenue",
                values: ["100"],
              },
            ],
            valueType: "unit_count",
            unit: "user_id",
            valueColumn: null,
          },
          {
            name: "revenue",
            type: "fact_table",
            rowFilters: [
              {
                operator: ">",
                column: "revenue",
                values: ["200"],
              },
            ],
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
          AND ( (revenue > 100) OR (revenue > 200) )
        ),
        _factTable0_rows AS (
          SELECT
            date_trunc('day', timestamp) AS dimension0,
            user_id AS unit0,
            CASE WHEN ((revenue > 100)) THEN 1 ELSE NULL END AS m0,
            CASE WHEN ((revenue > 200)) THEN revenue ELSE NULL END AS m1
          FROM _factTable0
        ),
        _factTable0_unit0 AS (
          SELECT
            unit0,
            dimension0,
            MAX(m0) AS m0
          FROM _factTable0_rows
          GROUP BY
            unit0,
            dimension0
        ),
        _factTable0_unit0_rollup AS (
          SELECT
            dimension0,
            CAST(SUM(m0) AS FLOAT) AS m0_numerator,
            CAST(COUNT(m0) AS FLOAT) AS m0_denominator,
            CAST(NULL AS FLOAT) AS m1_numerator
          FROM _factTable0_unit0
          GROUP BY
            dimension0
        ),
        _factTable0_event_rollup AS (
          SELECT
            dimension0,
            CAST(NULL AS FLOAT) AS m0_numerator,
            CAST(NULL AS FLOAT) AS m0_denominator,
            CAST(SUM(m1) AS FLOAT) AS m1_numerator
          FROM _factTable0_rows
          GROUP BY
            dimension0
        ),
        _combined_rollup AS (
          SELECT * FROM _factTable0_unit0_rollup
          UNION ALL
          SELECT * FROM _factTable0_event_rollup
        )
      SELECT
        dimension0,
        MAX(m0_numerator) AS m0_numerator,
        MAX(m0_denominator) AS m0_denominator,
        MAX(m1_numerator) AS m1_numerator
      FROM _combined_rollup
      GROUP BY
        dimension0
    `,
      helpers.formatDialect,
    );

    expect(sql).toEqual(expected);
  });

  it("generates SQL for fact tables with deduped value filters", () => {
    const config: ExplorationConfig = {
      type: "fact_table",
      datasource: "ds_1",
      chartType: "line",
      showAs: "total",
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
            type: "fact_table",
            rowFilters: [
              {
                operator: ">",
                column: "revenue",
                values: ["100"],
              },
            ],
            valueType: "unit_count",
            unit: "user_id",
            valueColumn: null,
          },
          {
            name: "revenue",
            type: "fact_table",
            rowFilters: [
              {
                operator: ">",
                column: "revenue",
                values: ["100"],
              },
            ],
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
          AND ( revenue > 100 )
        ),
        _factTable0_rows AS (
          SELECT
            date_trunc('day', timestamp) AS dimension0,
            user_id AS unit0,
            CASE WHEN ((revenue > 100)) THEN 1 ELSE NULL END AS m0,
            CASE WHEN ((revenue > 100)) THEN revenue ELSE NULL END AS m1
          FROM _factTable0
        ),
        _factTable0_unit0 AS (
          SELECT
            unit0,
            dimension0,
            MAX(m0) AS m0
          FROM _factTable0_rows
          GROUP BY
            unit0,
            dimension0
        ),
        _factTable0_unit0_rollup AS (
          SELECT
            dimension0,
            CAST(SUM(m0) AS FLOAT) AS m0_numerator,
            CAST(COUNT(m0) AS FLOAT) AS m0_denominator,
            CAST(NULL AS FLOAT) AS m1_numerator
          FROM _factTable0_unit0
          GROUP BY
            dimension0
        ),
        _factTable0_event_rollup AS (
          SELECT
            dimension0,
            CAST(NULL AS FLOAT) AS m0_numerator,
            CAST(NULL AS FLOAT) AS m0_denominator,
            CAST(SUM(m1) AS FLOAT) AS m1_numerator
          FROM _factTable0_rows
          GROUP BY
            dimension0
        ),
        _combined_rollup AS (
          SELECT * FROM _factTable0_unit0_rollup
          UNION ALL
          SELECT * FROM _factTable0_event_rollup
        )
      SELECT
        dimension0,
        MAX(m0_numerator) AS m0_numerator,
        MAX(m0_denominator) AS m0_denominator,
        MAX(m1_numerator) AS m1_numerator
      FROM _combined_rollup
      GROUP BY
        dimension0
    `,
      helpers.formatDialect,
    );

    expect(sql).toEqual(expected);
  });

  it("generates SQL for HLL merge metric unit aggregation", () => {
    const config: ExplorationConfig = {
      type: "metric",
      datasource: "ds_1",
      chartType: "line",
      showAs: "total",
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
        type: "metric",
        values: [
          {
            name: "Users HLL",
            type: "metric",
            metricId: "hll_metric",
            rowFilters: [],
            unit: "user_id",
            denominatorUnit: null,
          },
        ],
      },
    };

    const { sql } = generateProductAnalyticsSQL(
      config,
      sketchFactTableMap,
      sketchMetricMap,
      helpers,
      datasource,
    );

    expect(sql).toMatch(
      /HLL_COUNT\s*\(\s*HLL_MERGE\s*\(\s*m0\s*\)\s*\)\s+AS\s+m0/,
    );
    expect(sql).toContain("CAST(SUM(m0) AS FLOAT) AS m0_numerator");
  });

  it("generates SQL for KLL merge quantile rollup", () => {
    const config: ExplorationConfig = {
      type: "metric",
      datasource: "ds_1",
      chartType: "line",
      showAs: "total",
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
        type: "metric",
        values: [
          {
            name: "Latency KLL",
            type: "metric",
            metricId: "kll_metric",
            rowFilters: [],
            unit: null,
            denominatorUnit: null,
          },
        ],
      },
    };

    const { sql } = generateProductAnalyticsSQL(
      config,
      sketchFactTableMap,
      sketchMetricMap,
      helpers,
      datasource,
    );

    expect(sql).toMatch(
      /CAST\s*\(\s*KLL_POINT\s*\(\s*KLL_MERGE\s*\(\s*m0\s*\),\s*0\.9\s*\)\s+AS\s+FLOAT\s*\)\s+AS\s+m0_numerator/,
    );
    expect(sql).not.toContain("APPROX_PERCENTILE(m0, 0.9)");
  });
});
