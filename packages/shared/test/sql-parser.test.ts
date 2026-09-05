import { parseSelectSQL, SqlParseError } from "../src/sql-parser";

const pg = (sql: string) => parseSelectSQL(sql, "postgres");

describe("parseSelectSQL", () => {
  describe("select list", () => {
    it("parses AS aliases, bare aliases, and no alias", () => {
      const r = pg(
        "SELECT user_id AS uid, ts Timestamp, amount, LOWER(email) FROM t",
      );
      expect(r.select).toEqual([
        { expr: "user_id", alias: "uid" },
        { expr: "ts", alias: "timestamp" },
        { expr: "amount", alias: "amount" },
        { expr: "lower(email)", alias: "lower(email)" },
      ]);
    });
    it("names bare column references after their last segment", () => {
      expect(
        pg('SELECT t.user_id, "anonymous_id", "MixedCase", e.a.b, f(x) FROM t')
          .select,
      ).toEqual([
        { expr: "t.user_id", alias: "user_id" },
        { expr: '"anonymous_id"', alias: "anonymous_id" },
        { expr: '"MixedCase"', alias: '"MixedCase"' },
        { expr: "e.a.b", alias: "b" },
        { expr: "f(x)", alias: "f(x)" },
      ]);
      expect(
        parseSelectSQL(
          "SELECT `MixedCase` AS `Out`, t.`Col` FROM t",
          "clickhouse",
        ).select,
      ).toEqual([
        { expr: "`MixedCase`", alias: "Out" },
        { expr: "t.`Col`", alias: "Col" },
      ]);
    });
    it("supports SELECT *", () => {
      expect(pg("SELECT * FROM t").select).toEqual([{ expr: "*", alias: "*" }]);
    });
    it("handles expressions that look like they end in an alias", () => {
      const r = pg(
        "SELECT NOT flag, a - b, CASE WHEN a THEN 1 ELSE 0 END c, x IS NULL, ts::date d FROM t",
      );
      expect(r.select).toEqual([
        { expr: "NOT flag", alias: "NOT flag" },
        { expr: "a - b", alias: "a - b" },
        { expr: "CASE WHEN a THEN 1 ELSE 0 END", alias: "c" },
        { expr: "x IS NULL", alias: "x IS NULL" },
        { expr: "ts::date", alias: "d" },
      ]);
    });
    it("keeps CAST(x AS type) intact", () => {
      expect(pg("SELECT CAST(x AS INT) AS y FROM t").select).toEqual([
        { expr: "CAST(x AS int)", alias: "y" },
      ]);
    });
  });

  describe("from normalization", () => {
    it("collapses whitespace, comments, and keyword case", () => {
      const a = pg(`
        select x from   events e
        -- comment
        left  join users u /* block */ on u.id = e.user_id
      `);
      const b = pg(
        "SELECT x FROM events E LEFT JOIN users U ON U.ID = E.USER_ID;",
      );
      expect(a.from).toBe("events e LEFT JOIN users u ON u.id = e.user_id");
      expect(b.from).toBe(a.from);
    });
    it("allows subqueries with aggregates in FROM", () => {
      const r = pg(
        "SELECT uid FROM (SELECT user_id uid, COUNT(*) n FROM t GROUP BY 1) sub",
      );
      expect(r.from).toBe(
        "(SELECT user_id uid, count(*) n FROM t GROUP BY 1) sub",
      );
    });
    it("allows UNNEST and implicit joins", () => {
      const r = parseSelectSQL(
        "SELECT x FROM `proj.ds.tbl` t, UNNEST(t.items) AS item",
        "bigquery",
      );
      expect(r.from).toBe("`proj.ds.tbl` t, UNNEST(t.items) AS item");
    });
  });

  describe("case folding", () => {
    it("folds FROM for postgres but not bigquery", () => {
      expect(pg("SELECT UserId FROM Events").from).toBe("events");
      expect(parseSelectSQL("SELECT UserId FROM Events", "bigquery").from).toBe(
        "Events",
      );
    });
    it("folds columns for bigquery", () => {
      const r = parseSelectSQL("SELECT UserId FROM Events", "bigquery");
      expect(r.select).toEqual([{ expr: "userid", alias: "userid" }]);
    });
    it("never folds for clickhouse", () => {
      const r = parseSelectSQL(
        "SELECT toDate(Ts) d FROM Events WHERE UserId = 'a'",
        "clickhouse",
      );
      expect(r.select).toEqual([{ expr: "toDate(Ts)", alias: "d" }]);
      expect(r.from).toBe("Events");
      expect(r.where).toEqual([
        { operator: "=", column: "UserId", values: ["a"] },
      ]);
    });
    it("never folds quoted identifiers", () => {
      expect(pg('SELECT "UserId" FROM "Events"').from).toBe('"Events"');
    });
  });

  describe("where", () => {
    const where = (
      w: string,
      type: Parameters<typeof parseSelectSQL>[1] = "postgres",
    ) => parseSelectSQL(`SELECT x FROM t WHERE ${w}`, type).where;

    it("is optional", () => {
      expect(pg("SELECT x FROM t").where).toBeUndefined();
    });
    it("drops tautologies", () => {
      expect(where("1 = 1")).toBeUndefined();
      expect(where("1")).toBeUndefined();
      expect(where("TRUE AND (1=1) AND a = 'b'")).toEqual([
        { operator: "=", column: "a", values: ["b"] },
      ]);
    });
    it("maps comparison operators", () => {
      expect(
        where("a = 'x' AND b != 1 AND c <> 2.5 AND d > -3 AND e <= 4"),
      ).toEqual([
        { operator: "=", column: "a", values: ["x"] },
        { operator: "!=", column: "b", values: ["1"] },
        { operator: "!=", column: "c", values: ["2.5"] },
        { operator: ">", column: "d", values: ["-3"] },
        { operator: "<=", column: "e", values: ["4"] },
      ]);
    });
    it("mirrors literal-first comparisons", () => {
      expect(where("5 < t.Amount")).toEqual([
        { operator: ">", column: "t.amount", values: ["5"] },
      ]);
    });
    it("unescapes string literals", () => {
      expect(where("a = 'it''s'")).toEqual([
        { operator: "=", column: "a", values: ["it's"] },
      ]);
      expect(where("a = 'it\\'s' AND b = \"dq\"", "mysql")).toEqual([
        { operator: "=", column: "a", values: ["it's"] },
        { operator: "=", column: "b", values: ["dq"] },
      ]);
    });
    it("maps IN / NOT IN", () => {
      expect(where("a IN ('x', 'y') AND b NOT IN (1, 2)")).toEqual([
        { operator: "in", column: "a", values: ["x", "y"] },
        { operator: "not_in", column: "b", values: ["1", "2"] },
      ]);
    });
    it("maps IS NULL / IS NOT NULL / booleans", () => {
      expect(
        where(
          "a IS NULL AND b IS NOT NULL AND c AND NOT d AND e = TRUE AND f IS FALSE",
        ),
      ).toEqual([
        { operator: "is_null", column: "a" },
        { operator: "not_null", column: "b" },
        { operator: "is_true", column: "c" },
        { operator: "is_false", column: "d" },
        { operator: "is_true", column: "e" },
        { operator: "is_false", column: "f" },
      ]);
    });
    it("splits ANDs nested inside parentheses", () => {
      expect(
        where("(a = 1 AND (b = 2 AND c BETWEEN 1 AND 2)) AND d = 3"),
      ).toEqual([
        { operator: "=", column: "a", values: ["1"] },
        { operator: "=", column: "b", values: ["2"] },
        { operator: "between", column: "c", values: ["1", "2"] },
        { operator: "=", column: "d", values: ["3"] },
      ]);
    });
    it("folds same-column OR equalities into IN", () => {
      expect(
        where("(a = 'x' OR a = 'y' OR a IN ('z', 'w')) AND b = 1"),
      ).toEqual([
        { operator: "in", column: "a", values: ["x", "y", "z", "w"] },
        { operator: "=", column: "b", values: ["1"] },
      ]);
      expect(where("a = 'x' OR b = 'y'")).toEqual([
        { operator: "sql_expr", values: ["a = 'x' OR b = 'y'"] },
      ]);
      expect(where("a = 'x' OR a LIKE 'y%'")).toEqual([
        { operator: "sql_expr", values: ["a = 'x' OR a LIKE 'y%'"] },
      ]);
    });
    it("pulls _TABLE_SUFFIX ranges into tableSuffix", () => {
      const r = parseSelectSQL(
        `SELECT x FROM \`p.d.events_*\` e WHERE e.event_name = 'a' AND
         ((_TABLE_SUFFIX BETWEEN '20240101' AND '20240131') OR
          (_TABLE_SUFFIX BETWEEN 'intraday_20240101' AND 'intraday_20240131'))`,
        "bigquery",
      );
      expect(r.where).toEqual([
        { operator: "=", column: "e.event_name", values: ["a"] },
      ]);
      expect(r.tableSuffix).toBe(
        "(_table_suffix BETWEEN '20240101' AND '20240131') OR (_table_suffix BETWEEN 'intraday_20240101' AND 'intraday_20240131')",
      );
      const single = parseSelectSQL(
        "SELECT x FROM t WHERE e._TABLE_SUFFIX BETWEEN '1' AND '2'",
        "bigquery",
      );
      expect(single.where).toBeUndefined();
      expect(single.tableSuffix).toBe("e._table_suffix BETWEEN '1' AND '2'");
      // Anything fancier stays a row filter
      expect(
        parseSelectSQL(
          "SELECT x FROM t WHERE _TABLE_SUFFIX BETWEEN '1' AND format_date('%Y', current_date())",
          "bigquery",
        ).where,
      ).toEqual([
        {
          operator: "sql_expr",
          values: [
            "_table_suffix BETWEEN '1' AND format_date('%Y', current_date())",
          ],
        },
      ]);
      expect(() =>
        parseSelectSQL(
          "SELECT x FROM t WHERE _TABLE_SUFFIX BETWEEN '1' AND '2' AND _TABLE_SUFFIX BETWEEN '3' AND '4'",
          "bigquery",
        ),
      ).toThrow(SqlParseError);
    });
    it("maps BETWEEN without splitting on its AND", () => {
      expect(
        where("a BETWEEN 1 AND 5 AND b NOT BETWEEN 'a' AND 'z' AND c = 1"),
      ).toEqual([
        { operator: "between", column: "a", values: ["1", "5"] },
        { operator: "not_between", column: "b", values: ["a", "z"] },
        { operator: "=", column: "c", values: ["1"] },
      ]);
    });
    it("maps simple LIKE patterns", () => {
      expect(
        where(
          "a LIKE 'x%' AND b LIKE '%x' AND c LIKE '%x%' AND d NOT LIKE '%x%'",
        ),
      ).toEqual([
        { operator: "starts_with", column: "a", values: ["x"] },
        { operator: "ends_with", column: "b", values: ["x"] },
        { operator: "contains", column: "c", values: ["x"] },
        { operator: "not_contains", column: "d", values: ["x"] },
      ]);
    });
    it("falls back to sql_expr for anything else", () => {
      expect(
        where(
          "(a = 1 OR b = 2) AND LOWER(c) = 'x' AND d LIKE 'a_b%' AND e NOT LIKE 'x%' AND f::date > '2020-01-01' AND g IS NOT TRUE AND h = i",
        ),
      ).toEqual([
        { operator: "sql_expr", values: ["a = 1 OR b = 2"] },
        { operator: "sql_expr", values: ["lower(c) = 'x'"] },
        { operator: "sql_expr", values: ["d LIKE 'a_b%'"] },
        { operator: "sql_expr", values: ["e NOT LIKE 'x%'"] },
        { operator: "sql_expr", values: ["f::date > '2020-01-01'"] },
        { operator: "sql_expr", values: ["g IS NOT TRUE"] },
        { operator: "sql_expr", values: ["h = i"] },
      ]);
    });
    it("falls back to sql_expr when a string escape is not understood", () => {
      expect(where("a = 'x\\ny'", "mysql")).toEqual([
        { operator: "sql_expr", values: ["a = 'x\\ny'"] },
      ]);
    });
  });

  describe("order by and limit", () => {
    it("parses ORDER BY and LIMIT/OFFSET", () => {
      const r = pg("SELECT x FROM t ORDER BY Ts DESC, x LIMIT 10 OFFSET 5");
      expect(r.orderBy).toBe("ts DESC, x");
      expect(r.limit).toBe("10 OFFSET 5");
    });
    it("parses MySQL two-number LIMIT", () => {
      expect(parseSelectSQL("SELECT x FROM t LIMIT 5, 10", "mysql").limit).toBe(
        "5, 10",
      );
    });
  });

  describe("dialect quoting", () => {
    it("treats double quotes as identifiers in postgres and strings in mysql", () => {
      expect(pg('SELECT "A" FROM t').select[0].expr).toBe('"A"');
      expect(parseSelectSQL('SELECT "A" FROM t', "mysql").select[0].expr).toBe(
        '"A"',
      );
      expect(
        parseSelectSQL('SELECT x FROM t WHERE a = "A"', "mysql").where,
      ).toEqual([{ operator: "=", column: "a", values: ["A"] }]);
    });
    it("accepts both quote styles in clickhouse", () => {
      const r = parseSelectSQL('SELECT "A", `B` FROM t', "clickhouse");
      expect(r.select.map((s) => s.expr)).toEqual(['"A"', "`B`"]);
    });
    it("rejects backticks in postgres", () => {
      expect(() => pg("SELECT `a` FROM t")).toThrow(SqlParseError);
    });
    it("does not treat backslashes as escapes in postgres", () => {
      expect(pg("SELECT x FROM t WHERE a = 'x\\'").where).toEqual([
        { operator: "=", column: "a", values: ["x\\"] },
      ]);
    });
    it("supports # comments only where the dialect does", () => {
      expect(
        parseSelectSQL("SELECT x # c\nFROM t", "mysql").select[0].expr,
      ).toBe("x");
      expect(() => pg("SELECT x # c\nFROM t")).toThrow(SqlParseError);
    });
  });

  describe("rejects unsupported syntax", () => {
    const bad: [string, Parameters<typeof parseSelectSQL>[1]][] = [
      ["WITH a AS (SELECT 1) SELECT * FROM a", "postgres"],
      ["SELECT *, x FROM t", "postgres"],
      ["SELECT t.* FROM t", "postgres"],
      ["SELECT COUNT(DISTINCT x) FROM t", "postgres"],
      ["SELECT COUNT(x) FROM t", "postgres"],
      ["SELECT uniqExact(x) FROM t", "clickhouse"],
      ["SELECT ROW_NUMBER() OVER (ORDER BY x) FROM t", "postgres"],
      ["SELECT x, y FROM t GROUP BY x", "postgres"],
      ["SELECT x FROM t UNION SELECT y FROM u", "postgres"],
      ["SELECT x", "postgres"],
      ["SELECT x FROM", "postgres"],
      ["SELECT x FROM t WHERE", "postgres"],
      ["SELECT x FROM t WHERE a = 1 AND", "postgres"],
      ["SELECT x FROM t WHERE x = 1 FROM u", "postgres"],
      ["SELECT x FROM t LIMIT 1 WHERE x = 1", "postgres"],
      ["SELECT x FROM t QUALIFY x = 1", "snowflake"],
      ["SELECT x FROM t WHERE a = 'unterminated", "postgres"],
      ["SELECT x /* open FROM t", "postgres"],
      ["SELECT $$x$$ FROM t", "postgres"],
      ["SELECT x FROM t WHERE a > {{startDate}}", "postgres"],
      ["SELECT b'bytes' FROM t", "bigquery"],
      ["SELECT x FROM t; SELECT y FROM u", "postgres"],
      ["SELECT x FROM t OFFSET 5", "bigquery"],
      ["SELECT x FROM t LIMIT foo", "postgres"],
      ["SELECT x AS FROM t", "postgres"],
      ["SELECT x AS a b FROM t", "postgres"],
      ["SELECT (x FROM t", "postgres"],
      ["SELECT x FROM t", "mssql"],
      ["SELECT x FROM t WHERE a = ?", "postgres"],
    ];
    it.each(bad)("throws for %s (%s)", (sql, type) => {
      expect(() => parseSelectSQL(sql, type)).toThrow(SqlParseError);
    });
  });
});

