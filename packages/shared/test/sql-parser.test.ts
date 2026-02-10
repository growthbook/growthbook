import {
  parseSelect,
  parseWhereToRowFilters,
  tokenize,
  SqlParseError,
} from "../src/sql-parser";

// ─── 1. Basic SELECT ─────────────────────────────────────────────────────────

describe("Basic SELECT", () => {
  it("parses SELECT *", () => {
    const r = parseSelect("SELECT * FROM users");
    expect(r.select).toEqual([{ expr: "*", alias: null }]);
    expect(r.from).toEqual({ table: "users", alias: null });
  });

  it("parses multiple columns", () => {
    const r = parseSelect("SELECT id, name, email FROM users");
    expect(r.select).toHaveLength(3);
    expect(r.select[0]).toEqual({ expr: "id", alias: null });
    expect(r.select[1]).toEqual({ expr: "name", alias: null });
    expect(r.select[2]).toEqual({ expr: "email", alias: null });
  });

  it("parses explicit AS alias", () => {
    const r = parseSelect("SELECT id AS user_id, name AS user_name FROM users");
    expect(r.select[0]).toEqual({ expr: "id", alias: "user_id" });
    expect(r.select[1]).toEqual({ expr: "name", alias: "user_name" });
  });

  it("parses implicit alias", () => {
    const r = parseSelect("SELECT id uid, MAX(score) best FROM users");
    expect(r.select[0]).toEqual({ expr: "id", alias: "uid" });
    expect(r.select[1]).toEqual({ expr: "MAX ( score )", alias: "best" });
  });

  it("parses DISTINCT", () => {
    const r = parseSelect("SELECT DISTINCT id, name FROM users");
    expect(r.distinct).toBe(true);
    expect(r.select).toHaveLength(2);
  });

  it("parses SELECT without FROM", () => {
    const r = parseSelect("SELECT 1");
    expect(r.select).toEqual([{ expr: "1", alias: null }]);
    expect(r.from).toBeNull();
  });

  it("parses SELECT with expression", () => {
    const r = parseSelect("SELECT 1 + 2 AS total");
    expect(r.select[0]).toEqual({ expr: "1 + 2", alias: "total" });
  });

  it("parses CASE WHEN expression", () => {
    const r = parseSelect(
      "SELECT CASE WHEN x > 0 THEN 'pos' ELSE 'neg' END AS sign FROM t",
    );
    expect(r.select[0].expr).toBe("CASE WHEN x > 0 THEN 'pos' ELSE 'neg' END");
    expect(r.select[0].alias).toBe("sign");
  });

  it("parses function calls in SELECT", () => {
    const r = parseSelect("SELECT COUNT(*), SUM(amount) AS total FROM orders");
    expect(r.select[0]).toEqual({ expr: "COUNT ( * )", alias: null });
    expect(r.select[1]).toEqual({ expr: "SUM ( amount )", alias: "total" });
  });

  it("parses qualified star (t.*)", () => {
    const r = parseSelect("SELECT t.* FROM users t");
    expect(r.select[0]).toEqual({ expr: "t.*", alias: null });
  });

  it("uses last part as implicit alias for dotted column references", () => {
    const r = parseSelect(
      "SELECT t.user_id, t.created_at, s.table.col FROM events t",
    );
    expect(r.select[0]).toEqual({ expr: "t.user_id", alias: "user_id" });
    expect(r.select[1]).toEqual({ expr: "t.created_at", alias: "created_at" });
    expect(r.select[2]).toEqual({ expr: "s.table.col", alias: "col" });
  });
});

// ─── 2. FROM clause ──────────────────────────────────────────────────────────

describe("FROM clause", () => {
  it("parses simple table", () => {
    const r = parseSelect("SELECT * FROM users");
    expect(r.from).toEqual({ table: "users", alias: null });
  });

  it("parses table with alias", () => {
    const r = parseSelect("SELECT * FROM users u");
    expect(r.from).toEqual({ table: "users", alias: "u" });
  });

  it("parses table with AS alias", () => {
    const r = parseSelect("SELECT * FROM users AS u");
    expect(r.from).toEqual({ table: "users", alias: "u" });
  });

  it("parses schema-qualified table", () => {
    const r = parseSelect("SELECT * FROM public.users");
    expect(r.from).toEqual({ table: "public.users", alias: null });
  });

  it("parses backtick-quoted table (BigQuery)", () => {
    const r = parseSelect("SELECT * FROM `project.dataset.table`");
    expect(r.from).toEqual({
      table: "`project.dataset.table`",
      alias: null,
    });
  });

  it("parses subquery in FROM", () => {
    const r = parseSelect("SELECT * FROM (SELECT id FROM users) AS sub");
    expect(r.from!.table).toBe("( SELECT id FROM users )");
    expect(r.from!.alias).toBe("sub");
  });

  it("parses comma-joins as implicit cross joins", () => {
    const r = parseSelect("SELECT * FROM t1, t2, t3");
    expect(r.from).toEqual({ table: "t1", alias: null });
    expect(r.joins).toHaveLength(2);
    expect(r.joins[0]).toEqual({
      joinType: "CROSS JOIN",
      table: "t2",
      alias: null,
      on: null,
      using: null,
    });
    expect(r.joins[1]).toEqual({
      joinType: "CROSS JOIN",
      table: "t3",
      alias: null,
      on: null,
      using: null,
    });
  });

  it("parses comma-joins with aliases", () => {
    const r = parseSelect("SELECT * FROM t1 a, t2 b");
    expect(r.from).toEqual({ table: "t1", alias: "a" });
    expect(r.joins[0]).toEqual({
      joinType: "CROSS JOIN",
      table: "t2",
      alias: "b",
      on: null,
      using: null,
    });
  });
});

