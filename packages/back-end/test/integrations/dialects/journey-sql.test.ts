import type { SqlDialect } from "shared/types/sql";
import { buildJourneySql } from "shared/enterprise";
import { ExplorationConfig } from "shared/validators";
import { FactTableInterface } from "shared/types/fact-table";
import {
  postgresDialect,
  clickHouseDialect,
  bigQueryDialect,
  snowflakeDialect,
  mysqlDialect,
  baseDialect,
} from "shared/dialects";

const eventsFactTable: FactTableInterface = {
  id: "events",
  organization: "org_1",
  name: "Events",
  datasource: "ds_1",
  sql: "SELECT user_id, timestamp, country, event_name, category, action FROM events",
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
    "user_id",
    "timestamp",
    "country",
    "event_name",
    "category",
    "action",
  ].map((col) => ({
    column: col,
    datatype: col === "timestamp" ? "date" : "string",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: col,
    description: "",
    numberFormat: "",
    alwaysInlineFilter: false,
    deleted: false,
    autoSlices: [],
    isAutoSliceColumn: false,
  })),
};

const factTableMap = new Map<string, FactTableInterface>([
  ["events", eventsFactTable],
]);

function config(
  stepColumns: string[],
  stepGroups?: { column: string; pattern: string }[],
): ExplorationConfig {
  return {
    type: "journey",
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
      type: "journey",
      factTableId: "events",
      unit: "user_id",
      stepColumns,
      anchorStepValues: stepColumns.map((_, i) => (i === 0 ? "view" : "x")),
      direction: "forward",
      rowFilters: [],
      path: [],
      lookaheadDepth: 2,
      optionsPerStep: [],
      ...(stepGroups ? { stepGroups } : {}),
    },
  } as ExplorationConfig;
}

const articleGroup = [{ column: "event_name", pattern: "/article/*" }];

describe("buildJourneySql — real dialects", () => {
  it("Postgres emits || for two step columns and never QUALIFY", () => {
    const { sql } = buildJourneySql(
      config(["category", "action"]),
      factTableMap,
      postgresDialect,
    );
    expect(sql).toContain(" || ");
    expect(sql).toContain("COALESCE(");
    expect(sql).not.toMatch(/QUALIFY/i);
    expect(sql).toMatch(/LEAD\s*\(/i);
  });

  it("ClickHouse emits leadInFrame/lagInFrame, not LEAD/LAG or QUALIFY", () => {
    const { sql } = buildJourneySql(
      config(["event_name"]),
      factTableMap,
      clickHouseDialect,
    );
    // ClickHouse resolves uppercase LAG/LEAD only from 25.10 (#7336).
    const flat = sql.replace(/\s+/g, " ");
    expect(flat).toContain(
      "leadInFrame(toNullable(step), 1) OVER ( PARTITION BY journey_unit, journey_day ORDER BY ts, step ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING )",
    );
    expect(flat).toContain("lagInFrame(toNullable(step), 1) OVER (");
    expect(sql).not.toMatch(/\b(LAG|LEAD)\s*\(/);
    expect(sql).not.toMatch(/QUALIFY/i);
    expect(sql).not.toContain(" || ");
  });
  it("MySQL two-column journeys throw instead of using boolean OR", () => {
    expect(() =>
      buildJourneySql(
        config(["category", "action"]),
        factTableMap,
        mysqlDialect,
      ),
    ).toThrow(/concatenation is not supported/i);
  });
});

describe("SqlDialect globMatch in journey step grouping", () => {
  it("emits an ESCAPE clause only where the dialect needs one", () => {
    // Postgres, ClickHouse and BigQuery already treat backslash as the LIKE
    // escape, so adding the clause would be redundant (and invalid in some).
    for (const dialect of [
      postgresDialect,
      clickHouseDialect,
      bigQueryDialect,
    ]) {
      const { sql } = buildJourneySql(
        config(["event_name"], articleGroup),
        factTableMap,
        dialect,
      );
      expect(sql).toMatch(/LIKE\s+'\/article\/%'/);
      expect(sql).not.toMatch(/ESCAPE/i);
    }

    for (const dialect of [baseDialect as SqlDialect, snowflakeDialect]) {
      const { sql } = buildJourneySql(
        config(["event_name"], articleGroup),
        factTableMap,
        dialect,
      );
      expect(sql).toMatch(/LIKE\s+'\/article\/%'\s+ESCAPE/i);
    }
  });

  it("escapes the pattern with each dialect's own string-literal rules", () => {
    // Snowflake doubles a backslash in a string literal, so the LIKE-level
    // escape of a literal % survives as a single backslash at match time.
    const { sql: snowflake } = buildJourneySql(
      config(["event_name"], [{ column: "event_name", pattern: "/50%/*" }]),
      factTableMap,
      snowflakeDialect,
    );
    expect(snowflake).toContain("'/50\\\\%/%'");

    const { sql: postgres } = buildJourneySql(
      config(["event_name"], [{ column: "event_name", pattern: "/50%/*" }]),
      factTableMap,
      postgresDialect,
    );
    expect(postgres).toContain("'/50\\%/%'");
  });
});
