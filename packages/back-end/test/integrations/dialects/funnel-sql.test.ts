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
});