// ─── 3. JOINs ────────────────────────────────────────────────────────────────

describe("JOINs", () => {
  it("parses simple JOIN with ON", () => {
    const r = parseSelect(
      "SELECT * FROM users u JOIN orders o ON u.id = o.user_id",
    );
    expect(r.joins).toHaveLength(1);
    expect(r.joins[0].joinType).toBe("JOIN");
    expect(r.joins[0].table).toBe("orders");
    expect(r.joins[0].alias).toBe("o");
    expect(r.joins[0].on).toBe("u.id = o.user_id");
  });

  it("parses LEFT JOIN", () => {
    const r = parseSelect(
      "SELECT * FROM users LEFT JOIN orders ON users.id = orders.user_id",
    );
    expect(r.joins[0].joinType).toBe("LEFT JOIN");
  });

  it("parses LEFT OUTER JOIN", () => {
    const r = parseSelect(
      "SELECT * FROM users LEFT OUTER JOIN orders ON users.id = orders.user_id",
    );
    expect(r.joins[0].joinType).toBe("LEFT OUTER JOIN");
  });

  it("parses RIGHT JOIN", () => {
    const r = parseSelect(
      "SELECT * FROM users RIGHT JOIN orders ON users.id = orders.user_id",
    );
    expect(r.joins[0].joinType).toBe("RIGHT JOIN");
  });

  it("parses FULL OUTER JOIN", () => {
    const r = parseSelect(
      "SELECT * FROM users FULL OUTER JOIN orders ON users.id = orders.user_id",
    );
    expect(r.joins[0].joinType).toBe("FULL OUTER JOIN");
  });

  it("parses CROSS JOIN", () => {
    const r = parseSelect("SELECT * FROM users CROSS JOIN orders");
    expect(r.joins[0].joinType).toBe("CROSS JOIN");
    expect(r.joins[0].table).toBe("orders");
    expect(r.joins[0].on).toBeNull();
  });

  it("parses NATURAL JOIN", () => {
    const r = parseSelect("SELECT * FROM users NATURAL JOIN orders");
    expect(r.joins[0].joinType).toBe("NATURAL JOIN");
  });

  it("parses NATURAL LEFT JOIN", () => {
    const r = parseSelect("SELECT * FROM users NATURAL LEFT JOIN orders");
    expect(r.joins[0].joinType).toBe("NATURAL LEFT JOIN");
  });

  it("parses JOIN with USING", () => {
    const r = parseSelect("SELECT * FROM users JOIN orders USING (user_id)");
    expect(r.joins[0].using).toEqual(["user_id"]);
    expect(r.joins[0].on).toBeNull();
  });

  it("parses USING with multiple columns", () => {
    const r = parseSelect("SELECT * FROM t1 JOIN t2 USING (a, b, c)");
    expect(r.joins[0].using).toEqual(["a", "b", "c"]);
  });

  it("parses multiple joins", () => {
    const r = parseSelect(
      "SELECT * FROM users u JOIN orders o ON u.id = o.user_id LEFT JOIN products p ON o.product_id = p.id",
    );
    expect(r.joins).toHaveLength(2);
    expect(r.joins[0].joinType).toBe("JOIN");
    expect(r.joins[0].table).toBe("orders");
    expect(r.joins[1].joinType).toBe("LEFT JOIN");
    expect(r.joins[1].table).toBe("products");
  });

  it("parses subquery join", () => {
    const r = parseSelect(
      "SELECT * FROM users u JOIN (SELECT user_id, COUNT(*) cnt FROM orders GROUP BY user_id) o ON u.id = o.user_id",
    );
    expect(r.joins[0].table).toBe(
      "( SELECT user_id , COUNT ( * ) cnt FROM orders GROUP BY user_id )",
    );
    expect(r.joins[0].alias).toBe("o");
  });

  it("parses INNER JOIN", () => {
    const r = parseSelect(
      "SELECT * FROM users INNER JOIN orders ON users.id = orders.user_id",
    );
    expect(r.joins[0].joinType).toBe("INNER JOIN");
  });
});

