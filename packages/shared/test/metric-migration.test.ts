import { MetricInterface } from "shared/types/metric";
import { migrateMetrics, MigrationOptions } from "../src/metric-migration";

const NOW = new Date("2024-01-01T00:00:00Z");

function makeOptions(): MigrationOptions {
  return {
    now: NOW,
  };
}

function makeMetric(overrides: Partial<MetricInterface>): MetricInterface {
  return {
    id: "m1",
    organization: "org_1",
    owner: "owner1",
    datasource: "ds_1",
    dateCreated: null,
    dateUpdated: null,
    name: "Test Metric",
    description: "A test metric",
    type: "binomial",
    inverse: false,
    ignoreNulls: false,
    cappingSettings: { type: "", value: 0 },
    windowSettings: {
      type: "",
      delayValue: 0,
      delayUnit: "hours",
      windowValue: 72,
      windowUnit: "hours",
    },
    priorSettings: { override: false, proper: false, mean: 0, stddev: 0 },
    queries: [],
    runStarted: null,
    tags: [],
    projects: [],
    userIdTypes: ["user_id"],
    sql: `SELECT user_id AS user_id, created_at AS timestamp FROM events`,
    ...overrides,
  };
}

// ─── 1. Single binomial → 1 fact table + 1 proportion metric ────────────────

describe("Single binomial metric", () => {
  it("produces 1 fact table and 1 proportion metric", () => {
    const m = makeMetric({
      type: "binomial",
      sql: "SELECT user_id AS user_id, created_at AS timestamp FROM events",
    });
    const result = migrateMetrics([m], makeOptions());

    expect(result.unconverted).toHaveLength(0);
    expect(result.factTables).toHaveLength(1);
    expect(result.factMetrics).toHaveLength(1);

    const ft = result.factTables[0];
    expect(ft.id).toBe("ft_m1");
    expect(ft.name).toBe("events");
    expect(ft.datasource).toBe("ds_1");
    expect(ft.userIdTypes).toEqual(["user_id"]);
    expect(ft.columns).toHaveLength(2); // user_id, timestamp
    expect(ft.columns[0].datatype).toBe("string");
    expect(ft.columns[1].datatype).toBe("date");

    const fm = result.factMetrics[0];
    expect(fm.id).toBe("fact__m1");
    expect(fm.metricType).toBe("proportion");
    expect(fm.numerator.column).toBe("$$distinctUsers");
    expect(fm.numerator.factTableId).toBe("ft_m1");
    expect(fm.denominator).toBeNull();
  });
});

// ─── 2. Single count/duration/revenue → mean metrics ────────────────────────

describe("Non-binomial metric types", () => {
  it("converts count metric with hardcoded 1 to $$count", () => {
    const m = makeMetric({
      type: "count",
      sql: "SELECT user_id AS user_id, created_at AS timestamp, 1 AS value FROM events",
    });
    const result = migrateMetrics([m], makeOptions());

    expect(result.factMetrics).toHaveLength(1);
    expect(result.factMetrics[0].metricType).toBe("mean");
    expect(result.factMetrics[0].numerator.column).toBe("$$count");
    expect(result.factMetrics[0].numerator.aggregation).toBe("sum");

    // 1 AS value should be removed from the fact table SQL
    const ft = result.factTables[0];
    expect(ft.sql).not.toContain("1 AS value");
    expect(ft.columns.find((c) => c.column === "value")).toBeUndefined();
  });

  it("converts duration metric to mean with time:seconds format", () => {
    const m = makeMetric({
      type: "duration",
      sql: "SELECT user_id AS user_id, created_at AS timestamp, duration_s AS value FROM events",
    });
    const result = migrateMetrics([m], makeOptions());

    expect(result.factMetrics[0].metricType).toBe("mean");
    const valCol = result.factTables[0].columns.find(
      (c) => c.column === "value",
    );
    expect(valCol?.numberFormat).toBe("time:seconds");
  });

  it("converts revenue metric to mean with currency format", () => {
    const m = makeMetric({
      type: "revenue",
      sql: "SELECT user_id AS user_id, created_at AS timestamp, amount AS value FROM purchases",
    });
    const result = migrateMetrics([m], makeOptions());

    expect(result.factMetrics[0].metricType).toBe("mean");
    const valCol = result.factTables[0].columns.find(
      (c) => c.column === "value",
    );
    expect(valCol?.numberFormat).toBe("currency");
  });
});