describe("parseSelectSQL dedupe", () => {
  it("flags SELECT DISTINCT", () => {
    const r = pg("SELECT DISTINCT a, b AS c FROM t WHERE a = 1");
    expect(r.dedupe).toBe(true);
    expect(r.select).toEqual([
      { expr: "a", alias: "a" },
      { expr: "b", alias: "c" },
    ]);
    expect(pg("SELECT a FROM t").dedupe).toBeUndefined();
  });
  it("treats an aggregate-free GROUP BY covering the select list as dedupe", () => {
    expect(pg("SELECT a, b FROM t GROUP BY ALL").dedupe).toBe(true);
    expect(pg("SELECT a, b FROM t GROUP BY 2, 1").dedupe).toBe(true);
    expect(pg("SELECT a, 1 AS value, 'x' AS c FROM t GROUP BY 1").dedupe).toBe(
      true,
    );
    expect(
      pg("SELECT a, LOWER(b) AS c FROM t GROUP BY a, lower(B)").dedupe,
    ).toBe(true);
    expect(pg("SELECT a, LOWER(b) AS c FROM t GROUP BY a, c").dedupe).toBe(
      true,
    );
    expect(
      pg("SELECT a FROM t WHERE a = 1 GROUP BY a ORDER BY a LIMIT 5"),
    ).toMatchObject({
      dedupe: true,
      where: [{ operator: "=", column: "a", values: ["1"] }],
      orderBy: "a",
      limit: "5",
    });
  });
  it("still rejects GROUP BY that changes row semantics", () => {
    for (const sql of [
      "SELECT a, b FROM t GROUP BY a",
      "SELECT a, 'x' || b AS c FROM t GROUP BY a",
      "SELECT a, b FROM t GROUP BY 1, 3",
      "SELECT a, MIN(b) AS ts FROM t GROUP BY a",
      "SELECT a FROM t GROUP BY a HAVING a > 1",
      "SELECT * FROM t GROUP BY 1",
      "SELECT a FROM t GROUP BY a, b",
      "SELECT a FROM t GROUP a",
    ]) {
      expect(() => pg(sql)).toThrow(SqlParseError);
    }
  });
});

