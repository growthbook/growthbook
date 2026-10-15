import type { PopulationStep } from "shared/validators";
import {
  bigQueryDialect,
  clickHouseDialect,
  postgresDialect,
  snowflakeDialect,
} from "shared/dialects";
import { buildPopulationSizeSql } from "shared/populations-sql";
import type {
  ColumnInterface,
  FactTableInterface,
} from "shared/types/fact-table";

// Representative Populations, each exercising a different way of querying the
// warehouse. The snapshots are the SQL to review when the builder changes.

function column(
  name: string,
  datatype: ColumnInterface["datatype"],
  extra: Partial<ColumnInterface> = {},
): ColumnInterface {
  return {
    column: name,
    name,
    datatype,
    description: "",
    numberFormat: "",
    deleted: false,
    dateCreated: new Date(0),
    dateUpdated: new Date(0),
    ...extra,
  };
}

function factTable(
  table: Pick<FactTableInterface, "id" | "name" | "sql" | "columns"> &
    Partial<FactTableInterface>,
): FactTableInterface {
  return {
    organization: "org_1",
    datasource: "ds_1",
    description: "",
    owner: "",
    projects: [],
    tags: [],
    eventName: "",
    filters: [],
    userIdTypes: ["user_id"],
    timestampColumn: "timestamp",
    dateCreated: new Date(0),
    dateUpdated: new Date(0),
    ...table,
  };
}

const signups = factTable({
  id: "ftb_signups",
  name: "Signups",
  sql: "SELECT user_id, created_at AS timestamp, plan FROM app.signups",
  columns: [
    column("user_id", "string"),
    column("timestamp", "date"),
    column("plan", "string"),
  ],
});

const orders = factTable({
  id: "ftb_orders",
  name: "Orders",
  sql: "SELECT user_id, ordered_at AS timestamp, revenue, country FROM shop.orders",
  columns: [
    column("user_id", "string"),
    column("timestamp", "date"),
    column("revenue", "number"),
    column("country", "string"),
  ],
});

// An event stream keyed by a differently named id column, with a JSON
// properties column.
const events = factTable({
  id: "ftb_events",
  name: "Events",
  sql: "SELECT uid, event_time, event_name, path, properties FROM analytics.events",
  timestampColumn: "event_time",
  userIdColumns: { user_id: "uid" },
  columns: [
    column("uid", "string"),
    column("event_time", "date"),
    column("event_name", "string"),
    column("path", "string"),
    column("properties", "json", {
      jsonFields: { seconds_active: { datatype: "number" } },
    }),
  ],
});

const factTableMap = new Map(
  [signups, orders, events].map((ft) => [ft.id, ft]),
);

type Window = PopulationStep["windowSettings"];
const anyTime: Window = {
  type: "",
  delayValue: 0,
  delayUnit: "days",
  windowValue: 0,
  windowUnit: "days",
};
const lastDays = (windowValue: number): Window => ({
  ...anyTime,
  type: "lookback",
  windowValue,
});
const withinAfter = (
  windowValue: number,
  windowUnit: Window["windowUnit"] = "days",
): Window => ({ ...anyTime, type: "conversion", windowValue, windowUnit });

function step(
  factTableId: string,
  extra: Partial<PopulationStep> = {},
): PopulationStep {
  return {
    source: { type: "factTable", factTableId },
    rowFilters: [],
    windowSettings: anyTime,
    ...extra,
  };
}

