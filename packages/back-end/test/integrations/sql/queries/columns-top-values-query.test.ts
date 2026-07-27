import type { SqlDialect } from "shared/types/sql";
import type { ColumnInterface } from "shared/types/fact-table";
import { getColumnsTopValuesQuery } from "back-end/src/integrations/sql/queries/columns-top-values-query";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { snowflakeDialect } from "back-end/src/integrations/dialects/snowflake";
import { databricksDialect } from "back-end/src/integrations/dialects/databricks";
import { prestoDialect } from "back-end/src/integrations/dialects/presto";
import { athenaDialect } from "back-end/src/integrations/dialects/athena";
import { clickHouseDialect } from "back-end/src/integrations/dialects/clickhouse";
import { postgresDialect } from "back-end/src/integrations/dialects/postgres";
import { redshiftDialect } from "back-end/src/integrations/dialects/redshift";
import { mysqlDialect } from "back-end/src/integrations/dialects/mysql";

function makeColumn(column: string): ColumnInterface {
  return {
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: column,
    description: "",
    column,
    datatype: "string",
    numberFormat: "",
    deleted: false,
  };
}

const factTable = {
  sql: "SELECT country, plan, timestamp FROM events WHERE timestamp >= {{startDate}}",
  eventName: "",
};

const columns = [makeColumn("country"), makeColumn("plan")];

function buildSql(
  dialect: SqlDialect,
  overrides: Record<string, unknown> = {},
) {
  return getColumnsTopValuesQuery(dialect, {
    factTable,
    columns,
    limit: 100,
    lookbackDays: 14,
    maxValueLength: 100,
    ...overrides,
  });
}

function registerSharedTopValuesTests(dialect: SqlDialect) {
  it("defines __factTable once and references it once (single source scan)", () => {
    const sql = buildSql(dialect);
    const factTableRefs = sql.match(/\b__factTable\b/g) ?? [];
    expect(factTableRefs).toHaveLength(2);
    expect(sql.match(/\b__factTable\s+AS\b/gi)?.length).toBe(1);
    expect(sql.match(/FROM\s+__factTable\b/gi)?.length).toBe(1);
  });

  it("produces the (column_name, value, count) contract ordered for the consumer", () => {
    const sql = buildSql(dialect);
    expect(sql).toMatch(/column_name/i);
    expect(sql).toMatch(/\bvalue\b/i);
    expect(sql).toMatch(/\bcount\b/i);
    expect(sql).toMatch(/ORDER BY\s+column_name,\s*count DESC/i);
  });

  it("applies the max-value-length gate", () => {
    const sql = buildSql(dialect);
    expect(sql).toMatch(/<=\s*100/);
  });

  it("respects the lookback window in the timestamp filter", () => {
    const sql = buildSql(dialect);
    const sql7 = buildSql(dialect, { lookbackDays: 7 });
    expect(sql7).not.toEqual(sql);
    expect(sql7).toMatch(/timestamp\s*>=/i);
  });
}

// Dialects whose single-pass approximate top-k path replaces the exact
// UNPIVOT + GROUP BY + ROW_NUMBER form.
const approxDialects: {
  name: string;
  dialect: SqlDialect;
  aggFn: RegExp;
}[] = [
  { name: "BigQuery", dialect: bigQueryDialect, aggFn: /APPROX_TOP_COUNT/i },
  { name: "Snowflake", dialect: snowflakeDialect, aggFn: /APPROX_TOP_K/i },
  { name: "Databricks", dialect: databricksDialect, aggFn: /approx_top_k/i },
  { name: "Presto", dialect: prestoDialect, aggFn: /approx_most_frequent/i },
  { name: "ClickHouse", dialect: clickHouseDialect, aggFn: /topK/ },
];

describe("getColumnsTopValuesQuery — approximate top-k path", () => {
  approxDialects.forEach(({ name, dialect, aggFn }) => {
    describe(name, () => {
      const sql = buildSql(dialect);

      registerSharedTopValuesTests(dialect);

      it("uses the approximate top-k aggregate, one call per column", () => {
        expect(sql).toMatch(aggFn);
        expect(sql.match(aggFn)?.length).toBeGreaterThanOrEqual(1);
        // One aggregate per string column.
        const calls = sql.match(new RegExp(aggFn.source, "gi"));
        expect(calls?.length).toBe(columns.length);
      });

      it("drops the exact-path machinery (no row explosion / window)", () => {
        expect(sql).not.toMatch(/ROW_NUMBER/i);
        expect(sql).not.toMatch(/GROUP BY/i);
      });
    });
  });
});

describe("getColumnsTopValuesQuery — exact fallback path", () => {
  const exactDialects: { name: string; dialect: SqlDialect }[] = [
    { name: "Postgres", dialect: postgresDialect },
    { name: "Redshift", dialect: redshiftDialect },
    { name: "MySQL", dialect: mysqlDialect },
    // Athena v3 should support it, but v2 does not (I think)
    // so taking the safe route for now until we can add engine version detection.
    { name: "Athena", dialect: athenaDialect },
  ];

  exactDialects.forEach(({ name, dialect }) => {
    describe(name, () => {
      registerSharedTopValuesTests(dialect);

      it("keeps the exact ROW_NUMBER path with no approximate aggregate", () => {
        const sql = buildSql(dialect);
        expect(sql).toMatch(/ROW_NUMBER/i);
        expect(sql).toMatch(/GROUP BY/i);
        expect(sql).not.toMatch(
          /APPROX_TOP_COUNT|APPROX_TOP_K|approx_most_frequent/i,
        );
      });
    });
  });

  it("only the approximate dialects expose approxTopValuesCTEBody", () => {
    expect(typeof bigQueryDialect.approxTopValuesCTEBody).toBe("function");
    expect(postgresDialect.approxTopValuesCTEBody).toBeUndefined();
    expect(redshiftDialect.approxTopValuesCTEBody).toBeUndefined();
    expect(mysqlDialect.approxTopValuesCTEBody).toBeUndefined();
    expect(athenaDialect.approxTopValuesCTEBody).toBeUndefined();
  });
});