describe("parseSelectSQL scalar subqueries", () => {
  it("allows (SELECT ...) as an opaque expression in the select list", () => {
    const r = parseSelectSQL(
      `SELECT user_id,
        (SELECT p.value.string_value FROM UNNEST(event_params) p WHERE p.key = 'a') AS a,
        (SELECT MAX(x) FROM other o WHERE o.id = t.id) b
       FROM t`,
      "bigquery",
    );
    expect(r.select).toEqual([
      { expr: "user_id", alias: "user_id" },
      {
        expr: "(SELECT p.value.string_value FROM UNNEST(event_params) p WHERE p.key = 'a')",
        alias: "a",
      },
      { expr: "(SELECT max(x) FROM other o WHERE o.id = t.id)", alias: "b" },
    ]);
  });
  it("falls back to sql_expr for subqueries in WHERE", () => {
    const r = parseSelectSQL(
      `SELECT x FROM t WHERE (SELECT v FROM UNNEST(params) WHERE key = 'k') = 'y'
        AND EXISTS (SELECT 1 FROM u WHERE u.id = t.id) AND z IN (SELECT id FROM w)`,
      "bigquery",
    );
    expect(r.where).toEqual([
      {
        operator: "sql_expr",
        values: ["(SELECT v FROM UNNEST(params) WHERE key = 'k') = 'y'"],
      },
      {
        operator: "sql_expr",
        values: ["EXISTS (SELECT 1 FROM u WHERE u.id = t.id)"],
      },
      { operator: "sql_expr", values: ["z IN (SELECT id FROM w)"] },
    ]);
  });
  it("still rejects bare SELECT and unbalanced subqueries", () => {
    expect(() => pg("SELECT x FROM t WHERE a = SELECT 1")).toThrow(
      SqlParseError,
    );
    expect(() => pg("SELECT (SELECT 1 FROM t")).toThrow(SqlParseError);
  });
});

