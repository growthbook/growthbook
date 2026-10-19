import { buildPopulationSql, PopulationSqlParams } from "shared/enterprise";
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

function factTable(
  id: string,
  sql: string,
  columns: ColumnInterface[],
): FactTableInterface {
  return {
    id,
    organization: "org_1",
    name: id,
    datasource: "ds_1",
    sql,
    userIdTypes: ["user_id"],
    dateCreated: new Date(0),
    dateUpdated: new Date(0),
    description: "",
    eventName: "",
    owner: "",
    projects: [],
    tags: [],
    filters: [],
    columns,
  };
}

const events = factTable(
  "ftb_events",
  "SELECT user_id, timestamp, event_name FROM events",
  [
    column("user_id", "string"),
    column("timestamp", "date"),
    column("event_name", "string"),
  ],
);
const orders = factTable(
  "ftb_orders",
  "SELECT user_id, timestamp, amount FROM orders",
  [
    column("user_id", "string"),
    column("timestamp", "date"),
    column("amount", "number"),
  ],
);

function step(
  factTableId: string,
  rowFilters: PopulationStep["rowFilters"] = [],
): PopulationStep {
  return {
    source: { type: "factTable", factTableId },
    rowFilters,
    windowSettings: {
      type: "",
      delayValue: 0,
      delayUnit: "days",
      windowValue: 0,
      windowUnit: "days",
    },
  };
}

function buildSql(
  steps: PopulationStep[],
  overrides: Partial<PopulationSqlParams> = {},
): string {
  return buildPopulationSql({
    steps,
    userIdType: "user_id",
    factTableMap: new Map([
      [events.id, events],
      [orders.id, orders],
    ]),
    dialect,
    ...overrides,
  });
}

describe("buildPopulationSql", () => {
  describe("when there is a single step", () => {
    it("has a row in a fact table", () => {
      const onlyStep = step(events.id);
      const sql = buildSql([onlyStep]);
      expect(sql).toContain(`FROM (${events.sql})`);
    });

    it("has a row in a fact table with a filter", () => {
      const rowFilter: RowFilter = {
        column: "event_name",
        operator: "=",
        values: ["signup"],
      };

      const onlyStep = step(events.id, [rowFilter]);

      const sql = buildSql([onlyStep]);

      expect(sql).toContain(`FROM (${events.sql})`);
      expect(sql).toContain(`WHERE event_name = 'signup'`);
    });
    it("has a lookback filter", () => {});
  });

  it.todo("selects the units that have a row in a single step's fact table");
});
