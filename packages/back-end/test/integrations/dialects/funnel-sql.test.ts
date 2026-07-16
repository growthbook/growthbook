import type { SqlDialect } from "shared/types/sql";
import { buildFunnelSql } from "shared/enterprise";
import { ExplorationConfig } from "shared/validators";
import { FactTableInterface } from "shared/types/fact-table";
import { postgresDialect } from "back-end/src/integrations/dialects/postgres";
import { clickHouseDialect } from "back-end/src/integrations/dialects/clickhouse";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { snowflakeDialect } from "back-end/src/integrations/dialects/snowflake";
import { athenaDialect } from "back-end/src/integrations/dialects/athena";
import { prestoDialect } from "back-end/src/integrations/dialects/presto";
import { databricksDialect } from "back-end/src/integrations/dialects/databricks";
import { mysqlDialect } from "back-end/src/integrations/dialects/mysql";
import { redshiftDialect } from "back-end/src/integrations/dialects/redshift";
import { baseDialect } from "back-end/src/integrations/dialects/base";
import { mssqlDialect } from "back-end/src/integrations/dialects/mssql";
import { verticaDialect } from "back-end/src/integrations/dialects/vertica";

// The funnel SQL depends on two dialect helpers beyond the array helpers:
// `dateDiffMs` (emitted on every 2+ step funnel for time-from-previous stats)
// and `addIntervalSeconds` (conversion/concurrency window bounds). These were
// dialect-specific, so the base implementations throw and every concrete
// dialect emits its native syntax.
describe("SqlDialect funnel time helpers", () => {
  it("throws when a dialect does not implement time helpers", () => {
    expect(() => baseDialect.dateDiffMs("a", "b")).toThrow(
      "Millisecond date differences are not supported by this data source.",
    );
    expect(() => baseDialect.addIntervalSeconds("c", "+", 30)).toThrow(
      "Adding timestamp intervals is not supported by this data source.",
    );
  });

  const dateDiffMsCases: [string, Pick<SqlDialect, "dateDiffMs">, string][] = [
    ["postgres", postgresDialect, "(EXTRACT(EPOCH FROM (b - a)) * 1000)"],
    ["redshift", redshiftDialect, "DATEDIFF(millisecond, a, b)"],
    ["mssql", mssqlDialect, "DATEDIFF_BIG(millisecond, a, b)"],
    ["vertica", verticaDialect, "TIMESTAMPDIFF(millisecond, a, b)"],
    ["clickhouse", clickHouseDialect, "dateDiff('millisecond', a, b)"],
    [
      "bigquery",
      bigQueryDialect,
      "CAST(DATETIME_DIFF(b, a, MILLISECOND) AS FLOAT64)",
    ],
    ["snowflake", snowflakeDialect, "DATEDIFF(millisecond, a, b)"],
    ["athena (trino)", athenaDialect, "date_diff('millisecond', a, b)"],
    ["presto (trino)", prestoDialect, "date_diff('millisecond', a, b)"],
    [
      "databricks (spark)",
      databricksDialect,
      "(unix_millis(b) - unix_millis(a))",
    ],
    ["mysql", mysqlDialect, "(TIMESTAMPDIFF(MICROSECOND, a, b) / 1000)"],
  ];
  it.each(dateDiffMsCases)("dateDiffMs — %s", (_name, dialect, expected) => {
    expect(dialect.dateDiffMs("a", "b")).toBe(expected);
  });

  const addIntervalSecondsCases: [
    string,
    Pick<SqlDialect, "addIntervalSeconds">,
    string,
    string,
  ][] = [
    [
      "postgres",
      postgresDialect,
      "c + INTERVAL '30 seconds'",
      "c - INTERVAL '5 seconds'",
    ],
    [
      "redshift",
      redshiftDialect,
      "DATEADD(second, 30, c)",
      "DATEADD(second, -5, c)",
    ],
    ["mssql", mssqlDialect, "DATEADD(second, 30, c)", "DATEADD(second, -5, c)"],
    [
      "vertica",
      verticaDialect,
      "TIMESTAMPADD(second, 30, c)",
      "TIMESTAMPADD(second, -5, c)",
    ],
    [
      "clickhouse",
      clickHouseDialect,
      "dateAdd(second, 30, c)",
      "dateSub(second, 5, c)",
    ],
    [
      "bigquery",
      bigQueryDialect,
      "DATETIME_ADD(c, INTERVAL 30 SECOND)",
      "DATETIME_SUB(c, INTERVAL 5 SECOND)",
    ],
    [
      "snowflake",
      snowflakeDialect,
      "DATEADD(second, 30, c)",
      "DATEADD(second, -5, c)",
    ],
    [
      "athena (trino)",
      athenaDialect,
      "date_add('second', 30, c)",
      "date_add('second', -5, c)",
    ],
    [
      "presto (trino)",
      prestoDialect,
      "date_add('second', 30, c)",
      "date_add('second', -5, c)",
    ],
    [
      "databricks (spark)",
      databricksDialect,
      "timestampadd(SECOND, 30, c)",
      "timestampadd(SECOND, -5, c)",
    ],
    [
      "mysql",
      mysqlDialect,
      "DATE_ADD(c, INTERVAL 30 SECOND)",
      "DATE_SUB(c, INTERVAL 5 SECOND)",
    ],
  ];
  it.each(addIntervalSecondsCases)(
    "addIntervalSeconds — %s",
    (_name, dialect, plus, minus) => {
      expect(dialect.addIntervalSeconds("c", "+", 30)).toBe(plus);
      expect(dialect.addIntervalSeconds("c", "-", 5)).toBe(minus);
    },
  );
});

