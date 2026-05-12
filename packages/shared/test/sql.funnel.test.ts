import { buildFunnelSql, transformFunnelRowsToResult } from "shared/enterprise";
import { ExplorationConfig } from "shared/validators";
import { SqlDialect } from "shared/types/sql";
import { FactTableInterface } from "shared/types/fact-table";

// Compact dialect tuned for funnel SQL tests. Mirrors the minimal helpers
// used by the metric/fact-table SQL tests; only includes the dialect
// methods buildFunnelSql actually exercises.
const helpers: SqlDialect = {
  escapeStringLiteral: (value) => value.replace(/'/g, `''`),
  jsonExtract: (jsonCol, path, isNumeric) =>
    `${jsonCol}:'${path}'::${isNumeric ? "float" : "text"}`,
  evalBoolean: (col, value) => `${col} IS ${value ? "TRUE" : "FALSE"}`,
  dateTrunc: (col, granularity) => `date_trunc('${granularity}', ${col})`,
  dateDiff: (a, b) => `datediff(day, ${a}, ${b})`,
  dateDiffMs: (a, b) => `(EXTRACT(EPOCH FROM (${b} - ${a})) * 1000)`,
  addIntervalSeconds: (col, sign, amount) =>
    `${col} ${sign} INTERVAL '${amount} seconds'`,
  percentileApprox: (col, q) => `APPROX_PERCENTILE(${col}, ${q})`,
  // Deterministic timestamp formatting (date only) so snapshots don't
  // change when the wall clock advances during the test suite.
  toTimestamp: (d) => `'${d.toISOString().substring(0, 10)} 00:00:00'`,
  castToFloat: (col) => `CAST(${col} AS FLOAT)`,
  castToString: (col) => `cast(${col} as varchar)`,
  castToDate: (col) => `CAST(${col} AS DATE)`,
  castToTimestamp: (col) => `CAST(${col} AS TIMESTAMP)`,
  castUserDateCol: (col) => col,
  getCurrentTimestamp: () => `CURRENT_TIMESTAMP`,
  ifElse: (c, t, f) => `(CASE WHEN ${c} THEN ${t} ELSE ${f} END)`,
  getDataType: () => "VARCHAR",
  addTime: (col, unit, sign, amount) =>
    `${col} ${sign} INTERVAL '${amount} ${unit}s'`,
  formatDate: (col) => col,
  formatDateTimeString: (col) => col,
  selectStarLimit: (from, limit) => `SELECT * FROM ${from} LIMIT ${limit}`,
  defaultSchema: "",
  // Skip sql-formatter so test snapshots stay stable across formatter upgrades.
  formatDialect: "",
  percentileCapSelectClause: () => "",
  hasCountDistinctHLL: () => false,
  hllAggregate: () => "",
  hllReaggregate: () => "",
  hllCardinality: () => "",
  kllInit: () => "",
  kllMergePartial: () => "",
  kllExtractPoint: () => "",
  kllExtractQuantiles: () => "",
  kllRankApprox: () => "",
};

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
  columns: ["user_id", "timestamp", "country", "event_name", "revenue"].map(
    (col) => ({
      column: col,
      datatype:
        col === "revenue" ? "number" : col === "timestamp" ? "date" : "string",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      name: col,
      description: "",
      numberFormat: col === "revenue" ? "currency" : "",
      alwaysInlineFilter: false,
      deleted: false,
      autoSlices: [],
      isAutoSliceColumn: false,
    }),
  ),
};

const visitsFactTable: FactTableInterface = {
  ...ordersFactTable,
  id: "visits",
  name: "Visits",
  sql: "SELECT user_id, timestamp, page FROM visits",
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
    {
      column: "page",
      datatype: "string",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      name: "page",
      description: "",
      numberFormat: "",
      alwaysInlineFilter: false,
      deleted: false,
      autoSlices: [],
      isAutoSliceColumn: false,
    },
  ],
};

const factTableMap = new Map<string, FactTableInterface>([
  ["orders", ordersFactTable],
  ["visits", visitsFactTable],
]);

