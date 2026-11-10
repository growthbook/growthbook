import {
  ColumnInterface,
  FactMetricInterface,
  RowFilter,
} from "shared/types/fact-table";
import {
  getColumnTopValues,
  prepareColumnUpdate,
  getEventColumns,
  getMetricEvents,
  getMetricsForEvent,
  getSqlSummary,
  getSqlSummaryTokens,
} from "@/services/factTables";

describe("getSqlSummary", () => {
  it("shortens the SELECT list and collapses whitespace", () => {
    expect(
      getSqlSummary(
        `SELECT\n  user_id,\n  event AS event_name\nFROM   analytics.tracks\nWHERE x = 1`,
      ),
    ).toBe("SELECT … FROM analytics.tracks WHERE x = 1");
  });

  it("skips FROM inside subqueries, strings, and comments", () => {
    const sql = `SELECT (SELECT 1 FROM t2) AS a, 'from here' AS b -- FROM nope
/* FROM nope */ FROM t1 WHERE c = 'it''s'`;
    expect(getSqlSummary(sql)).toBe("SELECT … FROM t1 WHERE c = 'it''s'");
  });

  it("keeps template variables intact", () => {
    expect(getSqlSummary("SELECT * FROM t WHERE ts >= '{{startDate}}'")).toBe(
      "SELECT … FROM t WHERE ts >= '{{startDate}}'",
    );
    expect(getSqlSummary("SELECT * FROM {{ table }}")).toBe(
      "SELECT … FROM {{ table }}",
    );
  });

  it("ends strings at backslash-escaped quotes only when asked", () => {
    const sql = "SELECT a FROM t WHERE c = 'it\\'s' AND d = 1";
    expect(getSqlSummary(sql, true)).toBe(
      "SELECT … FROM t WHERE c = 'it\\'s' AND d = 1",
    );
    // Without backslash escapes, the string ends at the backslash's quote
    expect(getSqlSummaryTokens(sql).map((t) => t.text)).toContain("'it\\'");
  });

  it("keeps a SELECT list that has no FROM", () => {
    expect(getSqlSummary("SELECT\n 1")).toBe("SELECT 1");
    expect(getSqlSummary("SELECT a FROM t UNION ALL SELECT 1")).toBe(
      "SELECT … FROM t UNION ALL SELECT 1",
    );
  });

  it("shortens SELECT lists in subqueries and CTEs", () => {
    expect(
      getSqlSummary(
        "WITH w AS (SELECT a, ROW_NUMBER() OVER (PARTITION BY b) AS rn FROM t)\n" +
          "SELECT x, (SELECT MAX(y) FROM u) AS m, EXTRACT(YEAR FROM ts)\n" +
          "FROM (SELECT * FROM w WHERE rn = 1) s",
      ),
    ).toBe(
      "WITH w AS (SELECT … FROM t) SELECT … FROM (SELECT … FROM w WHERE rn = 1) s",
    );
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
    expect(
      getEventColumns({ columns, tableType: "event" }).map((c) => c.column),
    ).toEqual(["event", "path"]);
  });

  it("returns none for tables declared as another type", () => {
    const columns = [col({ column: "event", alwaysInlineFilter: true })];
    expect(getEventColumns({ columns, tableType: "rollup" })).toEqual([]);
  });

  it("treats untyped tables as event tables only when an always-filtered column has an event name", () => {
    expect(
      getEventColumns({
        columns: [
          col({ column: "EVENT_NAME", alwaysInlineFilter: true }),
          col({ column: "path", alwaysInlineFilter: true }),
        ],
      }).map((c) => c.column),
    ).toEqual(["EVENT_NAME", "path"]);
    expect(
      getEventColumns({
        columns: [
          col({ column: "path", alwaysInlineFilter: true }),
          col({ column: "event_name" }),
        ],
      }),
    ).toEqual([]);
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

describe("getMetricEvents", () => {
  const ref = (factTableId: string, rowFilters: RowFilter[]) => ({
    factTableId,
    column: "$$count",
    rowFilters,
  });
  const ev = (operator: RowFilter["operator"], values: string[]) => ({
    column: "event",
    operator,
    values,
  });

  it("lists numerator then denominator events once each", () => {
    const metric = {
      metricType: "ratio",
      numerator: ref("ft", [ev("=", ["purchase"]), ev("!=", ["refund"])]),
      denominator: ref("ft", [ev("in", ["view", "purchase"])]),
    } as FactMetricInterface;
    expect(getMetricEvents(metric, "ft", ["event"])).toEqual([
      "purchase",
      "view",
    ]);
  });

  it("lists one entry per funnel step on this table", () => {
    const metric = {
      metricType: "funnel",
      numerator: null,
      funnelSettings: {
        steps: [
          ref("ft", [ev("=", ["add_to_cart"])]),
          ref("other", [ev("=", ["checkout"])]),
          ref("ft", [ev("in", ["purchase", "upgrade"])]),
        ],
      },
    } as unknown as FactMetricInterface;
    expect(getMetricEvents(metric, "ft", ["event"])).toEqual([
      "add_to_cart",
      "purchase, upgrade",
    ]);
  });
});

describe("getSqlSummaryTokens", () => {
  it("labels keywords, strings, template variables, and casts", () => {
    const tokens = getSqlSummaryTokens(
      "SELECT a FROM t WHERE ts >= {{startDate}} AND x::float > 1 AND e = 'buy'",
    );
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
});

describe("getColumnTopValues", () => {
  const refreshedAt = new Date("2026-11-01T00:00:00Z");
  const counts = [
    { value: "a", count: 3 },
    { value: "b", count: 1 },
  ];

  it("prefers counts from a refresh over stored ones", () => {
    const fresh = [{ value: "c", count: 9 }];
    expect(
      getColumnTopValues(
        { topValues: ["a", "b"], topValueCounts: counts },
        fresh,
      ),
    ).toEqual({ values: fresh, hasCounts: true, refreshedAt: null });
  });

  it("uses stored counts, then the plain list", () => {
    expect(
      getColumnTopValues({
        topValues: ["a", "b"],
        topValueCounts: counts,
        topValuesDate: refreshedAt,
      }),
    ).toEqual({ values: counts, hasCounts: true, refreshedAt });
    expect(
      getColumnTopValues({ topValues: ["a"], topValueCounts: [] }),
    ).toEqual({
      values: [{ value: "a" }],
      hasCounts: false,
      refreshedAt: null,
    });
  });
});

describe("prepareColumnUpdate", () => {
  const column = (c: Partial<ColumnInterface>) =>
    ({
      column: "country",
      datatype: "string",
      deleted: false,
      ...c,
    }) as ColumnInterface;
  const factTable = (columns: ColumnInterface[]) => ({
    userIdTypes: ["user_id"],
    userIdColumns: { user_id: "user_id" },
    columns,
  });

  it("clears value mappings when filtering is turned off", () => {
    const country = column({ alwaysInlineFilter: true });
    expect(
      prepareColumnUpdate(factTable([country]), country, {
        alwaysInlineFilter: false,
      }).data,
    ).toEqual({ alwaysInlineFilter: false, conditionalInlineFilters: {} });
  });

  it("drops filtering for a column that can't be filtered", () => {
    const userId = column({ column: "user_id" });
    expect(
      prepareColumnUpdate(factTable([userId]), userId, {
        alwaysInlineFilter: true,
      }).data.alwaysInlineFilter,
    ).toBe(false);
  });

  it("loads top values only for a new string Auto Slice without levels", () => {
    const country = column({});
    const flag = column({ column: "flag", datatype: "boolean" });
    const table = factTable([country, flag]);
    expect(
      prepareColumnUpdate(table, country, { isAutoSliceColumn: true })
        .loadTopValues,
    ).toBe(true);
    expect(
      prepareColumnUpdate(table, country, {
        isAutoSliceColumn: true,
        autoSlices: ["US"],
      }).loadTopValues,
    ).toBe(false);
    const boolean = prepareColumnUpdate(table, flag, {
      isAutoSliceColumn: true,
      autoSlices: [],
    });
    expect(boolean.loadTopValues).toBe(false);
    expect(boolean.data.autoSlices).toEqual(["true", "false"]);
  });
});