const examples: { name: string; steps: PopulationStep[] }[] = [
  {
    // One fact table, bounded scan: the lookback becomes a scan lower bound.
    name: "Ordered in the last 30 days",
    steps: [step(orders.id, { windowSettings: lastDays(30) })],
  },
  {
    // Negation over all history: an anti-join (NOT IN) and a full scan.
    name: "Signed up, never ordered",
    steps: [step(signups.id), step(orders.id, { negation: true })],
  },
  {
    // Conversion windows chained across fact tables, with two steps sharing
    // the events table so their row filters are OR-ed into one scan, a mapped
    // id column, and step 1's lookback bounding every scan.
    name: "Activated within a week of signing up",
    steps: [
      step(signups.id, {
        windowSettings: lastDays(90),
        rowFilters: [{ operator: "=", column: "plan", values: ["free"] }],
      }),
      step(events.id, {
        windowSettings: withinAfter(24, "hours"),
        rowFilters: [
          { operator: "=", column: "event_name", values: ["page_view"] },
          { operator: "=", column: "path", values: ["/pricing"] },
        ],
      }),
      step(events.id, {
        windowSettings: withinAfter(7),
        rowFilters: [
          { operator: "=", column: "event_name", values: ["trial_started"] },
        ],
      }),
    ],
  },
  {
    // Aggregate thresholds: running totals pick the row where each threshold
    // is first met, and that row anchors the next step.
    name: "Spent $500, then ordered twice more",
    steps: [
      step(orders.id, {
        windowSettings: lastDays(180),
        rowFilters: [
          { operator: "in", column: "country", values: ["US", "CA"] },
        ],
        aggregateFilter: ">=500",
        aggregateFilterColumn: "revenue",
      }),
      step(orders.id, {
        aggregateFilter: ">=2",
        aggregateFilterColumn: "$$count",
      }),
    ],
  },
  {
    // A filter that accepts zero rows keeps users with none (UNION ALL with a
    // typed NULL), summing a JSON sub-field.
    name: "Signed up, then under 10 minutes active in their first week",
    steps: [
      step(signups.id, { windowSettings: lastDays(60) }),
      step(events.id, {
        windowSettings: withinAfter(7),
        rowFilters: [
          { operator: "=", column: "event_name", values: ["session_end"] },
        ],
        aggregateFilter: "<600",
        aggregateFilterColumn: "properties.seconds_active",
      }),
    ],
  },
  {
    // Lapsed users: a negated lookback after a positive step, then a negated
    // aggregate. Later steps anchor on step 1 since negations record no date.
    name: "Bought before, but no visits or orders lately",
    steps: [
      step(orders.id),
      step(events.id, {
        negation: true,
        windowSettings: lastDays(30),
        rowFilters: [
          { operator: "=", column: "event_name", values: ["page_view"] },
        ],
      }),
      step(orders.id, {
        negation: true,
        windowSettings: lastDays(90),
        aggregateFilter: ">=1",
        aggregateFilterColumn: "$$count",
      }),
    ],
  },
];

const asOf = new Date("2026-10-15T00:00:00Z");

function sizeSql(steps: PopulationStep[], dialect = postgresDialect): string {
  return buildPopulationSizeSql({
    population: { datasource: "ds_1", userIdTypes: ["user_id"], steps },
    factTableMap,
    dialect,
    idType: "user_id",
    asOf,
  });
}

describe("example Population SQL", () => {
  it.each(examples)("$name", ({ steps }) => {
    expect(sizeSql(steps)).toMatchSnapshot();
  });

  const example = (name: string) => {
    const found = examples.find((e) => e.name === name);
    if (!found) throw new Error(`Example ${name} not found`);
    return found;
  };

  it.each([
    ["BigQuery", bigQueryDialect],
    ["Snowflake", snowflakeDialect],
    ["ClickHouse", clickHouseDialect],
  ])("Activated within a week of signing up on %s", (_name, dialect) => {
    const { steps } = example("Activated within a week of signing up");
    expect(sizeSql(steps, dialect)).toMatchSnapshot();
  });

  // The typed NULL for units with no rows must match BigQuery's DATETIME.
  it("Signed up, then under 10 minutes active in their first week on BigQuery", () => {
    const { steps } = example(
      "Signed up, then under 10 minutes active in their first week",
    );
    expect(sizeSql(steps, bigQueryDialect)).toMatchSnapshot();
  });
});