function baseFunnelConfig(
  steps: { name: string; factTable: string; rowFilters?: never[] }[],
  overrides: Partial<ExplorationConfig> = {},
): ExplorationConfig {
  return {
    type: "funnel",
    datasource: "ds_1",
    chartType: "bar",
    dateRange: {
      predefined: "last7Days",
      startDate: null,
      endDate: null,
      lookbackValue: null,
      lookbackUnit: null,
    },
    dimensions: [],
    dataset: {
      type: "funnel",
      unit: "user_id",
      steps: steps.map((s) => ({
        name: s.name,
        factTable: s.factTable,
        rowFilters: s.rowFilters ?? [],
        optional: false,
        conversionWindow: undefined,
      })),
    },
    ...overrides,
  } as ExplorationConfig;
}

describe("buildFunnelSql", () => {
  it("emits one raw CTE per fact table and chains step resolutions", () => {
    const config = baseFunnelConfig([
      { name: "Step 1", factTable: "orders" },
      { name: "Step 2", factTable: "orders" },
      { name: "Step 3", factTable: "orders" },
    ]);

    const { sql, stepCount } = buildFunnelSql(config, factTableMap, helpers);
    expect(stepCount).toBe(3);
    expect(sql).toContain("__funnel_ft0_raw");
    expect(sql).toContain("__funnel_ft0_events");
    // Single-fact-table funnels skip the UNION wrapper.
    expect(sql).not.toContain("__funnel_events");
    // ROW_NUMBER captures the first-touch event for step 1.
    expect(sql).toContain("ROW_NUMBER() OVER (PARTITION BY user_id");
    expect(sql).toContain("__funnel_resolved_step1");
    expect(sql).toContain("__funnel_resolved_step2");
    expect(sql).toContain("__funnel_resolved_step3");
    // Per-step counts and time-from-previous stats are emitted at the end.
    expect(sql).toContain("AS step1_count");
    expect(sql).toContain("AS step2_count");
    expect(sql).toContain("AS step2_tfp_sum_ms");
    expect(sql).toContain("AS step2_tfp_sum_sq_ms");
    // No step1 timing column — first step has nothing to measure from.
    expect(sql).not.toContain("step1_tfp_sum_ms");
  });

  it("emits a UNION ALL events CTE when steps span multiple fact tables", () => {
    const config = baseFunnelConfig([
      { name: "Visit", factTable: "visits" },
      { name: "Purchase", factTable: "orders" },
    ]);
    const { sql } = buildFunnelSql(config, factTableMap, helpers);
    expect(sql).toContain("__funnel_ft0_raw");
    expect(sql).toContain("__funnel_ft1_raw");
    expect(sql).toContain("__funnel_events");
    expect(sql).toContain("UNION ALL");
    // The "this fact table doesn't source step N" placeholder must carry a
    // concrete TIMESTAMP type — bare NULLs are inferred as `text` in
    // Postgres and break the UNION (mismatched column types).
    expect(sql).toContain("CAST(NULL AS TIMESTAMP) AS step1_ts");
    expect(sql).toContain("CAST(NULL AS TIMESTAMP) AS step2_ts");
    expect(sql).not.toMatch(/[^S]NULL AS step\d+_ts/);
  });

  it("applies the conversion window upper bound on follow-on steps", () => {
    const config = baseFunnelConfig([
      { name: "Step 1", factTable: "orders" },
      { name: "Step 2", factTable: "orders" },
    ]);
    if (config.dataset.type !== "funnel") throw new Error("never");
    config.dataset.steps[1].conversionWindow = { unit: "minutes", value: 30 };

    const { sql } = buildFunnelSql(config, factTableMap, helpers);
    // 30 minutes = 1800 seconds in the emitted INTERVAL expression.
    expect(sql).toContain("INTERVAL '1800 seconds'");
  });

  it("expands the concurrency window into the lower bound on every follow-on step", () => {
    const config = baseFunnelConfig([
      { name: "Step 1", factTable: "orders" },
      { name: "Step 2", factTable: "orders" },
    ]);
    if (config.dataset.type !== "funnel") throw new Error("never");
    config.dataset.concurrencyWindowSeconds = 5;
    const { sql } = buildFunnelSql(config, factTableMap, helpers);
    expect(sql).toContain("INTERVAL '5 seconds'");
    // The lower-bound subtraction is applied.
    expect(sql).toMatch(/step\d+_resolved_ts - INTERVAL '5 seconds'/);
  });

  it("chains COALESCE through optional skipped steps", () => {
    const config = baseFunnelConfig([
      { name: "Step 1", factTable: "orders" },
      { name: "Step 2", factTable: "orders" },
      { name: "Step 3", factTable: "orders" },
    ]);
    if (config.dataset.type !== "funnel") throw new Error("never");
    config.dataset.steps[1].optional = true;

    const { sql } = buildFunnelSql(config, factTableMap, helpers);
    // Step 3's previous-resolved expression should fall through step 2
    // (optional) to step 1 via COALESCE.
    expect(sql).toMatch(
      /COALESCE\(r\.step2_resolved_ts, r\.step1_resolved_ts\)/,
    );
  });

  it("rejects funnels without a unit", () => {
    const config = baseFunnelConfig([
      { name: "Step 1", factTable: "orders" },
      { name: "Step 2", factTable: "orders" },
    ]);
    if (config.dataset.type !== "funnel") throw new Error("never");
    config.dataset.unit = null;
    expect(() => buildFunnelSql(config, factTableMap, helpers)).toThrow(
      /Funnel unit is required/,
    );
  });

  it("rejects funnels whose unit isn't a userIdType on every step's fact table", () => {
    const config = baseFunnelConfig([
      { name: "Step 1", factTable: "orders" },
      { name: "Step 2", factTable: "visits" },
    ]);
    if (config.dataset.type !== "funnel") throw new Error("never");
    config.dataset.unit = "anonymous_id";
    // visits doesn't expose anonymous_id as a userIdType.
    expect(() => buildFunnelSql(config, factTableMap, helpers)).toThrow(
      /not a userIdType/,
    );
  });

  it("rejects single-step funnels", () => {
    const config = baseFunnelConfig([
      { name: "Only step", factTable: "orders" },
    ]);
    expect(() => buildFunnelSql(config, factTableMap, helpers)).toThrow(
      /at least 2 steps/,
    );
  });
});

