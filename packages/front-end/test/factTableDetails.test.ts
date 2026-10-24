import {
  ColumnInterface,
  FactMetricInterface,
  RowFilter,
} from "shared/types/fact-table";
import {
  getEventColumns,
  getMetricsForEvent,
  getSqlSummary,
  getSqlSummaryTokens,
} from "@/services/factTables";

describe("getSqlSummary", () => {
  it("starts at the top-level FROM and collapses whitespace", () => {
    expect(
      getSqlSummary(
        `SELECT\n  user_id,\n  event AS event_name\nFROM   analytics.tracks\nWHERE x = 1`,
      ),
    ).toBe("FROM analytics.tracks WHERE x = 1");
  });

  it("skips FROM inside subqueries, strings, and comments", () => {
    const sql = `SELECT (SELECT 1 FROM t2) AS a, 'from here' AS b -- FROM nope
/* FROM nope */ FROM t1 WHERE c = 'it''s'`;
    expect(getSqlSummary(sql)).toBe("FROM t1 WHERE c = 'it''s'");
  });

  it("keeps template variables intact", () => {
    expect(getSqlSummary("SELECT * FROM t WHERE ts >= '{{startDate}}'")).toBe(
      "FROM t WHERE ts >= '{{startDate}}'",
    );
    expect(getSqlSummary("SELECT * FROM {{ table }}")).toBe("FROM {{ table }}");
  });

  it("returns the whole query when there is no top-level FROM", () => {
    expect(getSqlSummary("SELECT\n 1")).toBe("SELECT 1");
  });
});

describe("getEventColumns", () => {
  const col = (c: Partial<ColumnInterface>) =>
    ({
      column: "c",
      datatype: "string",
      deleted: false,
      ...c,
    }) as ColumnInterface;

  it("returns non-deleted string columns that are always filtered", () => {
    const columns = [
      col({ column: "event", alwaysInlineFilter: true }),
      col({ column: "path", alwaysInlineFilter: true }),
      col({ column: "country" }),
      col({ column: "flag", datatype: "boolean", alwaysInlineFilter: true }),
      col({ column: "old", alwaysInlineFilter: true, deleted: true }),
    ];
    expect(getEventColumns({ columns }).map((c) => c.column)).toEqual([
      "event",
      "path",
    ]);
  });
});

describe("getMetricsForEvent", () => {
  const metric = (id: string, m: Partial<FactMetricInterface>) =>
    ({ id, numerator: null, denominator: null, ...m }) as FactMetricInterface;
  const ref = (factTableId: string, rowFilters: RowFilter[]) =>
    ({
      factTableId,
      column: "$$count",
      rowFilters,
    }) as FactMetricInterface["numerator"];
  const purchase: RowFilter = {
    column: "event",
    operator: "=",
    values: ["purchase"],
  };

  it("matches numerators, denominators, and funnel steps on this table", () => {
    const metrics = [
      metric("num", { numerator: ref("ft", [purchase]) }),
      metric("den", {
        numerator: ref("ft", []),
        denominator: ref("ft", [
          { column: "event", operator: "in", values: ["view", "purchase"] },
        ]),
      }),
      metric("funnel", {
        funnelSettings: {
          steps: [{ factTableId: "ft", rowFilters: [purchase] }],
        } as FactMetricInterface["funnelSettings"],
      }),
      metric("other-table", { numerator: ref("ft2", [purchase]) }),
      metric("other-column", {
        numerator: ref("ft", [{ ...purchase, column: "path" }]),
      }),
      metric("negated", {
        numerator: ref("ft", [{ ...purchase, operator: "!=" }]),
      }),
    ];
    expect(
      getMetricsForEvent(metrics, "ft", "event", "purchase").map((m) => m.id),
    ).toEqual(["num", "den", "funnel"]);
  });
});

describe("getSqlSummaryTokens", () => {
  it("labels keywords, strings, template variables, and casts", () => {
    const { hasSelect, tokens } = getSqlSummaryTokens(
      "SELECT a FROM t WHERE ts >= {{startDate}} AND x::float > 1 AND e = 'buy'",
    );
    expect(hasSelect).toBe(true);
    const kinds = Object.fromEntries(tokens.map((t) => [t.text, t.kind]));
    expect(kinds).toMatchObject({
      FROM: "keyword",
      WHERE: "keyword",
      AND: "keyword",
      "{{startDate}}": "variable",
      "::float": "cast",
      "'buy'": "string",
      t: "other",
    });
  });

  it("reports no SELECT when the query has no top-level FROM", () => {
    expect(getSqlSummaryTokens("SELECT 1").hasSelect).toBe(false);
  });
});