describe("SqlDialect funnel array helpers", () => {
  it("throws when a dialect does not implement array operations", () => {
    expect(() => baseDialect.arrayAggSorted("value")).toThrow(
      "Array aggregation is not supported by this data source.",
    );
    expect(() => baseDialect.argMinByTimestamp("value", "timestamp")).toThrow(
      "Finding a value at the minimum timestamp is not supported by this data source.",
    );
    expect(() => baseDialect.arrayMinInRange("values", null, null)).toThrow(
      "Finding a minimum array value is not supported by this data source.",
    );
  });

  it("keeps Postgres-style array SQL in the Postgres dialect", () => {
    expect(postgresDialect.arrayAggSorted("value")).toBe(
      "ARRAY_AGG(value ORDER BY value) FILTER (WHERE value IS NOT NULL)",
    );
    expect(postgresDialect.argMinByTimestamp("value", "timestamp")).toBe(
      "(ARRAY_AGG(value ORDER BY timestamp) FILTER (WHERE timestamp IS NOT NULL))[1]",
    );
    expect(postgresDialect.arrayMinInRange("values", "lower", "upper")).toBe(
      "(SELECT MIN(t) FROM unnest(values) AS t WHERE t >= lower AND t <= upper)",
    );
  });

  it("uses Redshift SUPER array SQL", () => {
    expect(redshiftDialect.arrayAggSorted("value")).toContain(
      "SPLIT_TO_ARRAY(LISTAGG(",
    );
    expect(redshiftDialect.argMinByTimestamp("value", "timestamp")).toContain(
      "SPLIT_PART(MIN(",
    );
    expect(redshiftDialect.arrayMinInRange("values", "lower", "upper")).toBe(
      "(SELECT MIN(t::timestamp) FROM values AS t WHERE t::timestamp >= lower AND t::timestamp <= upper)",
    );
  });

  it("rejects MySQL array aggregation", () => {
    expect(mysqlDialect.castToTimestamp("value")).toBe(
      "CAST(value AS DATETIME)",
    );
    expect(() => mysqlDialect.arrayAggSorted("value")).toThrow(
      "Array aggregation is not supported by this data source.",
    );
    expect(mysqlDialect.argMinByTimestamp("value", "timestamp")).toContain(
      "GROUP_CONCAT(IF(timestamp IS NULL",
    );
    expect(mysqlDialect.arrayMinInRange("values", "lower", "upper")).toBe(
      "(SELECT MIN(t.value) FROM JSON_TABLE(values, '$[*]' COLUMNS (value DATETIME(6) PATH '$')) AS t WHERE t.value >= lower AND t.value <= upper)",
    );
  });
});