// ─── 3. Two metrics, same FROM/JOINs → 1 shared fact table ─────────────────

describe("Shared fact table", () => {
  it("merges two metrics with same FROM into one fact table", () => {
    const m1 = makeMetric({
      id: "m1",
      name: "Metric 1",
      type: "count",
      sql: "SELECT user_id AS user_id, ts AS timestamp, clicks AS value FROM events",
    });
    const m2 = makeMetric({
      id: "m2",
      name: "Metric 2",
      type: "revenue",
      sql: "SELECT user_id AS user_id, ts AS timestamp, revenue AS value FROM events",
    });
    const result = migrateMetrics([m1, m2], makeOptions());

    expect(result.unconverted).toHaveLength(0);
    expect(result.factTables).toHaveLength(1);
    expect(result.factMetrics).toHaveLength(2);

    // Value columns should be renamed to value_0, value_1
    const ft = result.factTables[0];
    const valueColumns = ft.columns.filter((c) => c.column.startsWith("value"));
    expect(valueColumns).toHaveLength(2);
    expect(valueColumns[0].column).toBe("value_0");
    expect(valueColumns[1].column).toBe("value_1");

    expect(result.factMetrics[0].numerator.column).toBe("value_0");
    expect(result.factMetrics[1].numerator.column).toBe("value_1");
  });
});

// ─── 4. Two metrics, different FROM → 2 separate fact tables ────────────────

describe("Different FROM tables", () => {
  it("creates separate fact tables for different FROM clauses", () => {
    const m1 = makeMetric({
      id: "m1",
      name: "Metric 1",
      sql: "SELECT user_id AS user_id, ts AS timestamp FROM events",
    });
    const m2 = makeMetric({
      id: "m2",
      name: "Metric 2",
      sql: "SELECT user_id AS user_id, ts AS timestamp FROM purchases",
    });
    const result = migrateMetrics([m1, m2], makeOptions());

    expect(result.factTables).toHaveLength(2);
    expect(result.factTables[0].name).toBe("events");
    expect(result.factTables[1].name).toBe("purchases");
  });
});

// ─── 5. Different datasources → separate fact tables ────────────────────────

describe("Different datasources", () => {
  it("creates separate fact tables for different datasources", () => {
    const m1 = makeMetric({
      id: "m1",
      datasource: "ds_1",
      sql: "SELECT user_id AS user_id, ts AS timestamp FROM events",
    });
    const m2 = makeMetric({
      id: "m2",
      datasource: "ds_2",
      sql: "SELECT user_id AS user_id, ts AS timestamp FROM events",
    });
    const result = migrateMetrics([m1, m2], makeOptions());

    expect(result.factTables).toHaveLength(2);
  });
});

// ─── 6. Denominator metrics → unconverted ───────────────────────────────────

describe("Denominator (ratio) metrics", () => {
  it("marks metrics with denominator as unconverted", () => {
    const m = makeMetric({ denominator: "m_other" });
    const result = migrateMetrics([m], makeOptions());

    expect(result.unconverted).toHaveLength(1);
    expect(result.unconverted[0].reason).toBe(
      "Ratio metrics are not supported",
    );
    expect(result.factTables).toHaveLength(0);
    expect(result.factMetrics).toHaveLength(0);
  });
});

// ─── 7. Builder metric → 1 fact table + 1 metric ───────────────────────────

describe("Builder metrics", () => {
  it("converts builder metric without SQL parsing", () => {
    const m = makeMetric({
      queryFormat: "builder",
      table: "events",
      column: "amount",
      timestampColumn: "created_at",
      type: "revenue",
      sql: undefined,
      userIdTypes: ["user_id"],
      userIdColumns: { user_id: "u.id" },
      conditions: [{ column: "status", operator: "=", value: "active" }],
    });
    const result = migrateMetrics([m], makeOptions());

    expect(result.unconverted).toHaveLength(0);
    expect(result.factTables).toHaveLength(1);
    expect(result.factMetrics).toHaveLength(1);

    const ft = result.factTables[0];
    expect(ft.name).toBe("events");
    expect(ft.sql).toContain("events");
    expect(ft.sql).toContain("u.id AS user_id");
    expect(ft.sql).toContain("amount AS value");

    const fm = result.factMetrics[0];
    expect(fm.metricType).toBe("mean");
    expect(fm.numerator.column).toBe("value");
  });

  it("marks builder metric with missing table as unconverted", () => {
    const m = makeMetric({
      queryFormat: "builder",
      table: undefined,
      sql: undefined,
    });
    const result = migrateMetrics([m], makeOptions());

    expect(result.unconverted).toHaveLength(1);
    expect(result.unconverted[0].reason).toBe("Builder metric missing table");
  });
});

