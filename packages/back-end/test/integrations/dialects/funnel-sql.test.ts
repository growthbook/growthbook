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

// The funnel SQL depends on two dialect helpers beyond the array helpers:
// `dateDiffMs` (emitted on every 2+ step funnel for time-from-previous stats)
// and `addIntervalSeconds` (conversion/concurrency window bounds). These were
// only correct for Postgres + ClickHouse until per-dialect overrides were
// added; the Postgres-flavored base versions are invalid on the other
// engines. These table-driven cases assert each dialect emits its native
// syntax (mirrors integrations/dialects/array-element.test.ts).
describe("SqlDialect funnel time helpers", () => {
  const dateDiffMsCases: [string, Pick<SqlDialect, "dateDiffMs">, string][] = [
    [
      "postgres (base)",
      postgresDialect,
      "(EXTRACT(EPOCH FROM (b - a)) * 1000)",
    ],
    ["clickhouse", clickHouseDialect, "dateDiff('millisecond', a, b)"],
    ["bigquery", bigQueryDialect, "DATETIME_DIFF(b, a, MILLISECOND)"],
    ["snowflake", snowflakeDialect, "DATEDIFF(millisecond, a, b)"],
    ["athena (trino)", athenaDialect, "date_diff('millisecond', a, b)"],
    ["presto (trino)", prestoDialect, "date_diff('millisecond', a, b)"],
    [
      "databricks (spark)",
      databricksDialect,
      "(unix_millis(b) - unix_millis(a))",
    ],
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
      "postgres (base)",
      postgresDialect,
      "c + INTERVAL '30 seconds'",
      "c - INTERVAL '5 seconds'",
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
  ];
  it.each(addIntervalSecondsCases)(
    "addIntervalSeconds — %s",
    (_name, dialect, plus, minus) => {
      expect(dialect.addIntervalSeconds("c", "+", 30)).toBe(plus);
      expect(dialect.addIntervalSeconds("c", "-", 5)).toBe(minus);
    },
  );
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

  it("BigQuery computes time-from-previous stats in FLOAT64 (no INT64 overflow)", () => {
    const { sql, stepCount } = buildFunnelSql(
      config,
      factTableMap,
      bigQueryDialect,
    );
    expect(stepCount).toBe(3);
    // The ms diff must be cast to FLOAT64 before it's squared/summed, so the
    // sum-of-squares aggregation doesn't overflow INT64.
    expect(sql).toMatch(
      /CAST\s*\(\s*DATETIME_DIFF\([^)]*MILLISECOND\s*\)\s*AS FLOAT64\s*\)/,
    );
    // The squared term multiplies two FLOAT64-cast diffs (float arithmetic).
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