// End-to-end guard for the launch subset (D-PA2: postgres + clickhouse):
// buildFunnelSql through the REAL dialect objects must emit each engine's
// native helpers and never leak the other's. Complements the shared
// sql.funnel.test.ts (which uses a single Postgres-flavored mock).
const col = (name: string, datatype: string) => ({
  column: name,
  datatype,
  dateCreated: new Date(),
  dateUpdated: new Date(),
  name,
  description: "",
  numberFormat: "",
  alwaysInlineFilter: false,
  deleted: false,
  autoSlices: [],
  isAutoSliceColumn: false,
});

const ordersFactTable: FactTableInterface = {
  id: "orders",
  organization: "org_1",
  name: "Orders",
  datasource: "ds_1",
  sql: "SELECT user_id, timestamp, country, event_name, revenue FROM orders",
  userIdTypes: ["user_id"],
  dateCreated: new Date(),
  dateUpdated: new Date(),
  description: "",
  eventName: "",
  owner: "",
  projects: [],
  tags: [],
  filters: [],
  columns: [
    col("user_id", "string"),
    col("timestamp", "date"),
    col("country", "string"),
    col("event_name", "string"),
    col("revenue", "number"),
  ],
};

const factTableMap = new Map<string, FactTableInterface>([
  ["orders", ordersFactTable],
]);

// 3-step funnel + 30-min conversion window on step 2 + 5s concurrency
// tolerance + first-touch country breakdown — exercises every
// dialect-sensitive helper in one query.
const config: ExplorationConfig = {
  type: "funnel",
  datasource: "ds_1",
  chartType: "bar",
  dateRange: {
    predefined: "last30Days",
    startDate: null,
    endDate: null,
    lookbackValue: null,
    lookbackUnit: null,
  },
  dimensions: [{ dimensionType: "dynamic", column: "country", maxValues: 5 }],
  dataset: {
    type: "funnel",
    unit: "user_id",
    concurrencyWindowSeconds: 5,
    steps: [
      {
        name: "View",
        factTable: "orders",
        rowFilters: [{ operator: "=", column: "event_name", values: ["view"] }],
        optional: false,
        conversionWindow: undefined,
      },
      {
        name: "Add to cart",
        factTable: "orders",
        rowFilters: [
          { operator: "=", column: "event_name", values: ["add_to_cart"] },
        ],
        optional: false,
        conversionWindow: { unit: "minutes", value: 30 },
      },
      {
        name: "Purchase",
        factTable: "orders",
        rowFilters: [
          { operator: "=", column: "event_name", values: ["purchase"] },
        ],
        optional: false,
        conversionWindow: undefined,
      },
    ],
  },
} as unknown as ExplorationConfig;