// ─── 8. Different WHERE clauses → sql_expr rowFilters ───────────────────────

describe("Different WHERE clauses", () => {
  it("uses rowFilters when metrics have different WHERE clauses", () => {
    const m1 = makeMetric({
      id: "m1",
      name: "Metric 1",
      type: "count",
      sql: "SELECT user_id AS user_id, ts AS timestamp, cnt AS value FROM events WHERE status = 'active'",
    });
    const m2 = makeMetric({
      id: "m2",
      name: "Metric 2",
      type: "count",
      sql: "SELECT user_id AS user_id, ts AS timestamp, cnt AS value FROM events WHERE status = 'completed'",
    });
    const result = migrateMetrics([m1, m2], makeOptions());

    expect(result.factTables).toHaveLength(1);
    // Fact table SQL should NOT have WHERE
    expect(result.factTables[0].sql).not.toContain("WHERE");

    // Each metric should have a rowFilter
    const fm1 = result.factMetrics[0];
    const fm2 = result.factMetrics[1];

    expect(fm1.numerator.rowFilters).toHaveLength(1);
    expect(fm1.numerator.rowFilters![0].operator).toBe("=");
    expect(fm1.numerator.rowFilters![0].column).toBe("status");
    expect(fm1.numerator.rowFilters![0].values).toEqual(["active"]);

    expect(fm2.numerator.rowFilters).toHaveLength(1);
    expect(fm2.numerator.rowFilters![0].operator).toBe("=");
    expect(fm2.numerator.rowFilters![0].column).toBe("status");
    expect(fm2.numerator.rowFilters![0].values).toEqual(["completed"]);
  });
});

// ─── 9. Same WHERE clause → shared WHERE on fact table ──────────────────────

describe("Same WHERE clauses", () => {
  it("elevates shared WHERE to fact table SQL", () => {
    const m1 = makeMetric({
      id: "m1",
      name: "Metric 1",
      type: "count",
      sql: "SELECT user_id AS user_id, ts AS timestamp, cnt AS value FROM events WHERE status = 'active'",
    });
    const m2 = makeMetric({
      id: "m2",
      name: "Metric 2",
      type: "revenue",
      sql: "SELECT user_id AS user_id, ts AS timestamp, revenue AS value FROM events WHERE status = 'active'",
    });
    const result = migrateMetrics([m1, m2], makeOptions());

    expect(result.factTables).toHaveLength(1);
    expect(result.factTables[0].sql).toContain("WHERE");
    expect(result.factTables[0].sql).toContain("status = 'active'");

    // Metrics should NOT have rowFilters
    expect(result.factMetrics[0].numerator.rowFilters).toBeUndefined();
    expect(result.factMetrics[1].numerator.rowFilters).toBeUndefined();
  });
});

// ─── 10. CTE / DISTINCT / LIMIT → unconverted; GROUP BY supported ───────────

