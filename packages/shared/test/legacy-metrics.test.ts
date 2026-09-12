import { FactMetricInterface, FunnelStep } from "../types/fact-table";
import { MetricInterface } from "../types/metric";
import { groupLegacyMetricsIntoFactTables } from "../src/legacy-metrics";

let n = 0;
const options = () => {
  n = 0;
  return {
    datasourceType: "postgres" as const,
    generateFactTableId: () => `ft_${++n}`,
    generateFactMetricId: (m: MetricInterface) => `fact__${m.id}`,
  };
};

function legacy(
  id: string,
  sql: string,
  overrides: Partial<MetricInterface> = {},
): MetricInterface {
  return {
    id,
    organization: "org",
    owner: "me",
    datasource: "ds",
    dateCreated: null,
    dateUpdated: null,
    name: `Metric ${id}`,
    description: "",
    userIdTypes: ["user_id"],
    sql,
    type: "count",
    inverse: false,
    ignoreNulls: false,
    cappingSettings: { type: "", value: 0 },
    windowSettings: {
      type: "conversion",
      delayValue: 0,
      delayUnit: "hours",
      windowValue: 72,
      windowUnit: "hours",
    },
    priorSettings: { override: false, proper: false, mean: 0, stddev: 0.3 },
    queries: [],
    runStarted: null,
    queryFormat: "sql",
    ...overrides,
  };
}

function step(name: string, factTableId: string): FunnelStep {
  return {
    name,
    factTableId,
    rowFilters: [],
    optional: false,
    conversionWindow: null,
  };
}

function migrated(legacyId: string): FactMetricInterface {
  return {
    id: `fact__${legacyId}`,
    organization: "org",
    owner: "me",
    datasource: "ds",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: `Fact ${legacyId}`,
    description: "",
    tags: [],
    projects: [],
    inverse: false,
    replaces: [legacyId],
    metricType: "proportion",
    numerator: {
      factTableId: "ftb_old",
      column: "$$distinctUsers",
      rowFilters: [{ column: "e", operator: "=", values: [legacyId] }],
    },
    denominator: null,
    cappingSettings: { type: "", value: 0 },
    windowSettings: {
      type: "conversion",
      delayValue: 0,
      delayUnit: "hours",
      windowValue: 72,
      windowUnit: "hours",
    },
    priorSettings: { override: false, proper: false, mean: 0, stddev: 0.3 },
    maxPercentChange: 0.5,
    minPercentChange: 0.005,
    minSampleSize: 150,
    winRisk: 0.0025,
    loseRisk: 0.0125,
    regressionAdjustmentOverride: false,
    regressionAdjustmentEnabled: false,
    regressionAdjustmentDays: 14,
    quantileSettings: null,
    funnelSettings: null,
  };
}

