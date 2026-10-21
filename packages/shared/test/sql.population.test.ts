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
  filters: FactTableInterface["filters"] = [],
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
    filters,
    columns,
  };
}

const events = factTable(
  "ftb_events",
  "SELECT user_id, user_role, timestamp, event_name FROM events",
  [
    column("user_id", "string"),
    column("user_role", "string"),
    column("timestamp", "date"),
    column("event_name", "string"),
  ],
  [
    {
      id: "filter_1",
      dateCreated: new Date(0),
      dateUpdated: new Date(0),
      name: "Admins",
      description: "",
      value: "user_role = 'admin'",
    },
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

function step(
  factTableId: string,
  rowFilters: PopulationStep["rowFilters"] = [],
): PopulationStep {
  return {
    source: { type: "factTable", factTableId },
    rowFilters,
    windowSettings: windowSettings(),
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
    it("returns SQL for a single fact table", () => {
      const onlyStep = step(events.id);
      const sql = buildSql([onlyStep]);
      expect(sql).toContain(`FROM (${events.sql})`);
    });

    it("returns SQL for a fact table with a row filter", () => {
      const rowFilter: RowFilter = {
        column: "event_name",
        operator: "=",
        values: ["signup"],
      };

      const onlyStep = step(events.id, [rowFilter]);

      const sql = buildSql([onlyStep]);

      expect(sql).toContain(`FROM (${events.sql})`);
      expect(sql).toContain(`WHERE (event_name = 'signup')`);
    });
  });

  it("returns SQL for a fact table with multiple row filters and multiple values", () => {
    const rowFilter1: RowFilter = {
      column: "event_name",
      operator: "=",
      values: ["signup"],
    };

    const rowFilter2: RowFilter = {
      column: "user_role",
      operator: "in",
      values: ["admin", "editor"],
    };

    const onlyStep = step(events.id, [rowFilter1, rowFilter2]);

    const sql = buildSql([onlyStep]);

    expect(sql).toContain(`FROM (${events.sql})`);
    expect(sql).toContain(
      `WHERE (event_name = 'signup') AND (user_role IN (\n  'admin',\n  'editor'\n))`,
    );
  });

  it('returns SQL for a fact table with a "saved_filter" row filter', () => {
    const rowFilter: RowFilter = {
      operator: "saved_filter",
      values: ["filter_1"],
    };

    const onlyStep = step(events.id, [rowFilter]);

    const sql = buildSql([onlyStep]);

    expect(sql).toContain(`FROM (${events.sql})`);
    expect(sql).toContain(`WHERE (user_role = 'admin')`);
  });

  it('returns SQL for a fact table with a "sql_expr" raw filter', () => {
    const rowFilter: RowFilter = {
      operator: "sql_expr",
      values: ["user_role = 'admin'"],
    };

    const onlyStep = step(events.id, [rowFilter]);

    const sql = buildSql([onlyStep]);

    expect(sql).toContain(`FROM (${events.sql})`);
    expect(sql).toContain(`WHERE (user_role = 'admin')`);
  });

  it("returns SQL for a fact table with an aggregate filter that sums the specified column", () => {
    const aggregateFilterColumn = "amount";
    const aggregateFilter = ">=3";
    const onlyStep = step(orders.id, []);
    onlyStep.aggregateFilterColumn = aggregateFilterColumn;
    onlyStep.aggregateFilter = aggregateFilter;

    const sql = buildSql([onlyStep]);
    expect(sql).toContain(`FROM (${orders.sql})`);
    expect(sql).toContain(`GROUP BY user_id HAVING SUM(amount) >= 3`);
  });

  it("returns SQL for a fact table with an aggregate filter that counts rows", () => {
    const aggregateFilterColumn = "$$count";
    const aggregateFilter = ">=3";
    const onlyStep = step(orders.id, []);
    onlyStep.aggregateFilterColumn = aggregateFilterColumn;
    onlyStep.aggregateFilter = aggregateFilter;

    const sql = buildSql([onlyStep]);
    expect(sql).toContain(`FROM (${orders.sql})`);
    expect(sql).toContain(`GROUP BY user_id HAVING SUM(1) >= 3`);
  });

  it("returns SQL for a fact table with both row filters and an aggregate filter", () => {
    const rowFilter: RowFilter = {
      column: "event_name",
      operator: "=",
      values: ["signup"],
    };
    const aggregateFilterColumn = "$$count";
    const aggregateFilter = ">=3";
    const onlyStep = step(events.id, [rowFilter]);
    onlyStep.aggregateFilterColumn = aggregateFilterColumn;
    onlyStep.aggregateFilter = aggregateFilter;

    const sql = buildSql([onlyStep]);
    expect(sql).toContain(`FROM (${events.sql})`);
    expect(sql).toContain(`WHERE (event_name = 'signup')`);
    expect(sql).toContain(`GROUP BY user_id HAVING SUM(1) >= 3`);
  });

  it("returns SQL for a fact table with an aggregate filter that has multiple conditions", () => {
    const aggregateFilterColumn = "$$count";
    const aggregateFilter = ">=3,<10";
    const onlyStep = step(orders.id, []);
    onlyStep.aggregateFilterColumn = aggregateFilterColumn;
    onlyStep.aggregateFilter = aggregateFilter;

    const sql = buildSql([onlyStep]);
    expect(sql).toContain(`FROM (${orders.sql})`);
    expect(sql).toContain(
      `GROUP BY user_id HAVING SUM(1) >= 3 AND SUM(1) < 10`,
    );
  });

  it("throws an error when the aggregate filter is invalid", () => {
    const aggregateFilterColumn = "$$count";
    const aggregateFilter = "invalid";
    const onlyStep = step(orders.id, []);
    onlyStep.aggregateFilterColumn = aggregateFilterColumn;
    onlyStep.aggregateFilter = aggregateFilter;

    expect(() => buildSql([onlyStep])).toThrow(
      `Invalid aggregate filter: ${aggregateFilter}`,
    );
  });

  describe("lookback window", () => {
    const asOf = new Date("2026-01-08T00:00:00Z");

    it("filters rows to the window ending at asOf", () => {
      const onlyStep = step(events.id);
      onlyStep.windowSettings = windowSettings({
        type: "lookback",
        windowValue: 7,
        windowUnit: "days",
      });

      const sql = buildSql([onlyStep], { asOf });

      expect(sql).toContain(`FROM (${events.sql})`);
      expect(sql).toContain(
        `WHERE (timestamp >= ${dialect.toTimestamp(new Date("2026-01-01T00:00:00Z"))} AND timestamp <= ${dialect.toTimestamp(asOf)})`,
      );
    });

    it("supports windows that are not whole hours", () => {
      const onlyStep = step(events.id);
      onlyStep.windowSettings = windowSettings({
        type: "lookback",
        windowValue: 90,
        windowUnit: "minutes",
      });

      const sql = buildSql([onlyStep], { asOf });

      expect(sql).toContain(
        `timestamp >= ${dialect.toTimestamp(new Date("2026-01-07T22:30:00Z"))}`,
      );
    });

    it("combines with row filters", () => {
      const rowFilter: RowFilter = {
        column: "event_name",
        operator: "=",
        values: ["signup"],
      };

      const onlyStep = step(events.id, [rowFilter]);
      onlyStep.windowSettings = windowSettings({
        type: "lookback",
        windowValue: 1,
        windowUnit: "weeks",
      });

      const sql = buildSql([onlyStep], { asOf });

      expect(sql).toContain(
        `WHERE (event_name = 'signup') AND (timestamp >= ${dialect.toTimestamp(new Date("2026-01-01T00:00:00Z"))}`,
      );
    });

    it("throws when the window is not positive", () => {
      const onlyStep = step(events.id);
      onlyStep.windowSettings = windowSettings({
        type: "lookback",
        windowValue: 0,
        windowUnit: "days",
      });

      expect(() => buildSql([onlyStep], { asOf })).toThrow(
        "Lookback window must be greater than zero",
      );
    });

    it("ignores the window when the type is not lookback", () => {
      const onlyStep = step(events.id);
      onlyStep.windowSettings = windowSettings({ windowValue: 7 });

      expect(buildSql([onlyStep], { asOf })).not.toContain("WHERE");
    });
  });

  it.todo(
    'throws an error when a "saved_filter" row filter references a non-existent filter',
  );
});