describe("Unsupported SQL features", () => {
  it("marks CTE as unconverted", () => {
    const m = makeMetric({
      sql: "WITH cte AS (SELECT * FROM events) SELECT user_id AS user_id, ts AS timestamp FROM cte",
    });
    const result = migrateMetrics([m], makeOptions());
    expect(result.unconverted).toHaveLength(1);
    expect(result.unconverted[0].reason).toBe("Unsupported SQL feature: CTE");
  });

  it("marks DISTINCT as unconverted", () => {
    const m = makeMetric({
      sql: "SELECT DISTINCT user_id AS user_id, ts AS timestamp FROM events",
    });
    const result = migrateMetrics([m], makeOptions());
    expect(result.unconverted).toHaveLength(1);
    expect(result.unconverted[0].reason).toBe(
      "Unsupported SQL feature: DISTINCT",
    );
  });

  it("marks LIMIT as unconverted", () => {
    const m = makeMetric({
      sql: "SELECT user_id AS user_id, ts AS timestamp FROM events LIMIT 100",
    });
    const result = migrateMetrics([m], makeOptions());
    expect(result.unconverted).toHaveLength(1);
    expect(result.unconverted[0].reason).toBe("Unsupported SQL feature: LIMIT");
  });

  it("marks OFFSET as unconverted", () => {
    const m = makeMetric({
      sql: "SELECT user_id AS user_id, ts AS timestamp FROM events LIMIT 100 OFFSET 10",
    });
    const result = migrateMetrics([m], makeOptions());
    expect(result.unconverted).toHaveLength(1);
    // LIMIT is checked before OFFSET
    expect(result.unconverted[0].reason).toMatch(/Unsupported SQL feature/);
  });

  it("marks HAVING as unconverted", () => {
    const m = makeMetric({
      sql: "SELECT user_id AS user_id, COUNT(*) AS value FROM events GROUP BY user_id HAVING COUNT(*) > 1",
    });
    const result = migrateMetrics([m], makeOptions());
    expect(result.unconverted).toHaveLength(1);
    expect(result.unconverted[0].reason).toBe(
      "Unsupported SQL feature: HAVING",
    );
  });
});

// ─── GROUP BY support ────────────────────────────────────────────────────────

describe("GROUP BY support", () => {
  it("includes GROUP BY in fact table SQL", () => {
    const m = makeMetric({
      type: "count",
      sql: "SELECT user_id AS user_id, ts AS timestamp, COUNT(*) AS value FROM events GROUP BY user_id, ts",
    });
    const result = migrateMetrics([m], makeOptions());

    expect(result.unconverted).toHaveLength(0);
    expect(result.factTables).toHaveLength(1);
    expect(result.factTables[0].sql).toContain("GROUP BY");
    expect(result.factTables[0].sql).toContain("user_id");
    expect(result.factMetrics).toHaveLength(1);
  });

  it("groups metrics with same GROUP BY into one fact table", () => {
    const m1 = makeMetric({
      id: "m1",
      name: "Metric 1",
      type: "count",
      sql: "SELECT user_id AS user_id, ts AS timestamp, COUNT(*) AS value FROM events GROUP BY user_id, ts",
    });
    const m2 = makeMetric({
      id: "m2",
      name: "Metric 2",
      type: "revenue",
      sql: "SELECT user_id AS user_id, ts AS timestamp, SUM(amount) AS value FROM events GROUP BY user_id, ts",
    });
    const result = migrateMetrics([m1, m2], makeOptions());

    expect(result.factTables).toHaveLength(1);
    expect(result.factMetrics).toHaveLength(2);
    expect(result.factTables[0].sql).toContain("GROUP BY");
  });

  it("separates metrics with different GROUP BY clauses", () => {
    const m1 = makeMetric({
      id: "m1",
      sql: "SELECT user_id AS user_id, ts AS timestamp, COUNT(*) AS value FROM events GROUP BY user_id, ts",
    });
    const m2 = makeMetric({
      id: "m2",
      sql: "SELECT user_id AS user_id, ts AS timestamp, COUNT(*) AS value FROM events GROUP BY user_id",
    });
    const result = migrateMetrics([m1, m2], makeOptions());

    expect(result.factTables).toHaveLength(2);
  });

  it("separates metrics where one has GROUP BY and the other does not", () => {
    const m1 = makeMetric({
      id: "m1",
      sql: "SELECT user_id AS user_id, ts AS timestamp FROM events",
    });
    const m2 = makeMetric({
      id: "m2",
      type: "count",
      sql: "SELECT user_id AS user_id, ts AS timestamp, COUNT(*) AS value FROM events GROUP BY user_id, ts",
    });
    const result = migrateMetrics([m1, m2], makeOptions());

    expect(result.factTables).toHaveLength(2);
  });
});

// ─── 11. Settings preservation ──────────────────────────────────────────────