// ─── 4. WHERE ────────────────────────────────────────────────────────────────

describe("WHERE clause", () => {
  it("parses simple condition", () => {
    const r = parseSelect("SELECT * FROM users WHERE id = 1");
    expect(r.where).toBe("id = 1");
  });

  it("parses AND/OR conditions", () => {
    const r = parseSelect(
      "SELECT * FROM users WHERE age > 18 AND status = 'active'",
    );
    expect(r.where).toBe("age > 18 AND status = 'active'");
  });

  it("parses subquery in WHERE", () => {
    const r = parseSelect(
      "SELECT * FROM users WHERE id IN (SELECT user_id FROM orders)",
    );
    expect(r.where).toBe("id IN ( SELECT user_id FROM orders )");
  });

  it("parses BETWEEN", () => {
    const r = parseSelect("SELECT * FROM users WHERE age BETWEEN 18 AND 65");
    expect(r.where).toBe("age BETWEEN 18 AND 65");
  });

  it("parses LIKE", () => {
    const r = parseSelect("SELECT * FROM users WHERE name LIKE '%john%'");
    expect(r.where).toBe("name LIKE '%john%'");
  });

  it("parses CASE in WHERE", () => {
    const r = parseSelect(
      "SELECT * FROM users WHERE CASE WHEN status = 1 THEN 'a' ELSE 'b' END = 'a'",
    );
    expect(r.where).toBe("CASE WHEN status = 1 THEN 'a' ELSE 'b' END = 'a'");
  });
});

// ─── 5. GROUP BY ─────────────────────────────────────────────────────────────

describe("GROUP BY", () => {
  it("parses single column", () => {
    const r = parseSelect("SELECT status, COUNT(*) FROM users GROUP BY status");
    expect(r.groupBy).toEqual(["status"]);
  });

  it("parses multiple columns", () => {
    const r = parseSelect("SELECT a, b, COUNT(*) FROM t GROUP BY a, b");
    expect(r.groupBy).toEqual(["a", "b"]);
  });

  it("parses expression in GROUP BY", () => {
    const r = parseSelect(
      "SELECT DATE(created_at), COUNT(*) FROM t GROUP BY DATE(created_at)",
    );
    expect(r.groupBy).toEqual(["DATE ( created_at )"]);
  });

  it("parses ordinal GROUP BY", () => {
    const r = parseSelect("SELECT a, b, COUNT(*) FROM t GROUP BY 1, 2");
    expect(r.groupBy).toEqual(["1", "2"]);
  });
});

// ─── 6. HAVING ───────────────────────────────────────────────────────────────

describe("HAVING", () => {
  it("parses HAVING clause", () => {
    const r = parseSelect(
      "SELECT status, COUNT(*) cnt FROM users GROUP BY status HAVING COUNT(*) > 5",
    );
    expect(r.having).toBe("COUNT ( * ) > 5");
  });

  it("parses complex HAVING", () => {
    const r = parseSelect(
      "SELECT a, SUM(b) FROM t GROUP BY a HAVING SUM(b) > 10 AND COUNT(*) < 100",
    );
    expect(r.having).toBe("SUM ( b ) > 10 AND COUNT ( * ) < 100");
  });
});

// ─── 7. ORDER BY ─────────────────────────────────────────────────────────────

describe("ORDER BY", () => {
  it("parses simple ORDER BY", () => {
    const r = parseSelect("SELECT * FROM users ORDER BY name");
    expect(r.orderBy).toEqual([{ expr: "name", direction: null, nulls: null }]);
  });

  it("parses ASC", () => {
    const r = parseSelect("SELECT * FROM users ORDER BY name ASC");
    expect(r.orderBy[0].direction).toBe("ASC");
  });

  it("parses DESC", () => {
    const r = parseSelect("SELECT * FROM users ORDER BY name DESC");
    expect(r.orderBy[0].direction).toBe("DESC");
  });

  it("parses NULLS FIRST", () => {
    const r = parseSelect("SELECT * FROM users ORDER BY name ASC NULLS FIRST");
    expect(r.orderBy[0]).toEqual({
      expr: "name",
      direction: "ASC",
      nulls: "FIRST",
    });
  });

  it("parses NULLS LAST", () => {
    const r = parseSelect("SELECT * FROM users ORDER BY name DESC NULLS LAST");
    expect(r.orderBy[0]).toEqual({
      expr: "name",
      direction: "DESC",
      nulls: "LAST",
    });
  });

  it("parses multiple ORDER BY items", () => {
    const r = parseSelect(
      "SELECT * FROM users ORDER BY last_name ASC, first_name DESC",
    );
    expect(r.orderBy).toHaveLength(2);
    expect(r.orderBy[0]).toEqual({
      expr: "last_name",
      direction: "ASC",
      nulls: null,
    });
    expect(r.orderBy[1]).toEqual({
      expr: "first_name",
      direction: "DESC",
      nulls: null,
    });
  });

  it("parses expression in ORDER BY", () => {
    const r = parseSelect("SELECT * FROM users ORDER BY LENGTH(name) DESC");
    expect(r.orderBy[0]).toEqual({
      expr: "LENGTH ( name )",
      direction: "DESC",
      nulls: null,
    });
  });
});

