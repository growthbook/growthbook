import {
  buildPopulationMembershipSql,
  getPopulationMembershipAsOf,
  getPopulationMembershipEndDate,
  getPopulationMembershipPoints,
  PopulationMembershipPoint,
  PopulationMembershipSqlParams,
  POPULATION_MEMBERSHIP_SUMMARY_POINT_ID,
  POPULATION_MEMBERSHIP_WEEKS,
  transformPopulationMembershipRows,
} from "shared/enterprise";
import { postgresDialect } from "shared/dialects";
import { PopulationStep } from "shared/validators";
import { SqlDialect } from "shared/types/sql";
import {
  ColumnInterface,
  FactTableInterface,
  RowFilter,
} from "shared/types/fact-table";

// Skip sql-formatter so expected SQL stays stable across formatter upgrades.
const dialect: SqlDialect = { ...postgresDialect, formatDialect: "" };

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
  overrides: Partial<PopulationMembershipSqlParams> = {},
): string {
  return buildPopulationMembershipSql({
    steps,
    userIdType: "user_id",
    factTableMap: new Map([[orders.id, orders]]),
    dialect,
    points: getPopulationMembershipPoints(asOf),
    ...overrides,
  });
}

describe("getPopulationMembershipAsOf", () => {
  it("rounds down to the most recent UTC midnight", () => {
    expect(
      getPopulationMembershipAsOf(new Date("2026-10-20T15:42:10Z")),
    ).toEqual(new Date("2026-10-20T00:00:00Z"));
  });
});

describe("getPopulationMembershipPoints", () => {
  const points = getPopulationMembershipPoints(asOf);

  it("starts with a summary point compared against 30 days earlier", () => {
    expect(points[0]).toEqual({
      id: POPULATION_MEMBERSHIP_SUMMARY_POINT_ID,
      asOf,
      prevAsOf: new Date("2026-09-20T00:00:00Z"),
    });
  });

  it("has one point per week, oldest first, each compared with the week before", () => {
    const weeks = points.slice(1);
    expect(weeks).toHaveLength(POPULATION_MEMBERSHIP_WEEKS);
    expect(weeks[weeks.length - 1]).toEqual({
      id: `week_${POPULATION_MEMBERSHIP_WEEKS - 1}`,
      asOf,
      prevAsOf: new Date("2026-10-13T00:00:00Z"),
    });
    expect(weeks[0].asOf).toEqual(
      new Date(asOf.getTime() - 51 * 7 * 24 * 60 * 60 * 1000),
    );
  });
});

describe("getPopulationMembershipEndDate", () => {
  it("is the latest point's date", () => {
    expect(
      getPopulationMembershipEndDate(getPopulationMembershipPoints(asOf)),
    ).toEqual(asOf);
  });

  it("throws without any points", () => {
    expect(() => getPopulationMembershipEndDate([])).toThrow(
      "At least one membership point is required",
    );
  });
});

describe("buildPopulationMembershipSql", () => {
  it("reads the fact table once, up to the latest date", () => {
    const sql = buildSql([step()]);

    expect(sql.match(/FROM orders/g)).toHaveLength(1);
    expect(sql).toContain(`WHERE timestamp < ${dialect.toTimestamp(asOf)}`);
    expect(sql).not.toContain("timestamp >=");
  });

  it("counts every row before each date", () => {
    expect(buildSql([step()])).toContain("WHERE r.bucket < d.as_of\n");
  });

  it("applies a row filter", () => {
    const sql = buildSql([
      step([{ column: "status", operator: "=", values: ["paid"] }]),
    ]);

    expect(sql).toContain(
      `WHERE (status = 'paid') AND timestamp < ${dialect.toTimestamp(asOf)}`,
    );
  });

  it("applies multiple row filters with multiple values", () => {
    const sql = buildSql([
      step([
        { column: "status", operator: "in", values: ["paid", "refunded"] },
        { column: "amount", operator: ">", values: ["10"] },
      ]),
    ]);

    expect(sql).toContain(
      "WHERE (status IN (\n  'paid',\n  'refunded'\n)) AND (amount > 10)",
    );
  });

  it("applies a saved filter", () => {
    const sql = buildSql([
      step([{ operator: "saved_filter", values: ["flt_paid"] }]),
    ]);

    expect(sql).toContain("WHERE (status = 'paid')");
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

    expect(sql).toContain("WHERE (amount > 0)");
  });

  it("lists every point with the date it's compared against", () => {
    const sql = buildSql([step()]);

    expect(sql).toContain(
      `SELECT 'summary' AS point_id, ${dialect.toTimestamp(asOf)} AS as_of, ${dialect.toTimestamp(new Date("2026-09-20T00:00:00Z"))} AS prev_as_of`,
    );
    expect(sql).toContain(`SELECT 'week_51' AS point_id`);
  });

  it("rolls rows up per unit per day", () => {
    const sql = buildSql([step()]);

    expect(sql).toContain(
      `SELECT user_id AS unit, ${dialect.dateTrunc("timestamp", "day")} AS bucket, SUM(1) AS agg_value`,
    );
  });

  it("applies an aggregate filter that counts rows", () => {
    const s = step();
    s.aggregateFilterColumn = "$$count";
    s.aggregateFilter = ">=3";

    expect(buildSql([s])).toContain("HAVING SUM(r.agg_value) >= 3");
  });

  it("applies an aggregate filter that sums a column", () => {
    const s = step();
    s.aggregateFilterColumn = "amount";
    s.aggregateFilter = ">=3,<10";

    const sql = buildSql([s]);

    expect(sql).toContain("SUM(amount) AS agg_value");
    expect(sql).toContain(
      "HAVING SUM(r.agg_value) >= 3 AND SUM(r.agg_value) < 10",
    );
  });

  it("has no HAVING without an aggregate filter", () => {
    expect(buildSql([step()])).not.toContain("HAVING");
  });

  it("throws when the aggregate filter is invalid", () => {
    const s = step();
    s.aggregateFilterColumn = "$$count";
    s.aggregateFilter = "invalid";

    expect(() => buildSql([s])).toThrow("Invalid aggregate filter: invalid");
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

describe("transformPopulationMembershipRows", () => {
  const points = getPopulationMembershipPoints(asOf);

  it("reads the summary and weekly counts", () => {
    const result = transformPopulationMembershipRows(points, [
      {
        point_id: "summary",
        members_count: "120",
        joined_count: 30,
        left_count: 10,
      },
      {
        point_id: "week_51",
        members_count: 120,
        joined_count: 8,
        left_count: 2,
      },
    ]);

    expect(result.asOf).toBe(asOf.toISOString());
    expect(result.summary).toEqual({
      members: 120,
      joined: 30,
      left: 10,
      comparedTo: "2026-09-20T00:00:00.000Z",
    });
    expect(result.series[result.series.length - 1]).toEqual({
      date: asOf.toISOString(),
      members: 120,
      joined: 8,
      left: 2,
    });
  });

  it("fills points without a row with zeros", () => {
    const result = transformPopulationMembershipRows(points, []);

    expect(result.series).toHaveLength(POPULATION_MEMBERSHIP_WEEKS);
    expect(result.series[0]).toEqual({
      date: points[1].asOf.toISOString(),
      members: 0,
      joined: 0,
      left: 0,
    });
  });
});