describe("Settings preservation", () => {
  it("preserves capping, window, prior, risk thresholds, and inverse", () => {
    const m = makeMetric({
      type: "count",
      sql: "SELECT user_id AS user_id, ts AS timestamp, cnt AS value FROM events",
      inverse: true,
      cappingSettings: { type: "absolute", value: 100 },
      windowSettings: {
        type: "conversion",
        delayValue: 2,
        delayUnit: "hours",
        windowValue: 48,
        windowUnit: "hours",
      },
      priorSettings: { override: true, proper: true, mean: 0.5, stddev: 0.1 },
      winRisk: 0.01,
      loseRisk: 0.05,
      maxPercentChange: 0.75,
      minPercentChange: 0.01,
      minSampleSize: 500,
      regressionAdjustmentOverride: true,
      regressionAdjustmentEnabled: true,
      regressionAdjustmentDays: 7,
    });
    const result = migrateMetrics([m], makeOptions());

    const fm = result.factMetrics[0];
    expect(fm.inverse).toBe(true);
    expect(fm.cappingSettings).toEqual({ type: "absolute", value: 100 });
    expect(fm.windowSettings).toEqual({
      type: "conversion",
      delayValue: 2,
      delayUnit: "hours",
      windowValue: 48,
      windowUnit: "hours",
    });
    expect(fm.priorSettings).toEqual({
      override: true,
      proper: true,
      mean: 0.5,
      stddev: 0.1,
    });
    expect(fm.winRisk).toBe(0.01);
    expect(fm.loseRisk).toBe(0.05);
    expect(fm.maxPercentChange).toBe(0.75);
    expect(fm.minPercentChange).toBe(0.01);
    expect(fm.minSampleSize).toBe(500);
    expect(fm.regressionAdjustmentOverride).toBe(true);
    expect(fm.regressionAdjustmentEnabled).toBe(true);
    expect(fm.regressionAdjustmentDays).toBe(7);
    expect(fm.quantileSettings).toBeNull();
  });

  it("uses default values when settings are not specified", () => {
    const m = makeMetric({
      type: "binomial",
      sql: "SELECT user_id AS user_id, ts AS timestamp FROM events",
    });
    const result = migrateMetrics([m], makeOptions());

    const fm = result.factMetrics[0];
    expect(fm.winRisk).toBe(0.0025);
    expect(fm.loseRisk).toBe(0.0125);
    expect(fm.maxPercentChange).toBe(0.5);
    expect(fm.minPercentChange).toBe(0.005);
    expect(fm.minSampleSize).toBe(150);
    expect(fm.regressionAdjustmentOverride).toBe(false);
    expect(fm.regressionAdjustmentEnabled).toBe(false);
    expect(fm.regressionAdjustmentDays).toBe(14);
  });
});

// ─── 12. Unparseable SQL → unconverted ──────────────────────────────────────

describe("Unparseable SQL", () => {
  it("marks unparseable SQL as unconverted", () => {
    const m = makeMetric({
      sql: "THIS IS NOT VALID SQL AT ALL %%%",
    });
    const result = migrateMetrics([m], makeOptions());

    expect(result.unconverted).toHaveLength(1);
    expect(result.unconverted[0].reason).toMatch(/Failed to parse SQL/);
  });

  it("marks empty SQL as unconverted", () => {
    const m = makeMetric({ queryFormat: "sql", sql: "" });
    const result = migrateMetrics([m], makeOptions());

    expect(result.unconverted).toHaveLength(1);
    expect(result.unconverted[0].reason).toBe("No SQL query defined");
  });

  it("marks undefined SQL as unconverted", () => {
    const m = makeMetric({ queryFormat: "sql", sql: undefined });
    const result = migrateMetrics([m], makeOptions());

    expect(result.unconverted).toHaveLength(1);
    expect(result.unconverted[0].reason).toBe("No SQL query defined");
  });

  it("marks SQL without FROM as unconverted", () => {
    const m = makeMetric({ sql: "SELECT 1 AS value" });
    const result = migrateMetrics([m], makeOptions());

    expect(result.unconverted).toHaveLength(1);
    expect(result.unconverted[0].reason).toBe("SQL has no FROM clause");
  });
});

// ─── 13. Multiple JOINs, merged value columns ──────────────────────────────

