import { postgresDialect } from "shared/dialects";
import type { SqlDialect } from "shared/types/sql";
import type { PopulationStep } from "shared/validators";
import type {
  ColumnInterface,
  FactTableInterface,
  RowFilter,
} from "shared/types/fact-table";
import {
  getPopulationMembershipPoints,
  POPULATION_MEMBERSHIP_SUMMARY_POINT_ID,
  PopulationMembershipPoint,
} from "back-end/src/integrations/sql/dates/population-membership-points";
import {
  getPopulationMembershipQuery,
  isPopulationSupportedDatasourceType,
  PopulationMembershipQueryParams,
} from "back-end/src/integrations/sql/queries/population-membership-query";

// Skip sql-formatter so expected SQL stays stable across formatter upgrades.
const dialect: SqlDialect = { ...postgresDialect, formatDialect: "" };
const day = dialect.dateTrunc("timestamp", "day");

function column(
  name: string,
  datatype: ColumnInterface["datatype"],
): ColumnInterface {
  return {
    dateCreated: new Date(0),
    dateUpdated: new Date(0),
    name,
    description: "",
    column: name,
    datatype,
    numberFormat: "",
    deleted: false,
  };
}

const orders: FactTableInterface = {
  id: "ftb_orders",
  organization: "org_1",
  name: "Orders",
  datasource: "ds_1",
  sql: "SELECT user_id, timestamp, amount, status FROM orders",
  userIdTypes: ["user_id"],
  dateCreated: new Date(0),
  dateUpdated: new Date(0),
  description: "",
  eventName: "",
  owner: "",
  projects: [],
  tags: [],
  filters: [
    {
      id: "flt_paid",
      dateCreated: new Date(0),
      dateUpdated: new Date(0),
      name: "Paid",
      description: "",
      value: "status = 'paid'",
    },
  ],
  columns: [
    column("user_id", "string"),
    column("timestamp", "date"),
    column("amount", "number"),
    column("status", "string"),
  ],
};

function windowSettings(
  overrides: Partial<PopulationStep["windowSettings"]> = {},
): PopulationStep["windowSettings"] {
  return {
    type: "",
    delayValue: 0,
    delayUnit: "days",
    windowValue: 0,
    windowUnit: "days",
    ...overrides,
  };
}

function step(rowFilters: RowFilter[] = []): PopulationStep {
  return {
    source: { type: "factTable", factTableId: orders.id },
    rowFilters,
    windowSettings: windowSettings(),
  };
}

const asOf = new Date("2026-10-20T00:00:00Z");

function buildSql(
  steps: PopulationStep[],
  overrides: Partial<PopulationMembershipQueryParams> = {},
): string {
  // Collapse whitespace so assertions don't depend on template indentation.
  return getPopulationMembershipQuery(dialect, {
    steps,
    userIdType: "user_id",
    factTableMap: new Map([[orders.id, orders]]),
    points: getPopulationMembershipPoints(asOf),
    ...overrides,
  }).replace(/\s+/g, " ");
}