describe("buildFunnelSql — launch subset (real dialects)", () => {
  it("Postgres emits Postgres-native helpers, not ClickHouse forms", () => {
    const { sql, stepCount } = buildFunnelSql(
      config,
      factTableMap,
      postgresDialect,
    );
    expect(stepCount).toBe(3);
    expect(sql).toMatch(/EXTRACT\(\s*EPOCH/i);
    expect(sql).toContain("INTERVAL '1800 seconds'");
    expect(sql).toContain("INTERVAL '5 seconds'");
    expect(sql).toMatch(/ARRAY_AGG\(/i);
    expect(sql).toMatch(/unnest\(/i);
    expect(sql).toContain("::float");
    expect(sql).not.toMatch(/dateDiff\s*\(/);
    expect(sql).not.toMatch(/groupArrayIf/);
    expect(sql).not.toMatch(/toFloat64/);
    expect(sql).not.toMatch(/argMinIf/);
  });

  it("ClickHouse emits ClickHouse-native helpers, not Postgres forms", () => {
    const { sql, stepCount } = buildFunnelSql(
      config,
      factTableMap,
      clickHouseDialect,
    );
    expect(stepCount).toBe(3);
    expect(sql).toMatch(/dateDiff\s*\(/);
    expect(sql).toContain("'millisecond'");
    expect(sql).toMatch(/dateAdd\s*\(\s*second/);
    expect(sql).toMatch(/dateSub\s*\(\s*second/);
    expect(sql).toMatch(/arraySort\(groupArrayIf/);
    expect(sql).toMatch(/arrayFilter\(/);
    expect(sql).toMatch(/arrayMin\(/);
    expect(sql).toMatch(/argMinIf\s*\(/);
    expect(sql).toMatch(/toFloat64\(/);
    expect(sql).not.toMatch(/EXTRACT\(\s*EPOCH/i);
    expect(sql).not.toContain("INTERVAL '");
    expect(sql).not.toContain("::float");
  });

  it("MySQL rejects funnel SQL until array aggregation is supported", () => {
    expect(() => buildFunnelSql(config, factTableMap, mysqlDialect)).toThrow(
      "Array aggregation is not supported by this data source.",
    );
  });

  it("Snowflake resolves steps without a correlated FLATTEN subquery", () => {
    const { sql, stepCount } = buildFunnelSql(
      config,
      factTableMap,
      snowflakeDialect,
    );
    expect(stepCount).toBe(3);
    // Step resolution must use higher-order array functions, not a correlated
    // scalar subquery over TABLE(FLATTEN(...)) — Snowflake errors on the latter
    // with "Unsupported subquery type cannot be evaluated".
    expect(sql).toMatch(/GET\s*\(\s*FILTER\(/);
    expect(sql).not.toMatch(/FROM\s+TABLE\s*\(\s*FLATTEN/i);
    // Native Snowflake helpers still present.
    expect(sql).toMatch(/MIN_BY\s*\(/);
    expect(sql).toMatch(/DATEDIFF\s*\(\s*millisecond/i);
    expect(sql).toMatch(/DATEADD\s*\(\s*second/i);
  });

  it("BigQuery computes time-from-previous stats in FLOAT64", () => {
    const { sql, stepCount } = buildFunnelSql(
      config,
      factTableMap,
      bigQueryDialect,
    );
    expect(stepCount).toBe(3);
    expect(sql).toMatch(
      /CAST\s*\(\s*DATETIME_DIFF\([^)]*MILLISECOND\s*\)\s*AS FLOAT64\s*\)/,
    );
    expect(sql).toMatch(/AS FLOAT64\s*\)\s*\*\s*CAST\s*\(\s*DATETIME_DIFF/);
    // First-touch dimension uses ANY_VALUE(... HAVING MIN ...). `IGNORE NULLS`
    // is invalid in this form (it IS valid on ARRAY_AGG, so only guard the
    // HAVING MIN clause).
    expect(sql).toMatch(
      /ANY_VALUE\s*\(\s*dimension_1\s+HAVING\s+MIN\s+step1_ts/i,
    );
    expect(sql).not.toMatch(/HAVING\s+MIN\s+step1_ts\s+IGNORE\s+NULLS/i);
  });

  it("multi-fact-table funnel with a breakdown types the dimension NULL for the UNION", () => {
    // Two fact tables → UNION ALL of the per-table events CTEs. With a
    // breakdown dimension, the non-initial fact table must emit a typed NULL
    // (CAST(NULL AS STRING)) for dimension_1, not a bare NULL — otherwise
    // BigQuery/Trino reject the UNION with "incompatible types: STRING, INT64".
    const twoFactMap = new Map<string, FactTableInterface>([
      ["orders", ordersFactTable],
      ["visits", { ...ordersFactTable, id: "visits", name: "Visits" }],
    ]);
    const multiFactConfig = {
      ...config,
      dataset: {
        type: "funnel",
        unit: "user_id",
        steps: [
          {
            name: "View",
            factTable: "visits",
            rowFilters: [],
            optional: false,
            conversionWindow: undefined,
          },
          {
            name: "Purchase",
            factTable: "orders",
            rowFilters: [],
            optional: false,
            conversionWindow: undefined,
          },
        ],
      },
    } as unknown as ExplorationConfig;

    const { sql } = buildFunnelSql(
      multiFactConfig,
      twoFactMap,
      bigQueryDialect,
    );
    expect(sql).toMatch(/UNION ALL/i);
    // No bare untyped NULL for the dimension on any fact table.
    expect(sql).not.toMatch(/(?<!AS\s)\bNULL AS dimension_1/);
    // The placeholder is a typed string NULL.
    expect(sql).toMatch(/cast\(\s*NULL as string\s*\)\s*AS dimension_1/i);
  });
});