describe("JOINs and merged value columns", () => {
  it("merges metrics with same FROM and JOINs", () => {
    const sql1 =
      "SELECT u.id AS user_id, e.ts AS timestamp, e.clicks AS value FROM events e LEFT JOIN users u ON u.id = e.user_id";
    const sql2 =
      "SELECT u.id AS user_id, e.ts AS timestamp, e.revenue AS value FROM events e LEFT JOIN users u ON u.id = e.user_id";

    const m1 = makeMetric({
      id: "m1",
      name: "Clicks",
      type: "count",
      sql: sql1,
    });
    const m2 = makeMetric({
      id: "m2",
      name: "Revenue",
      type: "revenue",
      sql: sql2,
    });
    const result = migrateMetrics([m1, m2], makeOptions());

    expect(result.factTables).toHaveLength(1);
    expect(result.factMetrics).toHaveLength(2);

    const ft = result.factTables[0];
    expect(ft.sql).toContain("LEFT JOIN");
    expect(ft.sql).toContain("users");

    // Value columns
    expect(result.factMetrics[0].numerator.column).toBe("value_0");
    expect(result.factMetrics[1].numerator.column).toBe("value_1");
  });

  it("separates metrics with different JOINs", () => {
    const sql1 =
      "SELECT u.id AS user_id, e.ts AS timestamp FROM events e LEFT JOIN users u ON u.id = e.user_id";
    const sql2 =
      "SELECT u.id AS user_id, e.ts AS timestamp FROM events e INNER JOIN users u ON u.id = e.user_id";

    const m1 = makeMetric({ id: "m1", sql: sql1 });
    const m2 = makeMetric({ id: "m2", sql: sql2 });
    const result = migrateMetrics([m1, m2], makeOptions());

    expect(result.factTables).toHaveLength(2);
  });
});

// ─── Dotted column references without explicit aliases ──────────────────────

describe("Dotted column references", () => {
  it("detects user_id and timestamp from dotted references without AS", () => {
    const m = makeMetric({
      type: "count",
      sql: "SELECT t.user_id, t.created_at AS timestamp, t.amount AS value FROM events t",
    });
    const result = migrateMetrics([m], makeOptions());

    expect(result.unconverted).toHaveLength(0);
    expect(result.factTables).toHaveLength(1);
    expect(result.factMetrics).toHaveLength(1);

    const ft = result.factTables[0];
    expect(ft.userIdTypes).toEqual(["user_id"]);
    expect(ft.columns.find((c) => c.column === "user_id")).toBeDefined();
    expect(ft.columns.find((c) => c.column === "timestamp")).toBeDefined();
    expect(ft.columns.find((c) => c.column === "value")).toBeDefined();
  });

  it("detects timestamp from dotted reference without AS", () => {
    const m = makeMetric({
      sql: "SELECT t.user_id AS user_id, t.timestamp FROM events t",
    });
    const result = migrateMetrics([m], makeOptions());

    expect(result.unconverted).toHaveLength(0);
    expect(result.factTables).toHaveLength(1);

    const ft = result.factTables[0];
    const tsCol = ft.columns.find((c) => c.column === "timestamp");
    expect(tsCol).toBeDefined();
    expect(tsCol?.datatype).toBe("date");
  });
});

// ─── Aggregation mapping ────────────────────────────────────────────────────

