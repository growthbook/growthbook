import type { SqlDialect } from "shared/types/sql";
import { buildJourneySql } from "shared/enterprise";
import { ExplorationConfig } from "shared/validators";
import { FactTableInterface } from "shared/types/fact-table";
import { postgresDialect } from "back-end/src/integrations/dialects/postgres";
import { clickHouseDialect } from "back-end/src/integrations/dialects/clickhouse";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { snowflakeDialect } from "back-end/src/integrations/dialects/snowflake";
import { mysqlDialect } from "back-end/src/integrations/dialects/mysql";
import { baseDialect } from "back-end/src/integrations/dialects/base";

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
      dailyJourneys: false,
      stepColumns,
      anchorStepValues: stepColumns.map((_, i) => (i === 0 ? "view" : "x")),
      direction: "forward",
      excludedSteps: [],
      rowFilters: [],
      collapseRepeats: true,
      path: [],
      depth: 2,
      optionsPerStep: [],
      ...(stepGroups ? { stepGroups } : {}),
    },
  } as ExplorationConfig;
}

const articleGroup = [{ column: "event_name", pattern: "/article/*" }];

describe("SqlDialect concatStrings", () => {
  it("throws on the base dialect", () => {
    expect(() => baseDialect.concatStrings(["a", "b"])).toThrow(
      /concatenation is not supported/i,
    );
  });

  const cases: [string, Pick<SqlDialect, "concatStrings">][] = [
    ["postgres", postgresDialect],
    ["clickhouse", clickHouseDialect],
    ["bigquery", bigQueryDialect],
    ["snowflake", snowflakeDialect],
  ];
  it.each(cases)("%s joins with ||", (_name, dialect) => {
    expect(dialect.concatStrings(["a", "b", "c"])).toBe("a || b || c");
  });
});

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

  it("ClickHouse emits LEAD and ClickHouse-native dateTrunc, not QUALIFY", () => {
    const { sql } = buildJourneySql(
      config(["event_name"]),
      factTableMap,
      clickHouseDialect,
    );
    expect(sql).toMatch(/LEAD\s*\(/i);
    expect(sql).not.toMatch(/QUALIFY/i);
    expect(sql).not.toContain(" || ");
  });

  it("MySQL single-column journeys never emit ||", () => {
    const { sql } = buildJourneySql(
      config(["event_name"]),
      factTableMap,
      mysqlDialect,
    );
    expect(sql).not.toContain("||");
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

  it("wraps the grouped column in a CASE that falls through to the raw value", () => {
    const { sql } = buildJourneySql(
      config(["event_name"], articleGroup),
      factTableMap,
      postgresDialect,
    );
    expect(sql).toMatch(/CASE\s+WHEN/i);
    expect(sql).toContain("THEN '/article/*'");
    expect(sql).toMatch(/ELSE\s+cast\(event_name as varchar\)\s+END/i);
  });
});
