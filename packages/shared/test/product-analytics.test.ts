import { generateProductAnalyticsSQL } from "shared/enterprise";
import { format, createLikeStringMatchFn } from "shared/sql";
import {
  ExplorationConfig,
  explorationConfigValidator,
} from "shared/validators";
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
    stringMatch: createLikeStringMatchFn({
      escapeStringLiteral: (value) => value,
      emitEscapeClause: false,
    }),
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

  const ratioMetricMap = new Map<string, FactMetricInterface>([
    [
      "revenue_per_event",
      {
        id: "revenue_per_event",
        name: "Revenue per Event",
        metricType: "ratio",
        numerator: {
          factTableId: "orders",
          column: "revenue",
          aggregation: "sum",
        },
        denominator: {
          factTableId: "orders",
          column: "$$count",
          aggregation: "sum",
        },
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
  ]);

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

  it("generates SQL aliases for event-level ratio metrics", () => {
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
            name: "Revenue per Event",
            type: "metric",
            metricId: "revenue_per_event",
            rowFilters: [],
            unit: null,
            denominatorUnit: null,
          },
        ],
      },
    };

    const { sql, orderedMetricIds } = generateProductAnalyticsSQL(
      config,
      factTableMap,
      ratioMetricMap,
      helpers,
      datasource,
    );

    expect(orderedMetricIds).toEqual(["revenue_per_event"]);
    expect(sql).toContain("CAST(SUM(m0) AS FLOAT) AS m0_numerator");
    expect(sql).toContain(
      "CAST(SUM(m0_denominator) AS FLOAT) AS m0_denominator",
    );
    expect(sql).toContain("m0_numerator AS m0_numerator");
    expect(sql).toContain("m0_denominator AS m0_denominator");
    expect(sql).not.toContain("m0_denominator_numerator");
    expect(sql).not.toContain("m0_denominator_denominator");
  });

  it("generates SQL aliases for ratio metrics across unit and event rollups", () => {
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
            name: "Revenue per Event",
            type: "metric",
            metricId: "revenue_per_event",
            rowFilters: [],
            unit: "user_id",
            denominatorUnit: null,
          },
        ],
      },
    };

    const { sql, orderedMetricIds } = generateProductAnalyticsSQL(
      config,
      factTableMap,
      ratioMetricMap,
      helpers,
      datasource,
    );

    expect(orderedMetricIds).toEqual(["revenue_per_event"]);
    expect(sql).toContain("CAST(SUM(m0) AS FLOAT) AS m0_numerator");
    expect(sql).toContain(
      "CAST(SUM(m0_denominator) AS FLOAT) AS m0_denominator",
    );
    expect(sql).toContain("MAX(m0_numerator) AS m0_numerator");
    expect(sql).toContain("MAX(m0_denominator) AS m0_denominator");
    expect(sql).not.toContain("m0_denominator_numerator");
    expect(sql).not.toContain("m0_denominator_denominator");
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

  it("uses explicit dynamic dimension values instead of a top-N CTE", () => {
    const baseDataset: ExplorationConfig["dataset"] = {
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
      ],
    };

    const withPinnedValues: ExplorationConfig = {
      type: "fact_table",
      datasource: "ds_1",
      chartType: "bar",
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
          dimensionType: "dynamic",
          column: "user_id",
          maxValues: 5,
          values: ["alice", "bob"],
        },
      ],
      dataset: baseDataset,
    };

    const { sql: pinnedSql } = generateProductAnalyticsSQL(
      withPinnedValues,
      factTableMap,
      metricMap,
      helpers,
      datasource,
    );

    expect(pinnedSql).toContain("IN ('alice', 'bob')");
    expect(pinnedSql).not.toContain("_dimension0_top");
    expect(pinnedSql).not.toMatch(/ELSE\s+'other'/i);
    expect(pinnedSql).toMatch(
      /WHERE[\s\S]*user_id\s+IN\s*\(\s*'alice'\s*,\s*'bob'\s*\)/i,
    );

    const withTopN: ExplorationConfig = {
      ...withPinnedValues,
      dimensions: [
        {
          dimensionType: "dynamic",
          column: "user_id",
          maxValues: 5,
        },
      ],
    };

    const { sql: topNSql } = generateProductAnalyticsSQL(
      withTopN,
      factTableMap,
      metricMap,
      helpers,
      datasource,
    );

    expect(topNSql).toContain("_dimension0_top");
    expect(topNSql).toMatch(
      /IN\s*\(\s*SELECT\s+value\s+FROM\s+_dimension0_top\s*\)/i,
    );
  });

  it("ignores pinned values when the dynamic dimension column is missing", () => {
    const config: ExplorationConfig = {
      type: "fact_table",
      datasource: "ds_1",
      chartType: "bar",
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
          dimensionType: "dynamic",
          column: null,
          maxValues: 5,
          values: ["alice", "bob"],
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

    // Must not emit a bare IN (...) with an empty column expression
    expect(sql).not.toMatch(/(?:^|[^\w.])IN\s*\(\s*'alice'\s*,\s*'bob'\s*\)/i);
    expect(sql).toContain("_dimension0_top");
  });

  it("rejects pinned values without a column in explorationConfigValidator", () => {
    const result = explorationConfigValidator.safeParse({
      type: "fact_table",
      datasource: "ds_1",
      chartType: "bar",
      dimensions: [
        {
          dimensionType: "dynamic",
          column: null,
          maxValues: 5,
          values: ["alice", "bob"],
        },
      ],
      dateRange: {
        predefined: "last7Days",
        startDate: null,
        endDate: null,
        lookbackValue: null,
        lookbackUnit: null,
      },
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
        ],
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("column"))).toBe(
        true,
      );
    }
  });

  it("rejects more than 20 pinned dimension values", () => {
    const result = explorationConfigValidator.safeParse({
      type: "fact_table",
      datasource: "ds_1",
      chartType: "bar",
      dimensions: [
        {
          dimensionType: "dynamic",
          column: "user_id",
          maxValues: 5,
          values: Array.from({ length: 21 }, (_, i) => `v${i}`),
        },
      ],
      dateRange: {
        predefined: "last7Days",
        startDate: null,
        endDate: null,
        lookbackValue: null,
        lookbackUnit: null,
      },
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
        ],
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("values"))).toBe(
        true,
      );
    }
  });

  it("builds pinned dimension filters per fact table schema", () => {
    const multiFactTableMap = new Map<string, FactTableInterface>([
      [
        "orders",
        {
          ...factTableMap.get("orders")!,
          columns: [
            ...factTableMap.get("orders")!.columns,
            {
              column: "meta",
              datatype: "json",
              dateCreated: new Date(),
              dateUpdated: new Date(),
              name: "meta",
              description: "",
              numberFormat: "",
              alwaysInlineFilter: false,
              deleted: false,
              autoSlices: [],
              isAutoSliceColumn: false,
              jsonFields: {
                country: { datatype: "string" },
              },
            },
          ],
          sql: "SELECT user_id, anonymous_id, timestamp, revenue, meta FROM orders",
        },
      ],
      [
        "sessions",
        {
          ...factTableMap.get("orders")!,
          id: "sessions",
          name: "Sessions",
          sql: "SELECT user_id, anonymous_id, timestamp, meta FROM sessions",
          columns: [
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
            // Same logical path name, but stored as a plain string column —
            // getColumnExpression must not use jsonExtract here.
            {
              column: "meta.country",
              datatype: "string",
              dateCreated: new Date(),
              dateUpdated: new Date(),
              name: "meta.country",
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

    const multiMetricMap = new Map<string, FactMetricInterface>([
      [
        "orders_count",
        {
          id: "orders_count",
          name: "Orders",
          metricType: "proportion",
          numerator: {
            factTableId: "orders",
            column: "$$distinctUsers",
            aggregation: "sum",
          },
          denominator: null,
          cappingSettings: { type: "", value: 0 },
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
        "sessions_count",
        {
          id: "sessions_count",
          name: "Sessions",
          metricType: "proportion",
          numerator: {
            factTableId: "sessions",
            column: "$$distinctUsers",
            aggregation: "sum",
          },
          denominator: null,
          cappingSettings: { type: "", value: 0 },
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
    ]);

    const config: ExplorationConfig = {
      type: "metric",
      datasource: "ds_1",
      chartType: "bar",
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
          dimensionType: "dynamic",
          column: "meta.country",
          maxValues: 5,
          values: ["US", "CA"],
        },
      ],
      dataset: {
        type: "metric",
        values: [
          {
            name: "Orders",
            type: "metric",
            metricId: "orders_count",
            rowFilters: [],
            unit: "user_id",
            denominatorUnit: null,
          },
          {
            name: "Sessions",
            type: "metric",
            metricId: "sessions_count",
            rowFilters: [],
            unit: "user_id",
            denominatorUnit: null,
          },
        ],
      },
    };

    const { sql } = generateProductAnalyticsSQL(
      config,
      multiFactTableMap,
      multiMetricMap,
      helpers,
      datasource,
    );

    // orders: meta is JSON → jsonExtract expression
    expect(sql).toMatch(
      /_factTable0_rows AS \([\s\S]*?meta:'country'::text\s+IN\s*\(\s*'US'\s*,\s*'CA'\s*\)/,
    );
    // sessions: meta.country is a plain string column → bare identifier
    expect(sql).toMatch(
      /_factTable1_rows AS \([\s\S]*?"?meta\.country"?\s+IN\s*\(\s*'US'\s*,\s*'CA'\s*\)/,
    );
    // Must not apply the JSON extract filter to the second fact table
    expect(sql).not.toMatch(
      /_factTable1_rows AS \([\s\S]*?meta:'country'::text\s+IN/,
    );
  });
});