describe("Aggregation mapping", () => {
  it("maps undefined aggregation to sum", () => {
    const m = makeMetric({
      type: "count",
      aggregation: undefined,
      sql: "SELECT user_id AS user_id, ts AS timestamp, cnt AS value FROM events",
    });
    const result = migrateMetrics([m], makeOptions());
    expect(result.factMetrics[0].numerator.aggregation).toBe("sum");
  });

  it("maps empty aggregation to sum", () => {
    const m = makeMetric({
      type: "count",
      aggregation: "",
      sql: "SELECT user_id AS user_id, ts AS timestamp, cnt AS value FROM events",
    });
    const result = migrateMetrics([m], makeOptions());
    expect(result.factMetrics[0].numerator.aggregation).toBe("sum");
  });

  it("preserves max aggregation", () => {
    const m = makeMetric({
      type: "count",
      aggregation: "MAX(value)",
      sql: "SELECT user_id AS user_id, ts AS timestamp, cnt AS value FROM events",
    });
    const result = migrateMetrics([m], makeOptions());
    expect(result.factMetrics[0].numerator.aggregation).toBe("max");
  });

  it("rejects numeric literal aggregation", () => {
    const m = makeMetric({
      type: "count",
      aggregation: "AVG(value)",
      sql: "SELECT user_id AS user_id, ts AS timestamp, cnt AS value FROM events",
    });
    const result = migrateMetrics([m], makeOptions());
    expect(result.unconverted).toHaveLength(1);
    expect(result.unconverted[0].reason).toBe(
      "Unsupported custom aggregation: AVG(value)",
    );
  });

  it("maps COUNT(*) aggregation to $$count with sum", () => {
    const m = makeMetric({
      type: "count",
      aggregation: "COUNT(*)",
      sql: "SELECT user_id AS user_id, ts AS timestamp, cnt AS value FROM events",
    });
    const result = migrateMetrics([m], makeOptions());
    expect(result.unconverted).toHaveLength(0);
    expect(result.factMetrics[0].numerator.column).toBe("$$count");
    expect(result.factMetrics[0].numerator.aggregation).toBe("sum");
  });

  it("maps COUNT(value) aggregation to $$count with sum", () => {
    const m = makeMetric({
      type: "count",
      aggregation: "COUNT(value)",
      sql: "SELECT user_id AS user_id, ts AS timestamp, cnt AS value FROM events",
    });
    const result = migrateMetrics([m], makeOptions());
    expect(result.unconverted).toHaveLength(0);
    expect(result.factMetrics[0].numerator.column).toBe("$$count");
    expect(result.factMetrics[0].numerator.aggregation).toBe("sum");
  });
});

// ─── Conflicting shared columns ─────────────────────────────────────────────

describe("Conflicting shared columns", () => {
  it("falls back to individual fact tables when user ID expressions conflict", () => {
    const m1 = makeMetric({
      id: "m1",
      name: "Metric 1",
      sql: "SELECT u.id AS user_id, ts AS timestamp FROM events",
    });
    const m2 = makeMetric({
      id: "m2",
      name: "Metric 2",
      sql: "SELECT u.email AS user_id, ts AS timestamp FROM events",
    });
    const result = migrateMetrics([m1, m2], makeOptions());

    // Should fall back to 2 fact tables since user_id expressions differ
    expect(result.factTables).toHaveLength(2);
    expect(result.factMetrics).toHaveLength(2);
  });
});

// ─── Metadata merging ───────────────────────────────────────────────────────

describe("Metadata merging", () => {
  it("merges tags, projects from all metrics in group", () => {
    const m1 = makeMetric({
      id: "m1",
      name: "Metric 1",
      type: "count",
      tags: ["tag1", "tag2"],
      projects: ["proj1"],
      sql: "SELECT user_id AS user_id, ts AS timestamp, cnt AS value FROM events",
    });
    const m2 = makeMetric({
      id: "m2",
      name: "Metric 2",
      type: "revenue",
      tags: ["tag2", "tag3"],
      projects: ["proj2"],
      sql: "SELECT user_id AS user_id, ts AS timestamp, revenue AS value FROM events",
    });
    const result = migrateMetrics([m1, m2], makeOptions());

    const ft = result.factTables[0];
    expect(ft.tags.sort()).toEqual(["tag1", "tag2", "tag3"]);
    expect(ft.projects.sort()).toEqual(["proj1", "proj2"]);
  });

  it("copies organization and datasource from metric", () => {
    const m = makeMetric({
      organization: "org_test",
      datasource: "ds_test",
    });
    const result = migrateMetrics([m], makeOptions());

    expect(result.factTables[0].organization).toBe("org_test");
    expect(result.factTables[0].datasource).toBe("ds_test");
    expect(result.factMetrics[0].organization).toBe("org_test");
    expect(result.factMetrics[0].datasource).toBe("ds_test");
  });
});

// ─── Date handling ──────────────────────────────────────────────────────────

describe("Date handling", () => {
  it("uses provided now date", () => {
    const m = makeMetric({});
    const result = migrateMetrics([m], makeOptions());

    expect(result.factTables[0].dateCreated).toEqual(NOW);
    expect(result.factTables[0].dateUpdated).toEqual(NOW);
    expect(result.factMetrics[0].dateCreated).toEqual(NOW);
    expect(result.factMetrics[0].dateUpdated).toEqual(NOW);
  });
});

