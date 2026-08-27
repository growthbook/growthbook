import { generateProductAnalyticsSQL } from "shared/enterprise";
import { format, createLikeStringMatchFn } from "shared/sql";
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
    // `last7Days` covers 7 inclusive UTC days, so it opens at midnight 6 days back.
    startTimestamp.setUTCDate(startTimestamp.getUTCDate() - 6);
    startTimestamp.setUTCHours(0, 0, 0, 0);

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

  it("generates SQL for fact tables with a static (pinned-values) dimension", () => {
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
          dimensionType: "static",
          column: "anonymous_id",
          values: ["a1", "a2"],
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

    // Rows outside the pinned list are dropped via a WHERE filter...
    expect(sql).toContain("anonymous_id IN ('a1', 'a2')");
    // ...and the dimension itself selects the raw column, no CASE/'other'.
    expect(sql).toContain("anonymous_id AS dimension0");
    expect(sql).not.toContain("'other'");
    // No top-values CTE is needed for a static (pinned) dimension.
    expect(sql).not.toContain("_dimension0_top");
  });

  it("skips the filter for a static dimension with no pinned values instead of emitting invalid SQL", () => {
    // The validator no longer rejects an empty `values` array (it must keep
    // parsing already-persisted/URL-encoded explorations that predate the
    // editor's 1-20 cap), so the SQL layer has to handle it gracefully
    // rather than emitting a malformed `IN ()`.
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
        { dimensionType: "static", column: "anonymous_id", values: [] },
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

    expect(sql).not.toContain("IN ()");
    expect(sql).not.toContain("anonymous_id IN");
  });

  it("resolves a static dimension's filter consistently across fact tables for a cross-table ratio metric", () => {
    // Regression test for a ratio metric whose denominator lives on a
    // different fact table than the numerator, and that table doesn't
    // expose the dimension's "props" column at all:
    //  1. The filter expression must be resolved against factTableGroups[0]
    //     (the same basis the dimension's SELECT expression uses), not
    //     against each group's own fact table — otherwise a table that
    //     doesn't share the numerator's JSON column shape would get a
    //     broken raw "props.plan" filter instead of a jsonExtract call.
    //  2. A group whose fact table can't resolve the column at all (like
    //     this denominator) must be skipped entirely, rather than referencing
    //     a column the warehouse doesn't have.
    const jsonFactTableMap = new Map<string, FactTableInterface>([
      [
        "orders",
        {
          ...factTableMap.get("orders")!,
          columns: [
            ...factTableMap.get("orders")!.columns,
            {
              column: "props",
              datatype: "json",
              dateCreated: new Date(),
              dateUpdated: new Date(),
              name: "props",
              description: "",
              numberFormat: "",
              alwaysInlineFilter: false,
              deleted: false,
              autoSlices: [],
              isAutoSliceColumn: false,
              jsonFields: { plan: { datatype: "string" } },
            },
          ],
        },
      ],
      [
        // Same base shape as "orders", but with no "props" column at all.
        "other_ft",
        {
          ...factTableMap.get("orders")!,
          id: "other_ft",
          sql: "SELECT user_id, timestamp, revenue FROM other_events",
        },
      ],
    ]);

    const crossTableRatioMetricMap = new Map<string, FactMetricInterface>([
      [
        "cross_table_ratio",
        {
          id: "cross_table_ratio",
          name: "Cross Table Ratio",
          metricType: "ratio",
          numerator: {
            factTableId: "orders",
            column: "revenue",
            aggregation: "sum",
          },
          denominator: {
            factTableId: "other_ft",
            column: "$$count",
            aggregation: "sum",
          },
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
      dateRange: {
        predefined: "last7Days",
        startDate: null,
        endDate: null,
        lookbackValue: null,
        lookbackUnit: null,
      },
      dimensions: [
        { dimensionType: "static", column: "props.plan", values: ["free"] },
      ],
      dataset: {
        type: "metric",
        values: [
          {
            name: "ratio",
            type: "metric",
            rowFilters: [],
            metricId: "cross_table_ratio",
            unit: null,
            denominatorUnit: null,
          },
        ],
      },
    };

    const { sql } = generateProductAnalyticsSQL(
      config,
      jsonFactTableMap,
      crossTableRatioMetricMap,
      helpers,
      datasource,
    );

    // Only the numerator's fact-table CTE (which actually has "props" as a
    // JSON column) gets the pinned-values filter, correctly resolved via
    // jsonExtract...
    const matches = sql.match(/props:'plan'::text IN \('free'\)/g) ?? [];
    expect(matches.length).toBe(1);
    // ...the denominator's CTE — whose fact table doesn't have "props" at
    // all — is left unfiltered rather than referencing a nonexistent
    // column, and there's never a broken raw "props.plan" reference.
    expect(sql).not.toContain("props.plan IN");
  });

  it("applies a static dimension's filter to every fact table that shares the column", () => {
    // Counterpart to the previous test: when the denominator's fact table
    // *does* have the dimension's column, both CTEs should still get
    // filtered — the skip only kicks in when the column is genuinely absent.
    const secondFactTableMap = new Map<string, FactTableInterface>([
      ["orders", factTableMap.get("orders")!],
      [
        "orders2",
        { ...factTableMap.get("orders")!, id: "orders2", name: "Orders 2" },
      ],
    ]);

    const sharedColumnRatioMetricMap = new Map<string, FactMetricInterface>([
      [
        "shared_column_ratio",
        {
          id: "shared_column_ratio",
          name: "Shared Column Ratio",
          metricType: "ratio",
          numerator: {
            factTableId: "orders",
            column: "revenue",
            aggregation: "sum",
          },
          denominator: {
            factTableId: "orders2",
            column: "$$count",
            aggregation: "sum",
          },
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
      dateRange: {
        predefined: "last7Days",
        startDate: null,
        endDate: null,
        lookbackValue: null,
        lookbackUnit: null,
      },
      dimensions: [
        {
          dimensionType: "static",
          column: "anonymous_id",
          values: ["a1"],
        },
      ],
      dataset: {
        type: "metric",
        values: [
          {
            name: "ratio",
            type: "metric",
            rowFilters: [],
            metricId: "shared_column_ratio",
            unit: null,
            denominatorUnit: null,
          },
        ],
      },
    };

    const { sql } = generateProductAnalyticsSQL(
      config,
      secondFactTableMap,
      sharedColumnRatioMetricMap,
      helpers,
      datasource,
    );

    const matches = sql.match(/anonymous_id IN \('a1'\)/g) ?? [];
    expect(matches.length).toBe(2);
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
    // `last7Days` covers 7 inclusive UTC days, so it opens at midnight 6 days back.
    startTimestamp.setUTCDate(startTimestamp.getUTCDate() - 6);
    startTimestamp.setUTCHours(0, 0, 0, 0);

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
    // `last7Days` covers 7 inclusive UTC days, so it opens at midnight 6 days back.
    startTimestamp.setUTCDate(startTimestamp.getUTCDate() - 6);
    startTimestamp.setUTCHours(0, 0, 0, 0);

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
    // `last7Days` covers 7 inclusive UTC days, so it opens at midnight 6 days back.
    startTimestamp.setUTCDate(startTimestamp.getUTCDate() - 6);
    startTimestamp.setUTCHours(0, 0, 0, 0);

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

  it("inlines virtual column expressions instead of referencing them by name", () => {
    const baseColumn = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "",
      numberFormat: "" as const,
      alwaysInlineFilter: false,
      deleted: false,
      autoSlices: [],
      isAutoSliceColumn: false,
    };
    const virtualFactTableMap = new Map<string, FactTableInterface>([
      [
        "orders",
        {
          ...factTableMap.get("orders")!,
          sql: "SELECT user_id, anonymous_id, timestamp, amount, qty FROM orders",
          columns: [
            {
              ...baseColumn,
              column: "amount",
              datatype: "number",
              name: "amount",
            },
            { ...baseColumn, column: "qty", datatype: "number", name: "qty" },
            {
              ...baseColumn,
              column: "user_id",
              datatype: "string",
              name: "user_id",
            },
            {
              ...baseColumn,
              column: "anonymous_id",
              datatype: "string",
              name: "anonymous_id",
            },
            {
              ...baseColumn,
              column: "timestamp",
              datatype: "date",
              name: "timestamp",
            },
            // Virtual (computed) column: not a real column in the warehouse.
            {
              ...baseColumn,
              column: "revenue_vc",
              datatype: "number",
              name: "revenue_vc",
              isVirtual: true,
              sql: "amount * qty",
            },
          ],
        },
      ],
    ]);

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
        { dimensionType: "date", column: null, dateGranularity: "day" },
      ],
      dataset: {
        type: "fact_table",
        factTableId: "orders",
        values: [
          {
            name: "revenue",
            type: "fact_table",
            rowFilters: [],
            valueType: "sum",
            unit: null,
            valueColumn: "revenue_vc",
          },
        ],
      },
    };

    const { sql } = generateProductAnalyticsSQL(
      config,
      virtualFactTableMap,
      metricMap,
      helpers,
      datasource,
    );

    // The virtual column must be expanded into its SQL expression, never
    // emitted as a bare identifier the warehouse cannot resolve.
    expect(sql).toContain("(amount * qty) AS m0");
    expect(sql).not.toContain("revenue_vc AS m0");
  });

  it("inlines a virtual column used as an aggregate filter column", () => {
    const baseColumn = {
      dateCreated: new Date(),
      dateUpdated: new Date(),
      description: "",
      numberFormat: "" as const,
      alwaysInlineFilter: false,
      deleted: false,
      autoSlices: [],
      isAutoSliceColumn: false,
    };
    const virtualFactTableMap = new Map<string, FactTableInterface>([
      [
        "orders",
        {
          ...factTableMap.get("orders")!,
          sql: "SELECT user_id, anonymous_id, timestamp, amount, qty FROM orders",
          columns: [
            {
              ...baseColumn,
              column: "amount",
              datatype: "number",
              name: "amount",
            },
            { ...baseColumn, column: "qty", datatype: "number", name: "qty" },
            {
              ...baseColumn,
              column: "user_id",
              datatype: "string",
              name: "user_id",
            },
            {
              ...baseColumn,
              column: "anonymous_id",
              datatype: "string",
              name: "anonymous_id",
            },
            {
              ...baseColumn,
              column: "timestamp",
              datatype: "date",
              name: "timestamp",
            },
            {
              ...baseColumn,
              column: "revenue_vc",
              datatype: "number",
              name: "revenue_vc",
              isVirtual: true,
              sql: "amount * qty",
            },
          ],
        },
      ],
    ]);

    // Unique users, filtered on an aggregate of a virtual column.
    const aggregateFilterMetricMap = new Map<string, FactMetricInterface>([
      [
        "big_spenders",
        {
          id: "big_spenders",
          name: "Big Spenders",
          metricType: "proportion",
          numerator: {
            factTableId: "orders",
            column: "$$distinctUsers",
            aggregation: "sum",
            aggregateFilter: ">= 100",
            aggregateFilterColumn: "revenue_vc",
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
        { dimensionType: "date", column: null, dateGranularity: "day" },
      ],
      dataset: {
        type: "metric",
        values: [
          {
            name: "Big Spenders",
            type: "metric",
            metricId: "big_spenders",
            rowFilters: [],
            unit: null,
            denominatorUnit: null,
          },
        ],
      },
    };

    const { sql } = generateProductAnalyticsSQL(
      config,
      virtualFactTableMap,
      aggregateFilterMetricMap,
      helpers,
      datasource,
    );

    // The aggregate filter column goes through the same expansion as a value
    // column — a bare `revenue_vc` does not exist in the warehouse.
    expect(sql).toContain("(amount * qty)");
    expect(sql).not.toContain("revenue_vc");
  });

  it("throws when a data_source dataset has no timestamp column", () => {
    const config: ExplorationConfig = {
      type: "data_source",
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
      dimensions: [],
      dataset: {
        type: "data_source",
        table: "orders",
        path: "orders",
        timestampColumn: "",
        columnTypes: { id: "string" },
        values: [
          {
            name: "count",
            type: "data_source",
            rowFilters: [],
            valueType: "count",
            unit: null,
            valueColumn: null,
          },
        ],
      },
    };

    expect(() =>
      generateProductAnalyticsSQL(
        config,
        factTableMap,
        metricMap,
        helpers,
        datasource,
      ),
    ).toThrow("Timestamp column is required");
  });
});