describe("groupLegacyMetricsIntoFactTables", () => {
  it("groups metrics sharing a FROM clause and splits typed vs sql_expr filters", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy(
          "a",
          "SELECT uid AS user_id, ts AS timestamp, amount AS value FROM orders WHERE status = 'paid'",
        ),
        legacy(
          "b",
          "select UID user_id, TS timestamp from ORDERS where status in ('x','y')",
          { type: "binomial" },
        ),
        legacy(
          "c",
          "SELECT uid AS user_id, ts AS timestamp, amount AS value FROM orders WHERE lower(status) = 'paid'",
        ),
      ],
      options(),
    );
    expect(errors).toEqual([]);
    expect(groups).toHaveLength(2);

    const [g1, g2] = groups;
    expect(g1.factTable.id).toBe("ft_1");
    expect(g1.factTable.name).toBe("orders");
    expect(g1.factTable.userIdTypes).toEqual(["user_id"]);
    expect(g1.factTable.sql).toBe(
      "SELECT \n  uid AS user_id,\n  ts AS timestamp,\n  amount,\n  status\nFROM orders",
    );
    expect(g1.factTable.columns?.map((c) => [c.column, c.datatype])).toEqual([
      ["user_id", "string"],
      ["timestamp", "date"],
      ["amount", "number"],
      ["status", ""],
    ]);
    expect(g1.metrics.map((m) => [m.id, m.metricType, m.numerator])).toEqual([
      [
        "fact__a",
        "mean",
        {
          factTableId: "ft_1",
          column: "amount",
          aggregation: "sum",
          rowFilters: [{ operator: "=", column: "status", values: ["paid"] }],
        },
      ],
      [
        "fact__b",
        "proportion",
        {
          factTableId: "ft_1",
          column: "$$distinctUsers",
          rowFilters: [
            { operator: "in", column: "status", values: ["x", "y"] },
          ],
        },
      ],
    ]);

    // sql_expr filters go into the fact table SQL, so metric c is its own table
    expect(g2.factTable.sql).toContain("WHERE (lower(status) = 'paid')");
    expect(g2.metrics[0].numerator.rowFilters).toEqual([]);
  });

  it("renames conflicting value columns and rewrites references", () => {
    const { groups } = groupLegacyMetricsIntoFactTables(
      [
        legacy("a", "SELECT user_id, timestamp, amount * 2 AS value FROM t"),
        legacy(
          "b",
          "SELECT user_id, timestamp, qty * 2 AS value FROM t WHERE value > 0",
        ),
      ],
      options(),
    );
    expect(groups).toHaveLength(1);
    // `value` in the WHERE is the source column, not the select alias
    expect(groups[0].factTable.sql).toContain(
      "qty * 2 AS value_2,\n  value AS value_3",
    );
    expect(groups[0].metrics[1].numerator).toMatchObject({
      column: "value_2",
      rowFilters: [{ operator: ">", column: "value_3", values: ["0"] }],
    });
  });

  it("splits on timestamp and user id expressions, and interpolates static template variables", () => {
    const { groups } = groupLegacyMetricsIntoFactTables(
      [
        legacy("a", "SELECT user_id, created_at AS timestamp FROM t", {
          type: "binomial",
        }),
        legacy("b", "SELECT user_id, updated_at AS timestamp FROM t", {
          type: "binomial",
        }),
        legacy("c", "SELECT uid AS user_id, created_at AS timestamp FROM t", {
          type: "binomial",
        }),
        legacy(
          "d",
          "SELECT user_id, created_at AS timestamp FROM t WHERE e = '{{eventName}}'",
          {
            type: "binomial",
            templateVariables: { eventName: "click" },
          },
        ),
      ],
      options(),
    );
    expect(groups).toHaveLength(3);
    expect(groups[0].metrics.map((m) => m.id)).toEqual(["fact__a", "fact__d"]);
    expect(groups[0].metrics[1].numerator.rowFilters).toEqual([
      { operator: "=", column: "e", values: ["click"] },
    ]);
    expect(groups[0].factTable.eventName).toBe("");
  });

  it("keeps the most permissive tableSuffix clause and DISTINCT without splitting groups", () => {
    const { groups } = groupLegacyMetricsIntoFactTables(
      [
        legacy(
          "a",
          "SELECT DISTINCT user_pseudo_id AS user_id, ts AS timestamp FROM `p.d.events_*` WHERE _TABLE_SUFFIX BETWEEN '1' AND '2' AND event_name = 'x'",
          { type: "binomial" },
        ),
        legacy(
          "b",
          "SELECT user_pseudo_id AS user_id, ts AS timestamp FROM `p.d.events_*` WHERE event_name = 'y'",
          { type: "binomial" },
        ),
        legacy(
          "c",
          "SELECT user_pseudo_id AS user_id, ts AS timestamp FROM `p.d.events_*` WHERE (_TABLE_SUFFIX BETWEEN '1' AND '2') OR (_TABLE_SUFFIX BETWEEN 'intraday_1' AND 'intraday_2') OR (_TABLE_SUFFIX BETWEEN '1' AND '2')",
          { type: "binomial" },
        ),
      ],
      { ...options(), datasourceType: "bigquery" },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].factTable.sql).toBe(
      "SELECT DISTINCT \n  user_pseudo_id AS user_id,\n  ts AS timestamp,\n  event_name\nFROM `p.d.events_*`\nWHERE ((_table_suffix BETWEEN '1' AND '2') OR (_table_suffix BETWEEN 'intraday_1' AND 'intraday_2'))",
    );
    expect(groups[0].metrics.map((m) => m.numerator.rowFilters)).toEqual([
      [{ operator: "=", column: "event_name", values: ["x"] }],
      [{ operator: "=", column: "event_name", values: ["y"] }],
      [],
    ]);
  });

  it("converts binomial denominator chains into funnel metrics", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("view", "SELECT user_id, timestamp FROM t WHERE e = 'view'", {
          type: "binomial",
        }),
        legacy("cart", "SELECT user_id, timestamp FROM t WHERE e = 'cart'", {
          type: "binomial",
          denominator: "view",
          windowSettings: {
            type: "conversion",
            delayValue: 0,
            delayUnit: "hours",
            windowValue: 1,
            windowUnit: "days",
          },
        }),
        legacy("buy", "SELECT user_id, timestamp FROM u", {
          type: "binomial",
          denominator: "cart",
          windowSettings: {
            type: "",
            delayValue: 0,
            delayUnit: "hours",
            windowValue: 0,
            windowUnit: "hours",
          },
        }),
        legacy("rev", "SELECT user_id, timestamp, v AS value FROM u", {
          denominator: "cart",
        }),
        legacy("lb", "SELECT user_id, timestamp FROM u", {
          type: "binomial",
          denominator: "view",
          windowSettings: {
            type: "lookback",
            delayValue: 0,
            delayUnit: "hours",
            windowValue: 7,
            windowUnit: "days",
          },
        }),
      ],
      options(),
    );
    const byId = Object.fromEntries(
      groups.flatMap((g) => g.metrics).map((m) => [m.id, m]),
    );
    expect(byId["fact__buy"]).toMatchObject({
      metricType: "funnel",
      numerator: null,
      denominator: null,
      cappingSettings: { type: "", value: 0 },
      funnelSettings: {
        steps: [
          {
            name: "Metric view",
            factTableId: "ft_1",
            rowFilters: [{ operator: "=", column: "e", values: ["view"] }],
            optional: false,
            conversionWindow: { unit: "hours", value: 72 },
          },
          {
            name: "Metric cart",
            factTableId: "ft_1",
            rowFilters: [{ operator: "=", column: "e", values: ["cart"] }],
            optional: false,
            conversionWindow: { unit: "days", value: 1 },
          },
          {
            name: "Metric buy",
            factTableId: "ft_2",
            rowFilters: [],
            optional: false,
            conversionWindow: null,
          },
        ],
      },
    });
    expect(byId["fact__cart"].funnelSettings?.steps).toHaveLength(2);
    // A funnel replaces only the metric it was converted from
    expect(byId["fact__buy"].replaces).toEqual(["buy"]);
    expect(byId["fact__cart"].replaces).toEqual(["cart"]);
    expect(byId["fact__view"].replaces).toEqual(["view"]);
    expect(errors).toEqual([
      {
        metricId: "rev",
        error:
          "A funnel counts users, so this count metric's value would be lost. Rebuild it by hand as a ratio if that is what you want.",
      },
      {
        metricId: "lb",
        error: "Lookback windows are not supported in funnel steps",
      },
    ]);
  });

  it("reuses a compatible existing fact table", () => {
    const { groups } = groupLegacyMetricsIntoFactTables(
      [
        legacy("a", "SELECT user_id, ts AS timestamp, amt AS value FROM t"),
        legacy("b", "SELECT user_id, ts AS timestamp FROM t WHERE x = 1", {
          type: "binomial",
        }),
        legacy("c", "SELECT user_id, ts AS timestamp, qty AS value FROM t"),
        legacy("d", "SELECT user_id, ts AS timestamp FROM u", {
          type: "binomial",
        }),
      ],
      {
        ...options(),
        existingFactTables: [
          {
            id: "ft_existing",
            sql: "SELECT user_id, anonymous_id, ts AS event_time, amt, x FROM t",
            userIdTypes: ["user_id", "anonymous_id"],
            timestampColumn: "event_time",
          },
          {
            id: "ft_other",
            sql: "SELECT user_id, ts AS timestamp FROM u WHERE y = 2",
            userIdTypes: ["user_id"],
          },
        ],
      },
    );
    // a and b fit the existing table; c adds a conflicting value column so the
    // whole group is new; d's FROM matches but the existing table filters rows
    expect(
      groups.map((g) => [
        g.factTable.id,
        g.existing,
        g.metrics.map((m) => m.id),
      ]),
    ).toEqual([
      ["ft_1", false, ["fact__a", "fact__b", "fact__c"]],
      ["ft_2", false, ["fact__d"]],
    ]);
    const again = groupLegacyMetricsIntoFactTables(
      [
        legacy("a", "SELECT user_id, ts AS timestamp, amt AS value FROM t"),
        legacy("b", "SELECT user_id, ts AS timestamp FROM t WHERE x = 1", {
          type: "binomial",
        }),
      ],
      {
        ...options(),
        existingFactTables: [
          {
            id: "ft_existing",
            sql: "SELECT user_id, anonymous_id, ts AS event_time, amt, x FROM t",
            userIdTypes: ["user_id", "anonymous_id"],
            timestampColumn: "event_time",
          },
        ],
      },
    );
    expect(again.groups).toHaveLength(1);
    expect(again.groups[0].existing).toBe(true);
    expect(again.groups[0].factTable.id).toBe("ft_existing");
    expect(again.groups[0].metrics.map((m) => m.numerator.factTableId)).toEqual(
      ["ft_existing", "ft_existing"],
    );
  });

  it.each([
    ["", false],
    [" WHERE event = 'purchase'", true],
    [" WHERE event = 'refund'", false],
    [" WHERE event = 'purchase' AND country = 'US'", false],
  ])(
    "preserves elevated filters when matching existing SQL: %s",
    (where, reuse) => {
      const sql = "SELECT user_id, ts AS timestamp FROM t";
      const { groups, errors } = groupLegacyMetricsIntoFactTables(
        [
          legacy("purchase", `${sql} WHERE event = 'purchase'`, {
            type: "binomial",
          }),
        ],
        {
          ...options(),
          existingFactTables: [
            {
              id: "ft_existing",
              sql: sql + where,
              userIdTypes: ["user_id"],
            },
          ],
        },
      );
      expect(errors).toEqual([]);
      expect(groups).toHaveLength(1);
      expect(groups[0].existing).toBe(reuse);
      expect(groups[0].factTable.sql).toContain("event = 'purchase'");
      expect(groups[0].metrics[0].numerator.rowFilters).toEqual([]);
    },
  );

  it("maps custom aggregations, ratios and ignoreNulls", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("max", "SELECT user_id, timestamp, v AS value FROM t", {
          aggregation: "MAX(value)",
        }),
        legacy("cd", "SELECT user_id, timestamp, v AS value FROM t", {
          aggregation: "COUNT(DISTINCT value)",
        }),
        legacy("cnt", "SELECT user_id, timestamp, v AS value FROM t", {
          aggregation: "COUNT(*)",
        }),
        legacy("cv", "SELECT user_id, timestamp, v AS value FROM t", {
          aggregation: "COUNT(value)",
        }),
        legacy("one", "SELECT user_id, timestamp, v AS value FROM t", {
          aggregation: "1",
        }),
        legacy("num", "SELECT user_id, timestamp, v AS value FROM t", {
          denominator: "den",
        }),
        legacy("den", "SELECT user_id, timestamp, w AS value FROM u"),
        legacy("nn", "SELECT user_id, timestamp, v AS value FROM t", {
          ignoreNulls: true,
        }),
        legacy("bad", "SELECT user_id, timestamp, v AS value FROM t", {
          aggregation: "AVG(value)",
        }),
        legacy("binden", "SELECT user_id, timestamp, v AS value FROM t", {
          denominator: "bin",
        }),
        legacy("bin", "SELECT user_id, timestamp FROM t", { type: "binomial" }),
      ],
      options(),
    );
    const byId = Object.fromEntries(
      groups.flatMap((g) => g.metrics).map((m) => [m.id, m]),
    );
    expect(byId["fact__max"].numerator.aggregation).toBe("max");
    expect(byId["fact__cd"].numerator.aggregation).toBe("count distinct");
    expect(byId["fact__cnt"].numerator.column).toBe("$$count");
    // Both legacy COUNT forms skip null values.
    expect(byId["fact__cnt"].numerator).toEqual(byId["fact__cv"].numerator);
    expect(byId["fact__cv"].numerator).toMatchObject({
      column: "$$count",
      rowFilters: [{ operator: "not_null", column: "v" }],
    });
    expect(byId["fact__one"]).toMatchObject({
      metricType: "proportion",
      numerator: { column: "$$distinctUsers" },
    });
    expect(byId["fact__num"]).toMatchObject({
      metricType: "ratio",
      numerator: { factTableId: "ft_1", column: "v", aggregation: "sum" },
      denominator: { factTableId: "ft_2", column: "w", aggregation: "sum" },
    });
    expect(byId["fact__nn"]).toMatchObject({
      metricType: "ratio",
      denominator: {
        factTableId: "ft_1",
        column: "$$distinctUsers",
        aggregateFilterColumn: "v",
        aggregateFilter: "!= 0",
      },
    });
    // One binomial denominator step keeps the value as a ratio
    expect(byId["fact__binden"]).toMatchObject({
      metricType: "ratio",
      numerator: { column: "v", aggregation: "sum" },
      denominator: { column: "$$distinctUsers" },
    });
    expect(errors).toEqual([
      { metricId: "bad", error: "Unsupported custom aggregation: AVG(value)" },
    ]);
  });

  it("merges metrics whose user id types are a subset or disjoint, but not conflicting", () => {
    const { groups } = groupLegacyMetricsIntoFactTables(
      [
        legacy(
          "both",
          "SELECT uid AS user_id, aid AS anonymous_id, ts AS timestamp FROM t",
          {
            type: "binomial",
            userIdTypes: ["user_id", "anonymous_id"],
          },
        ),
        legacy("user", "SELECT uid AS user_id, ts AS timestamp FROM t", {
          type: "binomial",
        }),
        legacy("device", "SELECT did AS device_id, ts AS timestamp FROM t", {
          type: "binomial",
          userIdTypes: ["device_id"],
        }),
        legacy("other", "SELECT other_id AS user_id, ts AS timestamp FROM t", {
          type: "binomial",
        }),
        legacy(
          "other2",
          "SELECT other_id AS user_id, aid AS anonymous_id, ts AS timestamp FROM t",
          {
            type: "binomial",
            userIdTypes: ["user_id", "anonymous_id"],
          },
        ),
      ],
      options(),
    );
    expect(
      groups.map((g) => [g.factTable.userIdTypes, g.metrics.map((m) => m.id)]),
    ).toEqual([
      [
        ["user_id", "anonymous_id", "device_id"],
        ["fact__both", "fact__user", "fact__device"],
      ],
      [
        ["user_id", "anonymous_id"],
        ["fact__other", "fact__other2"],
      ],
    ]);
    expect(groups[0].factTable.sql).toBe(
      "SELECT \n  uid AS user_id,\n  aid AS anonymous_id,\n  ts AS timestamp,\n  did AS device_id\nFROM t",
    );
  });

  it("accepts qualified and quoted user id columns", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("a", "SELECT e.user_id, e.ts AS timestamp FROM t e", {
          type: "binomial",
        }),
        legacy("b", 'SELECT e."user_id", e.ts AS timestamp FROM t e', {
          type: "binomial",
        }),
      ],
      options(),
    );
    expect(errors).toEqual([]);
    // Same output column name, but different expressions for the id type, so
    // they land in separate tables
    expect(
      groups.map((g) => [g.factTable.userIdTypes, g.factTable.sql]),
    ).toEqual([
      [["user_id"], "SELECT \n  e.user_id,\n  e.ts AS timestamp\nFROM t e"],
      [["user_id"], 'SELECT \n  e."user_id",\n  e.ts AS timestamp\nFROM t e'],
    ]);
  });

  it("flattens additive GROUP BY values and preserves non-additive ones", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy(
          "sum",
          "SELECT user_id, DATE(ts) AS timestamp, SUM(amt) AS value FROM t GROUP BY 1, 2",
        ),
        legacy(
          "cnt",
          "SELECT user_id, DATE(ts) AS timestamp, COUNT(*) AS value FROM t GROUP BY 1, 2",
        ),
        legacy(
          "cntx",
          "SELECT user_id, DATE(ts) AS timestamp, COUNT(o.id) AS value FROM t GROUP BY 1, 2",
        ),
        legacy(
          "cd",
          "SELECT user_id, DATE(ts) AS timestamp, COUNT(DISTINCT sess) AS value FROM t GROUP BY 1, 2",
        ),
        legacy(
          "max",
          "SELECT user_id, DATE(ts) AS timestamp, MAX(amt) AS value FROM t GROUP BY 1, 2",
          {
            type: "revenue",
          },
        ),
        legacy(
          "bin",
          "SELECT user_id, DATE(ts) AS timestamp, COUNT(*) AS n FROM t GROUP BY 1, 2",
          {
            type: "binomial",
          },
        ),
        legacy(
          "custom",
          "SELECT user_id, DATE(ts) AS timestamp, SUM(amt) AS value FROM t GROUP BY 1, 2",
          {
            aggregation: "MAX(value)",
          },
        ),
        legacy(
          "mints",
          "SELECT user_id, MIN(ts) AS timestamp FROM t GROUP BY 1",
          { type: "binomial" },
        ),
        legacy(
          "maxts",
          "SELECT user_id, MAX(ts) AS timestamp FROM t GROUP BY 1",
          { type: "binomial" },
        ),
        legacy(
          "maxid",
          "SELECT MAX(user_id) AS user_id, ts AS timestamp FROM t GROUP BY 2",
          { type: "binomial" },
        ),
        legacy(
          "finer",
          "SELECT user_id, DATE(ts) AS timestamp, SUM(amt) AS value FROM t GROUP BY 1, 2, session",
        ),
      ],
      options(),
    );
    expect(errors).toEqual([
      {
        metricId: "custom",
        error:
          "Custom aggregation over already aggregated SQL is not supported",
      },
      {
        metricId: "mints",
        error: "Aggregate function MIN() is not supported in SELECT",
      },
      {
        metricId: "maxts",
        error:
          "Aggregated timestamp (first/last event per user) is not supported",
      },
      {
        metricId: "maxid",
        error: "Aggregated user id (one row per group) is not supported",
      },
    ]);
    expect(groups[0].metrics.map((m) => m.id)).toContain("fact__finer");
    expect(groups).toHaveLength(3);
    expect(groups[0].factTable.sql).toBe(
      "SELECT \n  user_id,\n  date(ts) AS timestamp,\n  amt,\n  o.id\nFROM t",
    );
    const byId = Object.fromEntries(
      groups.flatMap((g) => g.metrics).map((m) => [m.id, m.numerator]),
    );
    expect(byId["fact__sum"]).toMatchObject({
      column: "amt",
      aggregation: "sum",
      rowFilters: [],
    });
    expect(byId["fact__cnt"]).toMatchObject({
      column: "$$count",
      rowFilters: [],
    });
    expect(byId["fact__cntx"]).toMatchObject({
      column: "$$count",
      rowFilters: [{ operator: "not_null", column: "id" }],
    });
    for (const [id, expression] of [
      ["cd", "COUNT(DISTINCT sess)"],
      ["max", "MAX(amt)"],
    ]) {
      const group = groups.find((g) =>
        g.metrics.some((m) => m.id === `fact__${id}`),
      );
      expect(group?.factTable.sql).toBe(
        `SELECT user_id, DATE(ts) AS timestamp, ${expression} AS value FROM t GROUP BY 1, 2`,
      );
      expect(byId[`fact__${id}`]).toMatchObject({
        column: "value",
        aggregation: "sum",
        rowFilters: [],
      });
      expect(
        group?.factTable.columns?.find((c) => c.column === "value"),
      ).toMatchObject({
        datatype: "number",
      });
    }
    expect(byId["fact__bin"]).toMatchObject({ column: "$$distinctUsers" });
    expect(groups[0].factTable.dedupe).toBeUndefined();
  });

  it.each(["user_id, timestamp, value", "1, 2, 3", "ALL"])(
    "shares deduplication GROUP BY %s with an ungrouped metric",
    (groupBy) => {
      const sql = "SELECT user_id, timestamp, value FROM t";
      const { groups, errors } = groupLegacyMetricsIntoFactTables(
        [legacy("deduped", `${sql} GROUP BY ${groupBy}`), legacy("raw", sql)],
        options(),
      );
      expect(errors).toEqual([]);
      expect(groups).toHaveLength(1);
      expect(groups[0].factTable.sql).toBe(
        "SELECT DISTINCT \n  user_id,\n  timestamp,\n  value\nFROM t",
      );
      expect(groups[0].metrics.map((m) => m.numerator)).toEqual([
        {
          factTableId: "ft_1",
          column: "value",
          aggregation: "sum",
          rowFilters: [],
        },
        {
          factTableId: "ft_1",
          column: "value",
          aggregation: "sum",
          rowFilters: [],
        },
      ]);
    },
  );

  it("drops constant value columns and restores the original value column name", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("one", "SELECT user_id, timestamp, 1 AS value FROM t"),
        legacy("bin", "SELECT user_id, timestamp, 1 AS value FROM t", {
          type: "binomial",
        }),
        legacy("two", "SELECT user_id, timestamp, 2 AS value FROM t"),
        legacy(
          "qualified",
          "SELECT user_id, timestamp, t.amount AS value FROM t",
        ),
        legacy("expr", "SELECT user_id, timestamp, amount * 2 AS value FROM t"),
      ],
      options(),
    );
    expect(errors).toEqual([]);
    expect(groups).toHaveLength(1);
    // The constant column is gone; `t.amount` keeps its own name
    expect(groups[0].factTable.sql).toBe(
      "SELECT \n  user_id,\n  timestamp,\n  2 AS value,\n  t.amount,\n  amount * 2 AS value_2\nFROM t",
    );
    const byId = Object.fromEntries(groups[0].metrics.map((m) => [m.id, m]));
    expect(byId["fact__one"]).toMatchObject({
      metricType: "mean",
      numerator: { column: "$$count" },
    });
    expect(byId["fact__one"].numerator.aggregation).toBeUndefined();
    expect(byId["fact__bin"].numerator).toMatchObject({
      column: "$$distinctUsers",
    });
    // Only a constant 1 is a row count
    expect(byId["fact__two"].numerator).toMatchObject({
      column: "value",
      aggregation: "sum",
    });
    expect(byId["fact__qualified"].numerator).toMatchObject({
      column: "amount",
      aggregation: "sum",
    });
    expect(byId["fact__expr"].numerator).toMatchObject({
      column: "value_2",
      aggregation: "sum",
    });
  });

  it("makes Fact Table names unique against existing tables", () => {
    const { groups } = groupLegacyMetricsIntoFactTables(
      [
        legacy("a", "SELECT user_id, ts AS timestamp FROM orders", {
          type: "binomial",
        }),
        legacy("b", "SELECT user_id, created AS timestamp FROM orders", {
          type: "binomial",
        }),
        legacy("c", "SELECT user_id, updated AS timestamp FROM orders", {
          type: "binomial",
        }),
      ],
      {
        ...options(),
        existingFactTables: [
          {
            id: "ftb_1",
            name: "Orders",
            sql: "SELECT user_id, other AS timestamp FROM orders",
            userIdTypes: ["user_id"],
          },
          {
            id: "ftb_2",
            name: "orders (2)",
            sql: "SELECT user_id, another AS timestamp FROM orders",
            userIdTypes: ["user_id"],
          },
        ],
      },
    );
    // "orders" and "orders (2)" are taken, case-insensitively
    expect(groups.map((g) => g.factTable.name)).toEqual([
      "orders (3)",
      "orders (4)",
      "orders (5)",
    ]);
  });

  it("allows any metric type as an intermediate funnel step", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        // Legacy never read an intermediate step's value, only whether the
        // user had a row, so a count metric mid-chain is a faithful gate
        legacy("spend", "SELECT user_id, timestamp, v AS value FROM t"),
        legacy("cart", "SELECT user_id, timestamp FROM t WHERE e = 'cart'", {
          type: "binomial",
          denominator: "spend",
        }),
        legacy("buy", "SELECT user_id, timestamp FROM t WHERE e = 'buy'", {
          type: "binomial",
          denominator: "cart",
        }),
        // The final metric's value IS used by legacy, so a funnel would lose it
        legacy("rev", "SELECT user_id, timestamp, v AS value FROM t", {
          type: "revenue",
          denominator: "cart",
        }),
      ],
      options(),
    );
    const byId = Object.fromEntries(
      groups.flatMap((g) => g.metrics).map((m) => [m.id, m]),
    );
    expect(byId["fact__buy"]).toMatchObject({
      metricType: "funnel",
      // A metric-level window would also cap each step from exposure
      windowSettings: { type: "", windowValue: 0 },
    });
    expect(byId["fact__buy"].funnelSettings?.steps.map((s) => s.name)).toEqual([
      "Metric spend",
      "Metric cart",
      "Metric buy",
    ]);
    // Each Fact Metric replaces only the metric it was converted from
    expect(byId["fact__buy"].replaces).toEqual(["buy"]);
    expect(errors).toEqual([
      {
        metricId: "rev",
        error:
          "A funnel counts users, so this revenue metric's value would be lost. Rebuild it by hand as a ratio if that is what you want.",
      },
    ]);
  });

  it("converts a single binomial denominator step into a ratio", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("cart", "SELECT user_id, timestamp FROM t WHERE e = 'cart'", {
          type: "binomial",
        }),
        legacy("rev", "SELECT user_id, timestamp, amount AS value FROM t", {
          type: "revenue",
          denominator: "cart",
          cappingSettings: { type: "absolute", value: 100 },
        }),
      ],
      options(),
    );
    expect(errors).toEqual([]);
    const byId = Object.fromEntries(
      groups.flatMap((g) => g.metrics).map((m) => [m.id, m]),
    );
    expect(byId["fact__rev"]).toMatchObject({
      metricType: "ratio",
      numerator: { column: "amount", aggregation: "sum" },
      denominator: { column: "$$distinctUsers" },
      cappingSettings: { type: "absolute", value: 100 },
    });
    expect(byId["fact__rev"].denominator?.rowFilters).toEqual([
      { column: "e", operator: "=", values: ["cart"] },
    ]);
    expect(byId["fact__cart"]).toMatchObject({ metricType: "proportion" });
  });

  it("makes a ratio over a binomial denominator migrated in an earlier run", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("rev", "SELECT user_id, timestamp, v AS value FROM t", {
          type: "revenue",
          denominator: "cart",
        }),
      ],
      {
        ...options(),
        getMigratedFactMetric: (id) =>
          id === "cart" ? migrated("cart") : undefined,
      },
    );
    expect(errors).toEqual([]);
    expect(groups.flatMap((g) => g.metrics)[0]).toMatchObject({
      metricType: "ratio",
      denominator: { factTableId: "ftb_old", column: "$$distinctUsers" },
    });
  });

  it("still refuses a non-binomial metric over a longer binomial chain", () => {
    const { errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("view", "SELECT user_id, timestamp FROM t", {
          type: "binomial",
        }),
        legacy("cart", "SELECT user_id, timestamp FROM t", {
          type: "binomial",
          denominator: "view",
        }),
        legacy("rev", "SELECT user_id, timestamp, v AS value FROM t", {
          type: "revenue",
          denominator: "cart",
        }),
      ],
      options(),
    );
    expect(errors).toEqual([
      {
        metricId: "rev",
        error:
          "A funnel counts users, so this revenue metric's value would be lost. Rebuild it by hand as a ratio if that is what you want.",
      },
    ]);
  });

  it("rebuilds a funnel from a denominator migrated in an earlier run", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("buy", "SELECT user_id, timestamp FROM t WHERE e = 'buy'", {
          type: "binomial",
          denominator: "cart",
        }),
      ],
      {
        ...options(),
        getMigratedFactMetric: (id) =>
          id === "cart" ? migrated("cart") : undefined,
      },
    );
    expect(errors).toEqual([]);
    const buy = groups.flatMap((g) => g.metrics)[0];
    expect(buy).toMatchObject({ metricType: "funnel" });
    expect(buy.funnelSettings?.steps).toEqual([
      {
        name: "Fact cart",
        factTableId: "ftb_old",
        rowFilters: [{ column: "e", operator: "=", values: ["cart"] }],
        optional: false,
        conversionWindow: { unit: "hours", value: 72 },
      },
      expect.objectContaining({ name: "Metric buy", factTableId: "ft_1" }),
    ]);
  });

  it("extends a funnel that was itself migrated in an earlier run", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("buy", "SELECT user_id, timestamp FROM t", {
          type: "binomial",
          denominator: "cart",
        }),
      ],
      {
        ...options(),
        getMigratedFactMetric: (id) =>
          id === "cart"
            ? {
                ...migrated("cart"),
                metricType: "funnel" as const,
                numerator: null,
                funnelSettings: {
                  steps: [
                    step("Fact view", "ftb_a"),
                    step("Fact cart", "ftb_old"),
                  ],
                },
              }
            : undefined,
      },
    );
    expect(errors).toEqual([]);
    const buy = groups.flatMap((g) => g.metrics)[0];
    expect(buy.funnelSettings?.steps.map((s) => s.name)).toEqual([
      "Fact view",
      "Fact cart",
      "Metric buy",
    ]);
  });

  it("uses a migrated non-binomial denominator as a ratio denominator", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("rev", "SELECT user_id, timestamp, v AS value FROM t", {
          type: "revenue",
          denominator: "orders",
        }),
      ],
      {
        ...options(),
        getMigratedFactMetric: (id) =>
          id === "orders"
            ? { ...migrated("orders"), metricType: "mean" as const }
            : undefined,
      },
    );
    expect(errors).toEqual([]);
    const rev = groups.flatMap((g) => g.metrics)[0];
    expect(rev).toMatchObject({
      metricType: "ratio",
      denominator: { factTableId: "ftb_old", column: "$$distinctUsers" },
    });
  });

  it("still fails when a denominator has no Fact Metric to rebuild from", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("buy", "SELECT user_id, timestamp FROM t", {
          type: "binomial",
          denominator: "cart",
        }),
      ],
      options(),
    );
    expect(groups).toHaveLength(0);
    expect(errors).toEqual([
      {
        metricId: "buy",
        error: "Denominator metric cart could not be converted",
      },
    ]);
  });

  it("rejects a migrated denominator that is itself a ratio", () => {
    const { errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("rev", "SELECT user_id, timestamp, v AS value FROM t", {
          type: "revenue",
          denominator: "orders",
        }),
      ],
      {
        ...options(),
        getMigratedFactMetric: (id) =>
          id === "orders"
            ? { ...migrated("orders"), metricType: "ratio" as const }
            : undefined,
      },
    );
    expect(errors).toEqual([
      {
        metricId: "rev",
        error: "Nested denominators are only supported for binomial funnels",
      },
    ]);
  });

  it("drops owner ids that are no longer organization members", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("gone", "SELECT user_id, timestamp FROM t", {
          type: "binomial",
          owner: "u_gone",
        }),
        legacy("here", "SELECT user_id, ts AS timestamp FROM t", {
          type: "binomial",
          owner: "u_here",
        }),
        legacy("name", "SELECT user_id, created AS timestamp FROM t", {
          type: "binomial",
          owner: "Someone Legacy",
        }),
      ],
      { ...options(), isKnownOwner: (id) => id === "u_here" },
    );
    expect(errors).toEqual([]);
    const byId = Object.fromEntries(
      groups.flatMap((g) => g.metrics).map((m) => [m.id, m.owner]),
    );
    expect(byId["fact__gone"]).toBe("");
    expect(byId["fact__here"]).toBe("u_here");
    // Emails and display names are left alone; only ids are validated
    expect(byId["fact__name"]).toBe("Someone Legacy");
  });

  it("skips metrics whose definition is synced from elsewhere", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("cfg", "SELECT user_id, timestamp FROM t", {
          type: "binomial",
          managedBy: "config",
        }),
        legacy("api", "SELECT user_id, timestamp FROM t", {
          type: "binomial",
          managedBy: "api",
        }),
        legacy("ok", "SELECT user_id, timestamp FROM t", { type: "binomial" }),
      ],
      options(),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].metrics.map((m) => m.id)).toEqual(["fact__ok"]);
    expect(errors).toEqual([
      {
        metricId: "cfg",
        error: "Defined in config.yml; migrate it there instead",
      },
      {
        metricId: "api",
        error: "Managed by the API; migrate it in the system that syncs it",
      },
    ]);
  });

  it("ignores identifier types the Data Source does not define", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("a", "SELECT user_id, device_id, timestamp FROM t", {
          type: "binomial",
          userIdTypes: ["user_id", "device_id"],
        }),
        legacy("b", "SELECT device_id, timestamp FROM t", {
          type: "binomial",
          userIdTypes: ["device_id"],
        }),
      ],
      { ...options(), userIdTypes: ["user_id", "anonymous_id"] },
    );
    expect(groups[0].factTable.userIdTypes).toEqual(["user_id"]);
    expect(groups[0].factTable.sql).toBe(
      "SELECT \n  user_id,\n  device_id,\n  timestamp\nFROM t",
    );
    expect(errors).toEqual([
      {
        metricId: "b",
        error:
          "None of the metric's identifier types (device_id) are defined on the Data Source",
      },
    ]);
  });

  it("drops user id types the SQL does not select", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("a", "SELECT anonymous_id, timestamp FROM t", {
          type: "binomial",
          userIdTypes: ["anonymous_id", "user_id"],
        }),
        legacy("b", "SELECT device_id, timestamp FROM t", {
          type: "binomial",
          userIdTypes: ["anonymous_id", "user_id"],
        }),
      ],
      options(),
    );
    expect(groups[0].factTable.userIdTypes).toEqual(["anonymous_id"]);
    expect(errors).toEqual([
      {
        metricId: "b",
        error: "SQL does not select any user id column (anonymous_id, user_id)",
      },
    ]);
  });

  it("converts query-builder metrics through synthesized SQL", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("bin", "", {
          queryFormat: "builder",
          type: "binomial",
          table: "events",
          userIdTypes: ["user_id", "anonymous_id"],
          userIdColumns: { user_id: "uid" },
          conditions: [{ column: "event", operator: "=", value: "it's" }],
        }),
        legacy("cnt", "", {
          queryFormat: "builder",
          table: "events",
          timestampColumn: "ts",
          userIdColumns: { user_id: "uid" },
        }),
        legacy("rev", "", {
          queryFormat: "builder",
          type: "revenue",
          table: "public.events",
          column: "amount",
          userIdColumns: { user_id: "uid" },
          conditions: [{ column: "event", operator: "~", value: "^buy" }],
        }),
        legacy("js", "", {
          queryFormat: "builder",
          type: "binomial",
          table: "events",
          conditions: [{ column: "event", operator: "=>", value: "x" }],
        }),
      ],
      { ...options(), defaultSchema: "public" },
    );
    expect(errors).toEqual([
      { metricId: "js", error: "Custom javascript conditions are not SQL" },
    ]);
    expect(
      groups.map((g) => [g.factTable.sql, g.metrics.map((m) => m.id)]),
    ).toEqual([
      [
        "SELECT \n  uid AS user_id,\n  anonymous_id,\n  received_at AS timestamp\nFROM public.events\nWHERE (event = 'it''s')",
        ["fact__bin"],
      ],
      [
        "SELECT \n  uid AS user_id,\n  ts AS timestamp\nFROM public.events",
        ["fact__cnt"],
      ],
      [
        "SELECT \n  uid AS user_id,\n  received_at AS timestamp,\n  amount\nFROM public.events\nWHERE (event ~ '^buy')",
        ["fact__rev"],
      ],
    ]);
    const byId = Object.fromEntries(
      groups.flatMap((g) => g.metrics).map((m) => [m.id, m]),
    );
    // A single-metric table elevates every filter into the SQL
    expect(byId["fact__bin"].numerator).toMatchObject({
      column: "$$distinctUsers",
      rowFilters: [],
    });
    expect(groups[0].factTable.name).toBe("events - it's");
    expect(byId["fact__cnt"].numerator).toMatchObject({ column: "$$count" });
    expect(byId["fact__rev"].numerator).toMatchObject({
      column: "amount",
      aggregation: "max",
    });
  });

  it("reports unconvertible metrics without blocking the batch", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("ok", "SELECT user_id, timestamp FROM t", { type: "binomial" }),
        legacy("cte", "WITH x AS (SELECT 1) SELECT user_id, timestamp FROM x"),
        legacy("nots", "SELECT user_id, v AS value FROM t"),
        legacy("nouid", "SELECT anonymous_id, timestamp FROM t", {
          type: "binomial",
        }),
        legacy("noval", "SELECT user_id, timestamp FROM t"),
        legacy("builder", "", { queryFormat: "builder" }),
      ],
      options(),
    );
    expect(groups).toHaveLength(1);
    expect(errors.map((e) => e.metricId)).toEqual([
      "cte",
      "nots",
      "nouid",
      "noval",
      "builder",
    ]);
  });

  it("elevates filters shared by every metric and names tables after them", () => {
    const { groups } = groupLegacyMetricsIntoFactTables(
      [
        legacy(
          "a",
          "SELECT user_pseudo_id AS user_id, ts AS timestamp FROM `p.d.events` WHERE event_name = 'orders' AND e.status = 'paid'",
          { type: "binomial" },
        ),
        legacy(
          "b",
          "SELECT user_pseudo_id AS user_id, ts AS timestamp, v AS value FROM `p.d.events` WHERE e.status IN ('paid', 'refunded') AND event_name = 'orders'",
        ),
        legacy(
          "c",
          "SELECT user_pseudo_id AS user_id, created AS timestamp FROM `p.d.events` WHERE event_name = 'orders'",
          { type: "binomial" },
        ),
        legacy(
          "d",
          "SELECT user_id, ts AS timestamp FROM (SELECT * FROM x) sub",
          {
            type: "binomial",
            name: "Subquery metric",
          },
        ),
      ],
      { ...options(), datasourceType: "bigquery" },
    );
    expect(groups.map((g) => [g.factTable.name, g.factTable.sql])).toEqual([
      [
        "events - orders",
        "SELECT \n  user_pseudo_id AS user_id,\n  ts AS timestamp,\n  v,\n  e.status\nFROM `p.d.events`\nWHERE (event_name = 'orders')",
      ],
      [
        "events - orders (2)",
        "SELECT \n  user_pseudo_id AS user_id,\n  created AS timestamp\nFROM `p.d.events`\nWHERE (event_name = 'orders')",
      ],
      [
        "Subquery metric",
        "SELECT \n  user_id,\n  ts AS timestamp\nFROM (SELECT * FROM x) sub",
      ],
    ]);
    expect(groups[0].metrics.map((m) => m.numerator.rowFilters)).toEqual([
      [{ operator: "=", column: "status", values: ["paid"] }],
      [{ operator: "in", column: "status", values: ["paid", "refunded"] }],
    ]);
    expect(groups[0].factTable.columns?.map((c) => c.column)).toEqual([
      "user_id",
      "timestamp",
      "v",
      "status",
    ]);
  });

  it("copies metric settings and derives fact table metadata", () => {
    const { groups } = groupLegacyMetricsIntoFactTables(
      [
        legacy("a", "SELECT user_id, timestamp, v AS value FROM t", {
          type: "revenue",
          tags: ["x"],
          projects: ["p1"],
          inverse: true,
          status: "archived",
          winRisk: 0.1,
          regressionAdjustmentEnabled: true,
          managedBy: "admin",
        }),
        legacy("b", "SELECT user_id, timestamp FROM t", {
          type: "binomial",
          tags: ["y"],
          projects: ["p2"],
        }),
      ],
      options(),
    );
    const [g] = groups;
    expect(g.factTable).toMatchObject({
      tags: ["x", "y"],
      projects: ["p1", "p2"],
      organization: "org",
      datasource: "ds",
    });
    expect(
      g.factTable.columns?.find((c) => c.column === "v")?.numberFormat,
    ).toBe("currency");
    expect(g.metrics[0]).toMatchObject({
      inverse: true,
      archived: true,
      winRisk: 0.1,
      loseRisk: 0.0125,
      regressionAdjustmentEnabled: true,
      managedBy: "",
      tags: ["x"],
      projects: ["p1"],
    });
  });

  it("keeps CTEs in the fact table SQL and in the grouping key", () => {
    const cte = "WITH a AS (SELECT uid, ts FROM b)";
    const other = "WITH a AS (SELECT uid, ts FROM c)";
    const tail = "SELECT uid AS user_id, ts AS timestamp FROM a WHERE x = 'y'";
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("m1", `${cte} ${tail}`, { type: "binomial" }),
        legacy("m2", `${cte} ${tail}`, { type: "binomial" }),
        legacy("m3", `${other} ${tail}`, { type: "binomial" }),
      ],
      options(),
    );
    expect(errors).toEqual([]);
    expect(groups).toHaveLength(2);
    expect(groups[0].metrics.map((m) => m.id)).toEqual([
      "fact__m1",
      "fact__m2",
    ]);
    expect(groups[0].factTable.sql).toBe(
      `${cte}\nSELECT \n  uid AS user_id,\n  ts AS timestamp\nFROM a\nWHERE (x = 'y')`,
    );
    expect(groups[1].factTable.sql.startsWith(other)).toBe(true);
  });

  it("wraps a set operation as the fact table row source", () => {
    const sql =
      "SELECT a AS user_id, b AS timestamp FROM t WHERE x = 1 UNION ALL SELECT c AS user_id, d AS timestamp FROM v";
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [legacy("m1", sql, { type: "binomial" })],
      options(),
    );
    expect(errors).toEqual([]);
    expect(groups[0].factTable.sql).toBe(
      `SELECT \n  user_id,\n  timestamp\nFROM (${sql}) u`,
    );
    expect(groups[0].factTable.columns?.map((c) => c.column)).toEqual([
      "user_id",
      "timestamp",
    ]);
    // The branch filters are already applied inside, so none are re-applied
    expect(groups[0].metrics[0].numerator.rowFilters ?? []).toEqual([]);
  });

  it("keeps SELECT * SQL verbatim and assumes the legacy column names", () => {
    const { groups, errors } = groupLegacyMetricsIntoFactTables(
      [
        legacy("m1", "SELECT * FROM t WHERE a = 'b'", {
          userIdTypes: ["user_id", "anonymous_id"],
          aggregation: "COUNT(value)",
        }),
        legacy("m2", "SELECT * FROM t WHERE a = 'c'", { type: "binomial" }),
      ],
      options(),
    );
    expect(errors).toEqual([]);
    // Different filters live inside the SQL, so the two cannot share a table
    expect(groups).toHaveLength(2);
    expect(groups[0].factTable.sql).toBe("SELECT * FROM t WHERE a = 'b'");
    expect(groups[0].factTable.columns?.map((c) => c.column)).toEqual([
      "user_id",
      "anonymous_id",
      "timestamp",
      "value",
    ]);
    expect(groups[0].factTable.userIdTypes).toEqual([
      "user_id",
      "anonymous_id",
    ]);
    // COUNT(value) skips nulls, and verbatim SQL has no WHERE to elevate it to
    expect(groups[0].metrics[0].numerator.rowFilters).toEqual([
      { operator: "not_null", column: "value" },
    ]);
    expect(groups[1].factTable.sql).toBe("SELECT * FROM t WHERE a = 'c'");
    // A binomial metric needs no value column
    expect(groups[1].factTable.columns?.map((c) => c.column)).toEqual([
      "user_id",
      "timestamp",
    ]);
  });
});
