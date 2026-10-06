import { postgresDialect } from "shared/dialects";
import type { PopulationStep } from "shared/validators";
import {
  buildPopulationSql,
  parsePopulationAggregateFilter,
  parsePopulationSnapshotRows,
  type PopulationSqlFactTable,
} from "shared/populations";
import type { SqlDialect } from "shared/types/sql";

// Skip sql-formatter so assertions don't depend on formatter output.
const dialect: SqlDialect = { ...postgresDialect, formatDialect: "" };
const asOf = new Date("2026-10-06T00:00:00Z");

const events: PopulationSqlFactTable = {
  id: "ft_events",
  sql: "SELECT user_id, anonymous_id, timestamp, event_name FROM events",
  userIdTypes: ["user_id", "anonymous_id"],
  filters: [],
  columns: [],
};
const orders: PopulationSqlFactTable = {
  id: "ft_orders",
  sql: "SELECT uid, created_at, revenue FROM orders",
  userIdTypes: ["user_id"],
  userIdColumns: { user_id: "uid" },
  timestampColumn: "created_at",
  filters: [],
  columns: [],
};
const factTableMap = new Map([
  [events.id, events],
  [orders.id, orders],
]);

const noWindow: PopulationStep["windowSettings"] = {
  type: "",
  delayValue: 0,
  delayUnit: "days",
  windowValue: 0,
  windowUnit: "days",
};

function step(
  factTableId: string,
  overrides: Partial<PopulationStep> = {},
): PopulationStep {
  return {
    source: { type: "factTable", factTableId },
    rowFilters: [],
    windowSettings: noWindow,
    ...overrides,
  };
}

function build(steps: PopulationStep[], userIdType = "user_id") {
  return buildPopulationSql({
    steps,
    userIdType,
    factTableMap,
    dialect,
    asOf,
  });
}