// ─── 8. LIMIT / OFFSET ──────────────────────────────────────────────────────

describe("LIMIT / OFFSET", () => {
  it("parses standard LIMIT", () => {
    const r = parseSelect("SELECT * FROM users LIMIT 10");
    expect(r.limit).toBe("10");
    expect(r.offset).toBeNull();
  });

  it("parses LIMIT with OFFSET", () => {
    const r = parseSelect("SELECT * FROM users LIMIT 10 OFFSET 20");
    expect(r.limit).toBe("10");
    expect(r.offset).toBe("20");
  });

  it("parses MySQL LIMIT offset, count", () => {
    const r = parseSelect("SELECT * FROM users LIMIT 20, 10");
    expect(r.limit).toBe("10");
    expect(r.offset).toBe("20");
  });

  it("parses FETCH FIRST n ROWS ONLY", () => {
    const r = parseSelect("SELECT * FROM users FETCH FIRST 10 ROWS ONLY");
    expect(r.limit).toBe("10");
  });

  it("parses FETCH NEXT n ROWS ONLY", () => {
    const r = parseSelect("SELECT * FROM users FETCH NEXT 5 ROWS ONLY");
    expect(r.limit).toBe("5");
  });

  it("parses OFFSET only", () => {
    const r = parseSelect("SELECT * FROM users OFFSET 10");
    expect(r.offset).toBe("10");
    expect(r.limit).toBeNull();
  });

  it("parses OFFSET with FETCH", () => {
    const r = parseSelect(
      "SELECT * FROM users OFFSET 10 FETCH FIRST 5 ROWS ONLY",
    );
    expect(r.offset).toBe("10");
    expect(r.limit).toBe("5");
  });
});

// ─── 9. Comment stripping ────────────────────────────────────────────────────

describe("Comment stripping", () => {
  it("strips line comments", () => {
    const r = parseSelect("SELECT -- this is a comment\n* FROM users");
    expect(r.select[0].expr).toBe("*");
  });

  it("strips block comments", () => {
    const r = parseSelect("SELECT /* comment */ * FROM users");
    expect(r.select[0].expr).toBe("*");
  });

  it("strips comment inside expression", () => {
    const r = parseSelect("SELECT id, /* skip */ name FROM users");
    expect(r.select).toHaveLength(2);
    expect(r.select[0].expr).toBe("id");
    expect(r.select[1].expr).toBe("name");
  });

  it("preserves comment-like text inside strings", () => {
    const r = parseSelect("SELECT '-- not a comment' AS val");
    expect(r.select[0].expr).toBe("'-- not a comment'");
  });

  it("preserves block comment-like text inside strings", () => {
    const r = parseSelect("SELECT '/* not a comment */' AS val");
    expect(r.select[0].expr).toBe("'/* not a comment */'");
  });

  it("handles comment at end of query", () => {
    const r = parseSelect("SELECT * FROM users -- trailing comment");
    expect(r.from).toEqual({ table: "users", alias: null });
  });
});

// ─── 10. String handling ─────────────────────────────────────────────────────

describe("String handling", () => {
  it("handles backslash escaping", () => {
    const tokens = tokenize("SELECT 'it\\'s'");
    const strToken = tokens.find((t) => t.type === "string");
    expect(strToken!.value).toBe("it's");
    expect(strToken!.raw).toBe("'it\\'s'");
  });

  it("handles doubled-quote escaping", () => {
    const tokens = tokenize("SELECT 'it''s'");
    const strToken = tokens.find((t) => t.type === "string");
    expect(strToken!.value).toBe("it's");
    expect(strToken!.raw).toBe("'it''s'");
  });

  it("handles string containing SQL keywords", () => {
    const r = parseSelect("SELECT 'SELECT * FROM users' AS query");
    expect(r.select[0].expr).toBe("'SELECT * FROM users'");
    expect(r.select[0].alias).toBe("query");
    expect(r.from).toBeNull();
  });

  it("handles empty string", () => {
    const r = parseSelect("SELECT '' AS empty");
    expect(r.select[0].expr).toBe("''");
  });
});

// ─── 11. Quoted identifiers ──────────────────────────────────────────────────