describe("parseSelectSQL allowAggregates", () => {
  const opt = { allowAggregates: true };
  it("reports whole-item aggregates over a GROUP BY", () => {
    const r = parseSelectSQL(
      "SELECT user_id, DATE(ts) AS d, SUM(amt) AS value, COUNT(*) n, COUNT(DISTINCT s.id) AS c, MAX(x), COUNT(y) FROM t s GROUP BY 1, 2",
      "postgres",
      opt,
    );
    expect(r.select).toEqual([
      { expr: "user_id", alias: "user_id" },
      { expr: "date(ts)", alias: "d" },
      { expr: "amt", alias: "value", aggregation: "sum" },
      { expr: "*", alias: "n", aggregation: "count" },
      { expr: "s.id", alias: "c", aggregation: "count distinct" },
      { expr: "x", alias: "max(x)", aggregation: "max" },
      { expr: "y", alias: "count(y)", aggregation: "count" },
    ]);
    expect(r.dedupe).toBeUndefined();
    // Grouping by an unselected column is fine once aggregates are re-aggregated
    expect(
      parseSelectSQL(
        "SELECT user_id, DATE(ts) AS timestamp, SUM(x) AS value FROM t GROUP BY user_id, DATE(ts), session_id",
        "postgres",
        opt,
      ).select,
    ).toHaveLength(3);
  });
  it("still rejects what it cannot represent", () => {
    for (const sql of [
      "SELECT user_id, SUM(x) AS value FROM t", // no GROUP BY
      "SELECT user_id, MIN(ts) AS timestamp FROM t GROUP BY 1",
      "SELECT user_id, AVG(x) AS value FROM t GROUP BY 1",
      "SELECT user_id, SUM(DISTINCT x) AS value FROM t GROUP BY 1",
      "SELECT user_id, COALESCE(SUM(x), 0) AS value FROM t GROUP BY 1",
      "SELECT user_id, SUM(x) + 1 AS value FROM t GROUP BY 1",
      "SELECT user_id, ts, SUM(x) AS value FROM t GROUP BY 1", // ts not grouped
      "SELECT user_id, ts, SUM(x) AS value FROM t GROUP BY 1, 5", // position out of range
      "SELECT user_id, ts FROM t GROUP BY user_id, ts, other", // no aggregates: not a dedupe
      "SELECT user_id, SUM(x) AS value FROM t GROUP BY 1 HAVING SUM(x) > 1",
    ]) {
      expect(() => parseSelectSQL(sql, "postgres", opt)).toThrow(SqlParseError);
    }
    expect(() =>
      parseSelectSQL(
        "SELECT user_id, SUM(x) AS value FROM t GROUP BY 1",
        "postgres",
      ),
    ).toThrow(SqlParseError);
  });
});