describe("transformFunnelRowsToResult", () => {
  it("returns one result row per warehouse row with per-step counts and timings", () => {
    const config = baseFunnelConfig([
      { name: "Step 1", factTable: "orders" },
      { name: "Step 2", factTable: "orders" },
      { name: "Step 3", factTable: "orders" },
    ]);
    const rows = [
      {
        step1_count: 100,
        step2_count: 70,
        step2_tfp_sum_ms: 7000,
        step2_tfp_sum_sq_ms: 490_000,
        step3_count: 35,
        step3_tfp_sum_ms: 17500,
        step3_tfp_sum_sq_ms: 8_750_000,
      },
    ];
    const result = transformFunnelRowsToResult(config, rows);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].dimensions).toEqual([]);
    expect(result.rows[0].steps).toEqual([
      { count: 100, timeFromPrevSumMs: null, timeFromPrevSumSquaresMs: null },
      { count: 70, timeFromPrevSumMs: 7000, timeFromPrevSumSquaresMs: 490_000 },
      {
        count: 35,
        timeFromPrevSumMs: 17500,
        timeFromPrevSumSquaresMs: 8_750_000,
      },
    ]);
  });

  it("attaches the dimension when one is configured", () => {
    const config = baseFunnelConfig(
      [
        { name: "Step 1", factTable: "orders" },
        { name: "Step 2", factTable: "orders" },
      ],
      {
        dimensions: [
          {
            dimensionType: "dynamic",
            column: "country",
            maxValues: 5,
          },
        ],
      },
    );
    const rows = [
      {
        dimension_1: "US",
        step1_count: 50,
        step2_count: 20,
        step2_tfp_sum_ms: 4000,
        step2_tfp_sum_sq_ms: 800_000,
      },
    ];
    const result = transformFunnelRowsToResult(config, rows);
    expect(result.rows[0].dimensions).toEqual(["US"]);
    expect(result.rows[0].steps?.[1].count).toBe(20);
  });
});