describe("getPopulationMembershipQuery", () => {
  const end = dialect.toTimestamp(asOf);

  it("reads the fact table once, up to the latest date", () => {
    const sql = buildSql([step()]);

    expect(sql.match(/FROM orders/g)).toHaveLength(1);
    expect(sql).toContain(
      `__factTable AS ( SELECT * FROM ( ${orders.sql} ) t WHERE timestamp < ${end} )`,
    );
  });

  it("lists every point with the date it's compared against", () => {
    const sql = buildSql([step()]);

    expect(sql).toContain(
      `SELECT 'summary' AS point_id, ${end} AS as_of, ${dialect.toTimestamp(new Date("2026-09-20T00:00:00Z"))} AS prev_as_of`,
    );
    expect(sql).toContain("SELECT 'week_51' AS point_id");
  });

  it("joins a unit on its first matching day", () => {
    const sql = buildSql([step()]);

    expect(sql).toContain(
      `__joins AS ( SELECT user_id AS unit, MIN(${day}) AS joined_at FROM __factTable GROUP BY user_id )`,
    );
    expect(sql).not.toContain("running_total");
  });

  it("counts members and joins at each point from the join days", () => {
    const sql = buildSql([step()]);

    expect(sql).toContain(
      "SELECT joined_at, COUNT(*) AS units FROM __joins GROUP BY joined_at",
    );
    expect(sql).toContain("SUM(j.units) AS members_count");
    expect(sql).toContain(
      "SUM(CASE WHEN j.joined_at >= p.prev_as_of THEN j.units ELSE 0 END) AS joined_count",
    );
    expect(sql).toContain("0 AS left_count");
    expect(sql).toContain("JOIN __joinCounts j ON j.joined_at < p.as_of");
  });

  describe("row filters", () => {
    it("applies a row filter", () => {
      const sql = buildSql([
        step([{ column: "status", operator: "=", values: ["paid"] }]),
      ]);

      expect(sql).toContain(`WHERE timestamp < ${end} AND (status = 'paid')`);
    });

    it("applies multiple row filters with multiple values", () => {
      const sql = buildSql([
        step([
          { column: "status", operator: "in", values: ["paid", "refunded"] },
          { column: "amount", operator: ">", values: ["10"] },
        ]),
      ]);

      expect(sql).toContain(
        "AND (status IN ( 'paid', 'refunded' )) AND (amount > 10)",
      );
    });

    it("applies a saved filter", () => {
      const sql = buildSql([
        step([{ operator: "saved_filter", values: ["flt_paid"] }]),
      ]);

      expect(sql).toContain("AND (status = 'paid')");
    });

    it("throws when a saved filter doesn't exist", () => {
      expect(() =>
        buildSql([step([{ operator: "saved_filter", values: ["flt_gone"] }])]),
      ).toThrow("Unknown saved filter: flt_gone");
    });

    it("applies a SQL expression filter", () => {
      const sql = buildSql([
        step([{ operator: "sql_expr", values: ["amount > 0"] }]),
      ]);

      expect(sql).toContain("AND (amount > 0)");
    });
  });

  describe("aggregate filters", () => {
    it("joins a unit on the first day its running row count passes the filter", () => {
      const s = step();
      s.aggregateFilterColumn = "$$count";
      s.aggregateFilter = ">=3";

      const sql = buildSql([s]);

      expect(sql).toContain(
        `__unitDays AS ( SELECT user_id AS unit, ${day} AS bucket, SUM(1) AS agg_value FROM __factTable GROUP BY user_id, ${day} )`,
      );
      expect(sql).toContain(
        "SUM(agg_value) OVER (PARTITION BY unit ORDER BY bucket) AS running_total",
      );
      expect(sql).toContain(
        "__joins AS ( SELECT unit, MIN(bucket) AS joined_at FROM __runningTotals WHERE running_total >= 3 GROUP BY unit )",
      );
    });

    it("sums a column and applies every condition", () => {
      const s = step();
      s.aggregateFilterColumn = "amount";
      s.aggregateFilter = ">=3,<10";

      const sql = buildSql([s]);

      expect(sql).toContain("SUM(amount) AS agg_value");
      expect(sql).toContain("WHERE running_total >= 3 AND running_total < 10");
    });

    it("throws when the filter is invalid", () => {
      const s = step();
      s.aggregateFilterColumn = "$$count";
      s.aggregateFilter = "invalid";

      expect(() => buildSql([s])).toThrow("Invalid aggregate filter: invalid");
    });
  });

  it("throws without a step", () => {
    expect(() => buildSql([])).toThrow(
      "At least one population step is required",
    );
  });

  it("throws when the fact table is missing", () => {
    expect(() => buildSql([step()], { factTableMap: new Map() })).toThrow(
      `Unknown fact table: ${orders.id}`,
    );
  });

  it("throws on a lookback window", () => {
    const s = step();
    s.windowSettings = windowSettings({
      type: "lookback",
      windowValue: 30,
      windowUnit: "days",
    });

    expect(() => buildSql([s])).toThrow(
      "Populations don't support lookback windows yet",
    );
  });

  it("throws when a date doesn't start on a whole day", () => {
    const points: PopulationMembershipPoint[] = [
      {
        id: POPULATION_MEMBERSHIP_SUMMARY_POINT_ID,
        asOf: new Date("2026-10-20T12:00:00Z"),
        prevAsOf: new Date("2026-09-20T12:00:00Z"),
      },
    ];

    expect(() => buildSql([step()], { points })).toThrow(
      "Membership dates must start on a whole day",
    );
  });
});

describe("isPopulationSupportedDatasourceType", () => {
  it("allows warehouses with window functions", () => {
    expect(isPopulationSupportedDatasourceType("bigquery")).toBe(true);
    expect(isPopulationSupportedDatasourceType("snowflake")).toBe(true);
  });

  it("rejects the rest", () => {
    expect(isPopulationSupportedDatasourceType("mysql")).toBe(false);
    expect(isPopulationSupportedDatasourceType("mssql")).toBe(false);
  });
});