// ─── WHERE parsing integration with migrateMetrics ──────────────────────────

describe("WHERE parsing integration", () => {
  it("produces structured filters for simple per-metric WHERE", () => {
    const m1 = makeMetric({
      id: "m1",
      name: "Active",
      type: "count",
      sql: "SELECT user_id AS user_id, ts AS timestamp, cnt AS value FROM events WHERE status = 'active' AND region = 'us'",
    });
    const m2 = makeMetric({
      id: "m2",
      name: "Deleted",
      type: "count",
      sql: "SELECT user_id AS user_id, ts AS timestamp, cnt AS value FROM events WHERE status = 'deleted'",
    });
    const result = migrateMetrics([m1, m2], makeOptions());

    expect(result.factTables).toHaveLength(1);
    expect(result.factTables[0].sql).not.toContain("WHERE");

    const fm1 = result.factMetrics[0];
    expect(fm1.numerator.rowFilters).toHaveLength(2);
    expect(fm1.numerator.rowFilters![0]).toEqual({
      operator: "=",
      column: "status",
      values: ["active"],
    });
    expect(fm1.numerator.rowFilters![1]).toEqual({
      operator: "=",
      column: "region",
      values: ["us"],
    });

    const fm2 = result.factMetrics[1];
    expect(fm2.numerator.rowFilters).toHaveLength(1);
    expect(fm2.numerator.rowFilters![0]).toEqual({
      operator: "=",
      column: "status",
      values: ["deleted"],
    });
  });

  it("falls back to sql_expr for complex per-metric WHERE", () => {
    const m1 = makeMetric({
      id: "m1",
      name: "Complex",
      type: "count",
      sql: "SELECT user_id AS user_id, ts AS timestamp, cnt AS value FROM events WHERE status = 'active' OR status = 'pending'",
    });
    const m2 = makeMetric({
      id: "m2",
      name: "Simple",
      type: "count",
      sql: "SELECT user_id AS user_id, ts AS timestamp, cnt AS value FROM events WHERE status = 'deleted'",
    });
    const result = migrateMetrics([m1, m2], makeOptions());

    const fm1 = result.factMetrics[0];
    expect(fm1.numerator.rowFilters).toHaveLength(1);
    expect(fm1.numerator.rowFilters![0].operator).toBe("sql_expr");
    expect(fm1.numerator.rowFilters![0].values).toEqual([
      "status = 'active' OR status = 'pending'",
    ]);

    // m2 should still get structured filters
    const fm2 = result.factMetrics[1];
    expect(fm2.numerator.rowFilters).toHaveLength(1);
    expect(fm2.numerator.rowFilters![0].operator).toBe("=");
  });

  it("parses builder metric conditions into structured filters", () => {
    const m1 = makeMetric({
      id: "m1",
      queryFormat: "builder",
      table: "events",
      column: "amount",
      timestampColumn: "ts",
      type: "revenue",
      sql: undefined,
      userIdTypes: ["user_id"],
      userIdColumns: { user_id: "uid" },
      conditions: [{ column: "status", operator: "=", value: "active" }],
    });
    const m2 = makeMetric({
      id: "m2",
      queryFormat: "builder",
      table: "events",
      column: "clicks",
      timestampColumn: "ts",
      type: "count",
      sql: undefined,
      userIdTypes: ["user_id"],
      userIdColumns: { user_id: "uid" },
      conditions: [{ column: "status", operator: "!=", value: "deleted" }],
    });
    const result = migrateMetrics([m1, m2], makeOptions());

    expect(result.factTables).toHaveLength(1);

    const fm1 = result.factMetrics[0];
    expect(fm1.numerator.rowFilters).toHaveLength(1);
    expect(fm1.numerator.rowFilters![0]).toEqual({
      operator: "=",
      column: "status",
      values: ["active"],
    });

    const fm2 = result.factMetrics[1];
    expect(fm2.numerator.rowFilters).toHaveLength(1);
    expect(fm2.numerator.rowFilters![0]).toEqual({
      operator: "!=",
      column: "status",
      values: ["deleted"],
    });
  });
});