describe("Quoted identifiers", () => {
  it("handles backtick identifiers", () => {
    const r = parseSelect("SELECT `user id` FROM `my table`");
    expect(r.select[0].expr).toBe("`user id`");
    expect(r.from!.table).toBe("`my table`");
  });

  it("handles double-quote identifiers", () => {
    const r = parseSelect('SELECT "user id" FROM "my table"');
    expect(r.select[0].expr).toBe('"user id"');
    expect(r.from!.table).toBe('"my table"');
  });

  it("handles special characters in quoted identifiers", () => {
    const r = parseSelect("SELECT `col-1`, `col.2` FROM `my-table`");
    expect(r.select[0].expr).toBe("`col-1`");
    expect(r.select[1].expr).toBe("`col.2`");
    expect(r.from!.table).toBe("`my-table`");
  });

  it("handles BigQuery backtick project.dataset.table", () => {
    const r = parseSelect("SELECT * FROM `my-project.my_dataset.my_table`");
    expect(r.from!.table).toBe("`my-project.my_dataset.my_table`");
  });
});

// ─── 12. Error cases ─────────────────────────────────────────────────────────

describe("Error cases", () => {
  it("throws on empty input", () => {
    expect(() => parseSelect("")).toThrow(SqlParseError);
    expect(() => parseSelect("   ")).toThrow(SqlParseError);
  });

  it("throws on non-SELECT statement", () => {
    expect(() => parseSelect("INSERT INTO users VALUES (1, 'a')")).toThrow(
      SqlParseError,
    );
    expect(() => parseSelect("UPDATE users SET name = 'a'")).toThrow(
      SqlParseError,
    );
    expect(() => parseSelect("DELETE FROM users")).toThrow(SqlParseError);
  });

  it("throws on CREATE/DROP/ALTER/TRUNCATE", () => {
    expect(() => parseSelect("CREATE TABLE users (id INT)")).toThrow(
      SqlParseError,
    );
    expect(() => parseSelect("DROP TABLE users")).toThrow(SqlParseError);
    expect(() => parseSelect("ALTER TABLE users ADD COLUMN name TEXT")).toThrow(
      SqlParseError,
    );
    expect(() => parseSelect("TRUNCATE TABLE users")).toThrow(SqlParseError);
  });

  it("throws on multiple statements", () => {
    expect(() => parseSelect("SELECT 1; SELECT 2")).toThrow(SqlParseError);
    expect(() => parseSelect("SELECT 1; SELECT 2")).toThrow(
      /Multiple statements/,
    );
  });

  it("throws on multiple statements with different statement types", () => {
    expect(() => parseSelect("SELECT * FROM users; DROP TABLE users")).toThrow(
      /Multiple statements/,
    );
  });

  it("allows trailing semicolons (not multi-statement)", () => {
    const r = parseSelect("SELECT 1;");
    expect(r.select[0].expr).toBe("1");
  });

  it("throws on UNION", () => {
    expect(() =>
      parseSelect("SELECT * FROM users UNION SELECT * FROM admins"),
    ).toThrow(SqlParseError);
    expect(() =>
      parseSelect("SELECT * FROM users UNION SELECT * FROM admins"),
    ).toThrow(/UNION/);
  });

  it("throws on INTERSECT", () => {
    expect(() =>
      parseSelect("SELECT * FROM users INTERSECT SELECT * FROM admins"),
    ).toThrow(/INTERSECT/);
  });

  it("throws on EXCEPT", () => {
    expect(() =>
      parseSelect("SELECT * FROM users EXCEPT SELECT * FROM admins"),
    ).toThrow(/EXCEPT/);
  });

  it("throws on unterminated string", () => {
    expect(() => parseSelect("SELECT 'unterminated")).toThrow(SqlParseError);
    expect(() => parseSelect("SELECT 'unterminated")).toThrow(
      /Unterminated string/,
    );
  });

  it("throws on unterminated double-quote identifier", () => {
    expect(() => parseSelect('SELECT "unterminated')).toThrow(
      /Unterminated quoted identifier/,
    );
  });

  it("throws on unterminated backtick identifier", () => {
    expect(() => parseSelect("SELECT `unterminated")).toThrow(
      /Unterminated backtick identifier/,
    );
  });

  it("throws on unterminated block comment", () => {
    expect(() => parseSelect("SELECT /* unterminated")).toThrow(
      /Unterminated block comment/,
    );
  });

  it("throws on unbalanced parens", () => {
    expect(() => parseSelect("SELECT * FROM (users")).toThrow(
      /Unbalanced parentheses/,
    );
  });

  it("SqlParseError has position", () => {
    try {
      parseSelect("SELECT 'unterminated");
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SqlParseError);
      expect((e as SqlParseError).position).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── 13. CTEs ────────────────────────────────────────────────────────────────

describe("CTEs", () => {
  it("parses simple CTE", () => {
    const r = parseSelect(
      "WITH cte AS (SELECT id FROM users) SELECT * FROM cte",
    );
    expect(r.ctes).toHaveLength(1);
    expect(r.ctes[0].name).toBe("cte");
    expect(r.ctes[0].columns).toBeNull();
    expect(r.ctes[0].body).toBe("SELECT id FROM users");
    expect(r.from).toEqual({ table: "cte", alias: null });
  });

  it("parses CTE with column list", () => {
    const r = parseSelect(
      "WITH cte (a, b) AS (SELECT id, name FROM users) SELECT * FROM cte",
    );
    expect(r.ctes).toHaveLength(1);
    expect(r.ctes[0].name).toBe("cte");
    expect(r.ctes[0].columns).toEqual(["a", "b"]);
    expect(r.ctes[0].body).toBe("SELECT id , name FROM users");
  });

  it("parses multiple CTEs", () => {
    const r = parseSelect(`
      WITH
        active_users AS (SELECT * FROM users WHERE status = 'active'),
        recent_orders AS (SELECT * FROM orders WHERE created_at > '2023-01-01')
      SELECT u.name, o.id
      FROM active_users u
      JOIN recent_orders o ON u.id = o.user_id
    `);
    expect(r.ctes).toHaveLength(2);
    expect(r.ctes[0].name).toBe("active_users");
    expect(r.ctes[0].body).toContain("SELECT");
    expect(r.ctes[0].body).toContain("users");
    expect(r.ctes[1].name).toBe("recent_orders");
    expect(r.ctes[1].body).toContain("orders");
    expect(r.from!.table).toBe("active_users");
    expect(r.joins).toHaveLength(1);
  });

  it("parses WITH RECURSIVE", () => {
    const r = parseSelect(`
      WITH RECURSIVE tree AS (
        SELECT id, parent_id, name FROM categories WHERE parent_id IS NULL
      )
      SELECT * FROM tree
    `);
    expect(r.ctes).toHaveLength(1);
    expect(r.ctes[0].name).toBe("tree");
    expect(r.ctes[0].body).toContain("categories");
  });

  it("parses CTE with nested subquery in body", () => {
    const r = parseSelect(`
      WITH cte AS (SELECT * FROM (SELECT id FROM users) sub)
      SELECT * FROM cte
    `);
    expect(r.ctes).toHaveLength(1);
    expect(r.ctes[0].body).toContain("sub");
  });

  it("returns empty ctes for non-CTE queries", () => {
    const r = parseSelect("SELECT 1");
    expect(r.ctes).toEqual([]);
  });
});

// ─── 14. Complex real-world queries ──────────────────────────────────────────

describe("Complex real-world queries", () => {
  it("parses a query with all clauses", () => {
    const sql = `
      SELECT
        u.id,
        u.name AS user_name,
        COUNT(o.id) AS order_count,
        SUM(o.amount) AS total_amount
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
      WHERE u.status = 'active'
        AND u.created_at > '2023-01-01'
      GROUP BY u.id, u.name
      HAVING COUNT(o.id) > 0
      ORDER BY total_amount DESC NULLS LAST
      LIMIT 100
      OFFSET 0
    `;

    const r = parseSelect(sql);

    expect(r.select).toHaveLength(4);
    expect(r.select[0]).toEqual({ expr: "u.id", alias: "id" });
    expect(r.select[1]).toEqual({ expr: "u.name", alias: "user_name" });
    expect(r.select[2]).toEqual({
      expr: "COUNT ( o.id )",
      alias: "order_count",
    });
    expect(r.select[3]).toEqual({
      expr: "SUM ( o.amount )",
      alias: "total_amount",
    });

    expect(r.distinct).toBe(false);
    expect(r.from).toEqual({ table: "users", alias: "u" });
    expect(r.joins).toHaveLength(1);
    expect(r.joins[0].joinType).toBe("LEFT JOIN");
    expect(r.joins[0].table).toBe("orders");
    expect(r.joins[0].alias).toBe("o");
    expect(r.joins[0].on).toBe("u.id = o.user_id");

    expect(r.where).toBe("u.status = 'active' AND u.created_at > '2023-01-01'");
    expect(r.groupBy).toEqual(["u.id", "u.name"]);
    expect(r.having).toBe("COUNT ( o.id ) > 0");
    expect(r.orderBy).toEqual([
      { expr: "total_amount", direction: "DESC", nulls: "LAST" },
    ]);
    expect(r.limit).toBe("100");
    expect(r.offset).toBe("0");
  });

  it("parses multi-join query", () => {
    const sql = `
      SELECT
        u.name,
        o.id AS order_id,
        p.name AS product_name,
        c.name AS category_name
      FROM users u
      INNER JOIN orders o ON u.id = o.user_id
      INNER JOIN order_items oi ON o.id = oi.order_id
      INNER JOIN products p ON oi.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE o.status = 'completed'
      ORDER BY o.id DESC
    `;

    const r = parseSelect(sql);
    expect(r.joins).toHaveLength(4);
    expect(r.joins[0].table).toBe("orders");
    expect(r.joins[1].table).toBe("order_items");
    expect(r.joins[2].table).toBe("products");
    expect(r.joins[3].table).toBe("categories");
  });

  it("parses nested expressions in SELECT", () => {
    const sql = `
      SELECT
        CASE
          WHEN age < 18 THEN 'minor'
          WHEN age BETWEEN 18 AND 65 THEN 'adult'
          ELSE 'senior'
        END AS age_group,
        COUNT(*) AS cnt
      FROM users
      GROUP BY 1
      ORDER BY cnt DESC
    `;

    const r = parseSelect(sql);
    expect(r.select[0].alias).toBe("age_group");
    expect(r.select[0].expr).toContain("CASE");
    expect(r.select[0].expr).toContain("END");
    expect(r.select[1]).toEqual({ expr: "COUNT ( * )", alias: "cnt" });
    expect(r.groupBy).toEqual(["1"]);
  });

  it("handles PostgreSQL :: cast operator", () => {
    const r = parseSelect("SELECT created_at::date AS day FROM events");
    expect(r.select[0].expr).toBe("created_at :: date");
    expect(r.select[0].alias).toBe("day");
  });

  it("handles query with trailing semicolon", () => {
    const r = parseSelect("SELECT * FROM users;");
    expect(r.from).toEqual({ table: "users", alias: null });
  });

  it("handles case-insensitive keywords", () => {
    const r = parseSelect(
      "select * from users where id = 1 order by name limit 10",
    );
    expect(r.from).toEqual({ table: "users", alias: null });
    expect(r.where).toBe("id = 1");
    expect(r.orderBy).toHaveLength(1);
    expect(r.limit).toBe("10");
  });

  it("handles deeply nested subqueries", () => {
    const r = parseSelect(
      "SELECT * FROM (SELECT * FROM (SELECT id FROM users) inner_sub) outer_sub",
    );
    expect(r.from!.alias).toBe("outer_sub");
  });

  it("handles mixed comma-joins and explicit joins", () => {
    const sql = "SELECT * FROM t1, t2 JOIN t3 ON t2.id = t3.t2_id";
    const r = parseSelect(sql);
    expect(r.from).toEqual({ table: "t1", alias: null });
    // t2 becomes implicit cross join, t3 is explicit join
    expect(r.joins).toHaveLength(2);
    expect(r.joins[0].table).toBe("t2");
    expect(r.joins[1].joinType).toBe("JOIN");
    expect(r.joins[1].table).toBe("t3");
  });
});

describe("parseWhereToRowFilters", () => {
  describe("simple comparisons", () => {
    it("parses = with string value", () => {
      const filters = parseWhereToRowFilters("status = 'active'");
      expect(filters).toEqual([
        { operator: "=", column: "status", values: ["active"] },
      ]);
    });

    it("parses != with string value", () => {
      const filters = parseWhereToRowFilters("status != 'deleted'");
      expect(filters).toEqual([
        { operator: "!=", column: "status", values: ["deleted"] },
      ]);
    });

    it("parses <> as !=", () => {
      const filters = parseWhereToRowFilters("status <> 'deleted'");
      expect(filters).toEqual([
        { operator: "!=", column: "status", values: ["deleted"] },
      ]);
    });

    it("parses > with numeric value", () => {
      const filters = parseWhereToRowFilters("amount > 100");
      expect(filters).toEqual([
        { operator: ">", column: "amount", values: ["100"] },
      ]);
    });

    it("parses <= with numeric value", () => {
      const filters = parseWhereToRowFilters("age <= 30");
      expect(filters).toEqual([
        { operator: "<=", column: "age", values: ["30"] },
      ]);
    });

    it("parses dotted column names", () => {
      const filters = parseWhereToRowFilters("t.status = 'active'");
      expect(filters).toEqual([
        { operator: "=", column: "t.status", values: ["active"] },
      ]);
    });
  });

  describe("IN / NOT IN", () => {
    it("parses IN with string values", () => {
      const filters = parseWhereToRowFilters("status IN ('active', 'pending')");
      expect(filters).toEqual([
        { operator: "in", column: "status", values: ["active", "pending"] },
      ]);
    });

    it("parses NOT IN with string values", () => {
      const filters = parseWhereToRowFilters(
        "status NOT IN ('deleted', 'archived')",
      );
      expect(filters).toEqual([
        {
          operator: "not_in",
          column: "status",
          values: ["deleted", "archived"],
        },
      ]);
    });

    it("parses IN with numeric values", () => {
      const filters = parseWhereToRowFilters("id IN (1, 2, 3)");
      expect(filters).toEqual([
        { operator: "in", column: "id", values: ["1", "2", "3"] },
      ]);
    });
  });

  describe("IS NULL / IS NOT NULL", () => {
    it("parses IS NULL", () => {
      const filters = parseWhereToRowFilters("deleted_at IS NULL");
      expect(filters).toEqual([{ operator: "is_null", column: "deleted_at" }]);
    });

    it("parses IS NOT NULL", () => {
      const filters = parseWhereToRowFilters("email IS NOT NULL");
      expect(filters).toEqual([{ operator: "not_null", column: "email" }]);
    });
  });

  describe("IS TRUE / IS FALSE", () => {
    it("parses IS TRUE", () => {
      const filters = parseWhereToRowFilters("is_active IS TRUE");
      expect(filters).toEqual([{ operator: "is_true", column: "is_active" }]);
    });

    it("parses IS FALSE", () => {
      const filters = parseWhereToRowFilters("is_active IS FALSE");
      expect(filters).toEqual([{ operator: "is_false", column: "is_active" }]);
    });
  });

  describe("LIKE patterns", () => {
    it("parses LIKE %...% as contains", () => {
      const filters = parseWhereToRowFilters("name LIKE '%john%'");
      expect(filters).toEqual([
        { operator: "contains", column: "name", values: ["john"] },
      ]);
    });

    it("parses LIKE ...% as starts_with", () => {
      const filters = parseWhereToRowFilters("name LIKE 'john%'");
      expect(filters).toEqual([
        { operator: "starts_with", column: "name", values: ["john"] },
      ]);
    });

    it("parses LIKE %... as ends_with", () => {
      const filters = parseWhereToRowFilters("name LIKE '%son'");
      expect(filters).toEqual([
        { operator: "ends_with", column: "name", values: ["son"] },
      ]);
    });

    it("parses NOT LIKE %...% as not_contains", () => {
      const filters = parseWhereToRowFilters("name NOT LIKE '%test%'");
      expect(filters).toEqual([
        { operator: "not_contains", column: "name", values: ["test"] },
      ]);
    });
  });

  describe("compound AND", () => {
    it("splits AND into multiple filters", () => {
      const filters = parseWhereToRowFilters(
        "status = 'active' AND region = 'us'",
      );
      expect(filters).toEqual([
        { operator: "=", column: "status", values: ["active"] },
        { operator: "=", column: "region", values: ["us"] },
      ]);
    });

    it("handles AND with mixed operator types", () => {
      const filters = parseWhereToRowFilters(
        "status = 'active' AND deleted_at IS NULL AND amount > 0",
      );
      expect(filters).toEqual([
        { operator: "=", column: "status", values: ["active"] },
        { operator: "is_null", column: "deleted_at" },
        { operator: ">", column: "amount", values: ["0"] },
      ]);
    });
  });

  describe("fallback to sql_expr", () => {
    it("falls back for OR expressions", () => {
      const where = "status = 'active' OR status = 'pending'";
      const filters = parseWhereToRowFilters(where);
      expect(filters).toEqual([{ operator: "sql_expr", values: [where] }]);
    });

    it("falls back for BETWEEN", () => {
      const where = "amount BETWEEN 10 AND 100";
      const filters = parseWhereToRowFilters(where);
      expect(filters).toEqual([{ operator: "sql_expr", values: [where] }]);
    });

    it("falls back for subquery in IN", () => {
      const where = "id IN (SELECT id FROM other)";
      const filters = parseWhereToRowFilters(where);
      expect(filters).toEqual([{ operator: "sql_expr", values: [where] }]);
    });

    it("falls back for function calls", () => {
      const where = "LOWER(status) = 'active'";
      const filters = parseWhereToRowFilters(where);
      expect(filters).toEqual([{ operator: "sql_expr", values: [where] }]);
    });

    it("falls back for LIKE without wildcard", () => {
      const where = "name LIKE 'exact'";
      const filters = parseWhereToRowFilters(where);
      expect(filters).toEqual([{ operator: "sql_expr", values: [where] }]);
    });

    it("falls back when any conjunct is unparseable", () => {
      const where = "status = 'active' AND LOWER(name) = 'test'";
      const filters = parseWhereToRowFilters(where);
      expect(filters).toEqual([{ operator: "sql_expr", values: [where] }]);
    });

    it("falls back for NOT LIKE without %...% pattern", () => {
      const where = "name NOT LIKE 'test%'";
      const filters = parseWhereToRowFilters(where);
      expect(filters).toEqual([{ operator: "sql_expr", values: [where] }]);
    });
  });
});