describe("buildPopulationSql", () => {
  it("checks membership now and 30 days earlier", () => {
    const sql = build([step("ft_events")]);
    expect(sql).toContain(
      "SELECT 0 AS period, CAST('2026-10-06 00:00:00' AS TIMESTAMP) AS as_of",
    );
    expect(sql).toContain(
      "SELECT 1 AS period, CAST('2026-09-06 00:00:00' AS TIMESTAMP) AS as_of",
    );
    expect(sql).toContain("CROSS JOIN __pop_as_of p");
    expect(sql).toContain(
      "SELECT period, as_of, unit_id, MIN(ts) AS step_ts\nFROM __pop_s1_rows",
    );
    expect(sql).toContain("FROM __pop_s1\nGROUP BY unit_id");
    expect(sql).toContain(
      "SUM(CASE WHEN in_now = 1 AND in_prior = 0 THEN 1 ELSE 0 END) AS units_joined",
    );
    expect(sql).toContain(
      "SUM(CASE WHEN in_now = 0 AND in_prior = 1 THEN 1 ELSE 0 END) AS units_left",
    );
  });

  it("only scans fact table rows up to the as-of date", () => {
    const sql = build([step("ft_events")]);
    expect(sql).toContain(
      "WHERE timestamp <= CAST('2026-10-06 00:00:00' AS TIMESTAMP)",
    );
  });

  it("applies row filters to the step's rows", () => {
    const sql = build([
      step("ft_events", {
        rowFilters: [
          { operator: "=", column: "event_name", values: ["signup"] },
        ],
      }),
    ]);
    expect(sql).toContain("event_name = 'signup'");
  });

  it("uses the fact table's id and timestamp columns", () => {
    const sql = build([step("ft_orders")]);
    expect(sql).toContain("uid AS unit_id");
    expect(sql).toContain("created_at AS ts");
    expect(sql).toContain(
      "WHERE created_at <= CAST('2026-10-06 00:00:00' AS TIMESTAMP)",
    );
  });

  it("selects the requested identifier type", () => {
    const sql = build([step("ft_events")], "anonymous_id");
    expect(sql).toContain("anonymous_id AS unit_id");
  });

  it("limits a lookback step to the window before each as-of date", () => {
    const sql = build([
      step("ft_events", {
        windowSettings: {
          ...noWindow,
          type: "lookback",
          windowValue: 7,
          windowUnit: "days",
        },
      }),
    ]);
    expect(sql).toContain("e.ts > p.as_of - INTERVAL '168 hours'");
  });

  it("orders later steps after the previous step", () => {
    const sql = build([step("ft_events"), step("ft_orders")]);
    expect(sql).toContain(
      "FROM __pop_s1 p\nJOIN __pop_s2_events e ON e.unit_id = p.unit_id",
    );
    expect(sql).toContain("e.ts >= p.step_ts");
    expect(sql).not.toContain("e.ts <= p.step_ts");
    // ClickHouse keeps the `e.` prefix on joined columns unless aliased.
    expect(sql).toContain("e.unit_id AS unit_id");
    expect(sql).toContain("FROM __pop_s2\nGROUP BY unit_id");
  });

  it("bounds a conversion step by its delay and window", () => {
    const sql = build([
      step("ft_events"),
      step("ft_orders", {
        windowSettings: {
          type: "conversion",
          delayValue: 2,
          delayUnit: "hours",
          windowValue: 90,
          windowUnit: "minutes",
        },
      }),
    ]);
    expect(sql).toContain("e.ts >= p.step_ts + INTERVAL '2 hours'");
    expect(sql).toContain("e.ts <= p.step_ts + INTERVAL '210 minutes'");
  });

  it("completes a lower-bound aggregate step when the running total crosses it", () => {
    const sql = build([
      step("ft_events", {
        aggregateFilter: ">=3",
        aggregateFilterColumn: "$$count",
      }),
    ]);
    expect(sql).toContain("1 AS value");
    expect(sql).toContain("PARTITION BY period, unit_id");
    expect(sql).toContain("ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW");
    expect(sql).toContain("WHERE running_value >= 3");
  });

  it("sums a column for a column aggregate", () => {
    const sql = build([
      step("ft_orders", {
        aggregateFilter: ">100, >=50",
        aggregateFilterColumn: "revenue",
      }),
    ]);
    expect(sql).toContain("revenue AS value");
    expect(sql).toContain("WHERE running_value > 100 AND running_value >= 50");
  });

  it("checks the window's total for other aggregate filters", () => {
    const sql = build([
      step("ft_events", {
        aggregateFilter: "<3",
        aggregateFilterColumn: "$$count",
      }),
    ]);
    expect(sql).not.toContain("running_value");
    expect(sql).toContain("MAX(ts) AS step_ts");
    expect(sql).toContain("HAVING SUM(value) < 3");
  });

  it("ignores an aggregate column without an aggregate filter", () => {
    const sql = build([
      step("ft_orders", { aggregateFilterColumn: "revenue" }),
    ]);
    expect(sql).toContain("1 AS value");
    expect(sql).not.toContain("HAVING");
  });

  it("rejects a conversion window on the first step", () => {
    expect(() =>
      build([
        step("ft_events", {
          windowSettings: { ...noWindow, type: "conversion", windowValue: 1 },
        }),
      ]),
    ).toThrow("The first step cannot use a conversion window");
  });

  it("rejects a missing fact table", () => {
    expect(() => build([step("ft_gone")])).toThrow(
      "Fact table ft_gone not found",
    );
  });

  it("rejects an identifier type the fact table doesn't support", () => {
    expect(() =>
      build([step("ft_events"), step("ft_orders")], "anonymous_id"),
    ).toThrow(
      "Fact table ft_orders does not support identifier type anonymous_id",
    );
  });

  it("rejects a population without steps", () => {
    expect(() => build([])).toThrow("Populations require at least 1 step");
  });
});

describe("parsePopulationAggregateFilter", () => {
  it("parses comma-separated conditions and ignores whitespace", () => {
    expect(parsePopulationAggregateFilter(" >= 3, <10.5 ")).toEqual([
      { operator: ">=", value: "3" },
      { operator: "<", value: "10.5" },
    ]);
  });

  it("rejects anything that isn't an operator and a number", () => {
    expect(() => parsePopulationAggregateFilter(">=3; DROP TABLE x")).toThrow(
      "Invalid aggregate filter",
    );
  });
});

describe("parsePopulationSnapshotRows", () => {
  it("reads counts that warehouses return as strings", () => {
    expect(
      parsePopulationSnapshotRows([
        {
          members_now: "120",
          members_prior: 100,
          units_joined: "30",
          units_left: 10,
        },
      ]),
    ).toEqual({ membersNow: 120, membersPrior: 100, joined: 30, left: 10 });
  });

  it("treats an empty population as zero", () => {
    expect(
      parsePopulationSnapshotRows([
        {
          members_now: null,
          members_prior: null,
          units_joined: null,
          units_left: null,
        },
      ]),
    ).toEqual({ membersNow: 0, membersPrior: 0, joined: 0, left: 0 });
    expect(parsePopulationSnapshotRows([])).toEqual({
      membersNow: 0,
      membersPrior: 0,
      joined: 0,
      left: 0,
    });
  });
});