describe("parseSelectSQL edge cases", () => {
  it("allows a trailing comma in the select list", () => {
    const r = parseSelectSQL("SELECT a, b AS c, FROM t", "bigquery");
    expect(r.select).toEqual([
      { expr: "a", alias: "a" },
      { expr: "b", alias: "c" },
    ]);
    expect(() => parseSelectSQL("SELECT a,, b FROM t", "bigquery")).toThrow(
      SqlParseError,
    );
  });
  it("supports raw strings in bigquery only", () => {
    const r = parseSelectSQL(
      "SELECT a FROM t WHERE REGEXP_CONTAINS(b, r'\\d+\\'x')",
      "bigquery",
    );
    expect(r.where).toEqual([
      { operator: "sql_expr", values: ["regexp_contains(b, r'\\d+\\'x')"] },
    ]);
    expect(() =>
      parseSelectSQL("SELECT a FROM t WHERE b = r'x'", "snowflake"),
    ).toThrow(SqlParseError);
  });
  it("accepts keywords glued to a quote but rejects literal prefixes", () => {
    const r = pg(
      "SELECT a FROM t WHERE b like'x%' and c in('y','z') and d > now() - interval'1 day'",
    );
    expect(r.where).toEqual([
      { operator: "starts_with", column: "b", values: ["x"] },
      { operator: "in", column: "c", values: ["y", "z"] },
      { operator: "sql_expr", values: ["d > now() - INTERVAL '1 day'"] },
    ]);
    expect(() => pg("SELECT a FROM t WHERE b = E'x'")).toThrow(SqlParseError);
    expect(() => pg("SELECT a FROM t WHERE b = x'ff'")).toThrow(SqlParseError);
  });
  it("tokenizes regex operators", () => {
    expect(pg("SELECT a FROM t WHERE b ~ 'x' AND c !~* 'y'").where).toEqual([
      { operator: "sql_expr", values: ["b ~ 'x'"] },
      { operator: "sql_expr", values: ["c !~* 'y'"] },
    ]);
  });
  it("supports Snowflake colon paths only for snowflake", () => {
    const r = parseSelectSQL(
      "SELECT a:b.c::string AS x FROM t WHERE a : b = 'y'",
      "snowflake",
    );
    expect(r.select).toEqual([{ expr: "a:b.c::string", alias: "x" }]);
    expect(r.where).toEqual([{ operator: "sql_expr", values: ["a:b = 'y'"] }]);
    expect(() => pg("SELECT a:b FROM t")).toThrow(SqlParseError);
  });
  it("normalizes array subscripts without spaces", () => {
    const r = parseSelectSQL(
      "SELECT arr [OFFSET (0)].key AS k, f(x) [1] FROM t",
      "bigquery",
    );
    expect(r.select.map((s) => s.expr)).toEqual([
      "arr[OFFSET(0)].key",
      "f(x)[1]",
    ]);
  });
});
