import {
  decodeSQLResults,
  encodeSQLResults,
  ensureLimit,
  format,
  isMultiStatementSQL,
  isReadOnlySQL,
} from "../src/sql";

describe("format", () => {
  it("returns original SQL when no dialect provided", () => {
    const sql = "SELECT id, name FROM users WHERE active = true";
    expect(format(sql)).toBe(sql);
    expect(format(sql, undefined)).toBe(sql);
  });

  it("returns original SQL when dialect is empty string", () => {
    const sql = "SELECT * FROM users";
    expect(format(sql, "")).toBe(sql);
  });

  it("formats valid SQL when dialect is provided", () => {
    const sql = "SELECT id,name FROM users WHERE active=true";
    const result = format(sql, "postgresql");
    // Either polyglot or sql-formatter will add newlines/indentation
    expect(result).not.toBe(sql);
    expect(result).toContain("SELECT");
    expect(result).toContain("users");
  });

  it("falls back to original when SQL has unsupported syntax", () => {
    // ClickHouse ternary - polyglot may not parse; sql-formatter v15 formats it
    const sql = "SELECT x > 0 ? 1 : 0 FROM t";
    const result = format(sql, "postgresql");
    expect(result).toContain("x > 0");
    expect(result).toContain("?");
    expect(result).toContain("FROM");
    expect(result).toContain("t");
  });

  it("falls back to original when SQL is invalid", () => {
    const sql = "SELECT (a* as c";
    const result = format(sql, "mysql");
    expect(result).toBe(sql);
  });

  it("calls onError when formatting fails and no fallback succeeds", () => {
    const sql = "SELECT (a* as c";
    const onError = jest.fn();
    const result = format(sql, "mysql", onError);
    expect(result).toBe(sql);
    // sql-formatter throws on invalid SQL; onError is called
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        originalSql: sql,
        error: expect.any(Error),
      }),
    );
  });
});

describe("ensureLimit", () => {
  describe("already has LIMIT and OFFSET clauses", () => {
    it("should replace existing LIMIT and OFFSET clauses", () => {
      const sql = "SELECT * FROM users LIMIT 50 OFFSET 20";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users LIMIT 10 OFFSET 20");
    });
    it("should not change the SQL if the limit is greater than or equal to existing limit", () => {
      const sql = "SELECT * FROM users LIMIT 10 OFFSET 20";
      const result = ensureLimit(sql, 15);
      expect(result).toBe("SELECT * FROM users LIMIT 10 OFFSET 20");
    });
    it("should handle semicolon at the end with LIMIT and OFFSET", () => {
      const sql = "SELECT * FROM users LIMIT 50 OFFSET 20;";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users LIMIT 10 OFFSET 20");
    });
    it("should handle lowercase limit/offset keywords", () => {
      const sql = "SELECT * FROM users limit 50 offset 20";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users LIMIT 10 OFFSET 20");
    });
  });
  describe("has OFFSET clause only", () => {
    it("should replace OFFSET with LIMIT and OFFSET", () => {
      const sql = "SELECT * FROM users OFFSET 20";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users LIMIT 10 OFFSET 20");
    });
    it("should handle semicolon at the end with OFFSET", () => {
      const sql = "SELECT * FROM users OFFSET 20;";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users LIMIT 10 OFFSET 20");
    });
    it("should handle lowercase offset keyword", () => {
      const sql = "SELECT * FROM users offset 20";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users LIMIT 10 OFFSET 20");
    });
  });
  describe("has 2-number LIMIT clause", () => {
    it("should replace existing LIMIT with two numbers", () => {
      const sql = "SELECT * FROM users LIMIT 20, 50";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users LIMIT 20, 10");
    });
    it("should not change the SQL if the limit is greater than or equal to existing limit", () => {
      const sql = "SELECT * FROM users LIMIT 20, 10";
      const result = ensureLimit(sql, 15);
      expect(result).toBe("SELECT * FROM users LIMIT 20, 10");
    });
    it("should handle semicolon at the end with two numbers", () => {
      const sql = "SELECT * FROM users LIMIT 20, 50;";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users LIMIT 20, 10");
    });
    it("should handle lowercase limit keyword with two numbers", () => {
      const sql = "SELECT * FROM users limit 20, 50";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users LIMIT 20, 10");
    });
  });
  describe("has 1-number LIMIT clause only", () => {
    it("should replace existing LIMIT clause", () => {
      const sql = "SELECT * FROM users LIMIT 50";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users LIMIT 10");
    });
    it("should not change the SQL if the limit is greater than or equal to existing limit", () => {
      const sql = "SELECT * FROM users LIMIT 10";
      const result = ensureLimit(sql, 15);
      expect(result).toBe("SELECT * FROM users LIMIT 10");
    });
    it("should handle semicolon at the end with LIMIT", () => {
      const sql = "SELECT * FROM users LIMIT 50;";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users LIMIT 10");
    });
    it("should handle lowercase limit keyword", () => {
      const sql = "SELECT * FROM users limit 50";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users LIMIT 10");
    });
  });

  describe("no LIMIT or OFFSET clauses", () => {
    it("should append LIMIT at the end", () => {
      const sql = "SELECT * FROM users";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users\nLIMIT 10");
    });
    it("should handle semicolon at the end without LIMIT or OFFSET", () => {
      const sql = "SELECT * FROM users;";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users\nLIMIT 10");
    });
  });

  describe("edge cases", () => {
    it("should handle complex case with subquery that has LIMIT", () => {
      const sql = "SELECT * FROM (SELECT * FROM users LIMIT 50) AS subquery";
      const result = ensureLimit(sql, 10);
      expect(result).toBe(
        "SELECT * FROM (SELECT * FROM users LIMIT 50) AS subquery\nLIMIT 10",
      );
    });
    it("should handle WHERE clause with deceptive LIMIT in string", () => {
      const sql = "SELECT * FROM users WHERE test = 'LIMIT 5'";
      const result = ensureLimit(sql, 10);
      expect(result).toBe(
        "SELECT * FROM users WHERE test = 'LIMIT 5'\nLIMIT 10",
      );
    });
    it("should handle SQL with single-line comments", () => {
      const sql = "SELECT * FROM users -- something";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users -- something\nLIMIT 10");
    });
    it("should handle SQL with multi-line comments", () => {
      const sql = "SELECT * FROM users /* LIMIT 5 \n*/";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users /* LIMIT 5 \n*/\nLIMIT 10");
    });
    // TODO: properly parse comments and ignore them when looking for keywords
    it.skip("should handle comments in the middle of LIMIT", () => {
      const sql = "SELECT * FROM users LI/*\ntest\n*/MIT/* LIMIT 5 */ 5";
      const result = ensureLimit(sql, 10);
      expect(result).toBe(
        "SELECT * FROM users LI/*\ntest\n*/MIT/* LIMIT 5 */ 5",
      );
    });
    // TODO: properly parse comments to remove trailing semicolons
    it.skip("should handle comments and semicolons at end", () => {
      const sql = "SELECT * FROM users; -- testing\n";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users -- testing\nLIMIT 10");
    });
    // TODO: properly parse comments to ignore LIMIT in comments
    it.skip("should handle SQL with single-line comments with deceptive LIMIT", () => {
      const sql = "SELECT * FROM users -- LIMIT 5";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users -- LIMIT 5\nLIMIT 10");
    });
    // TODO: Handle complex expressions in LIMIT clause
    it.skip("should handle complex expressions in LIMIT clause", () => {
      const sql = "SELECT * FROM users LIMIT abs(-10) + 5";
      const result = ensureLimit(sql, 10);
      expect(result).toBe("SELECT * FROM users LIMIT 10");
    });
  });
});

describe("isReadOnlySQL", () => {
  it("should return true for simple SELECT queries", () => {
    const sql = "SELECT * FROM users";
    expect(isReadOnlySQL(sql)).toBe(true);
  });

  it("should return false for INSERT queries", () => {
    const sql = "INSERT INTO users (name) VALUES ('John')";
    expect(isReadOnlySQL(sql)).toBe(false);
  });

  it("should return false for UPDATE queries", () => {
    const sql = "UPDATE users SET name = 'Jane' WHERE id = 1";
    expect(isReadOnlySQL(sql)).toBe(false);
  });

  it("should return false for DELETE queries", () => {
    const sql = "DELETE FROM users WHERE id = 1";
    expect(isReadOnlySQL(sql)).toBe(false);
  });

  it("should return true for complex SELECT queries with joins", () => {
    const sql =
      "SELECT u.name, o.amount FROM users u JOIN orders o ON u.id = o.user_id";
    expect(isReadOnlySQL(sql)).toBe(true);
  });

  it("should return true for SELECT with subqueries", () => {
    const sql = "SELECT * FROM (SELECT * FROM users) AS subquery";
    expect(isReadOnlySQL(sql)).toBe(true);
  });
  it("should return false for DDL statements like CREATE TABLE", () => {
    const sql = "CREATE TABLE new_table (id INT, name VARCHAR(100))";
    expect(isReadOnlySQL(sql)).toBe(false);
  });
  it("should allow CTEs", () => {
    const sql = `
      WITH recent_users AS (
        SELECT * FROM users WHERE created_at > NOW() - INTERVAL '30 days'
      )
      SELECT * FROM recent_users WHERE active = true;
    `;
    expect(isReadOnlySQL(sql)).toBe(true);
  });
  it("should return true for select queries with comments", () => {
    const sql = "-- INSERT INTO users\nSELECT * FROM users";
    expect(isReadOnlySQL(sql)).toBe(true);
  });

  it("should return true for select queries with block comments", () => {
    const sql = "/* INSERT INTO users */SELECT * FROM users";
    expect(isReadOnlySQL(sql)).toBe(true);
  });
  it("should return false for write queries with comments", () => {
    const sql =
      "-- SELECT * from users\nINSERT INTO users (name) VALUES ('John')";
    expect(isReadOnlySQL(sql)).toBe(false);
  });
  it("should not allow insert from select", () => {
    const sql = "INSERT INTO users SELECT * FROM new_users";
    expect(isReadOnlySQL(sql)).toBe(false);
  });
  it("should allow explain queries", () => {
    const sql = "EXPLAIN SELECT * FROM users";
    expect(isReadOnlySQL(sql)).toBe(true);
  });
  it("should allow show queries", () => {
    const sql = "SHOW TABLES";
    expect(isReadOnlySQL(sql)).toBe(true);
  });
  it("should allow describe queries", () => {
    const sql = "DESCRIBE users";
    expect(isReadOnlySQL(sql)).toBe(true);
  });
  it("should allow desc queries", () => {
    const sql = "DESC users";
    expect(isReadOnlySQL(sql)).toBe(true);
  });
  it("should ignore whitespace at the start", () => {
    const sql = "  \n\t\n--test\n \nUPDATE users";
    expect(isReadOnlySQL(sql)).toBe(false);
  });
  it("should ignore whitespace at the start for readonly queries", () => {
    const sql = "  \n\t\n--test\n \nSELECT * from users";
    expect(isReadOnlySQL(sql)).toBe(true);
  });
  it("should return false for unknown starting keywords", () => {
    const sql = "UNKNOWN * FROM users";
    expect(isReadOnlySQL(sql)).toBe(false);
  });
  it("handles line comment inside block comment", () => {
    const sql = "/* Outer comment -- */ DROP TABLE users;\nSELECT * FROM users";
    expect(isReadOnlySQL(sql)).toBe(false);
  });
  it("handles block comment inside line comment", () => {
    const sql = `-- /*\nDROP TABLE users\n-- */ SELECT 1`;
    expect(isReadOnlySQL(sql)).toBe(false);
  });
  it("cannot be tricked by nested comments and an IN clause", () => {
    const sql = `-- /*\nDELETE FROM users WHERE id NOT IN (--*/\nSELECT 1)`;
    expect(isReadOnlySQL(sql)).toBe(false);
  });
});
describe("isMultiStatementSQL", () => {
  it("should return true for multiple statements", () => {
    const sql = "SELECT * FROM users; SELECT * FROM orders;";
    expect(isMultiStatementSQL(sql)).toBe(true);
  });

  it("should return false for single statement", () => {
    const sql = "SELECT * FROM users;";
    expect(isMultiStatementSQL(sql)).toBe(false);
  });

  it("should ignore comments when counting statements", () => {
    const sql = `
      -- This is a comment; Select 1;
      SELECT * FROM users; /* Another comment; SELECT 1; */
    `;
    expect(isMultiStatementSQL(sql)).toBe(false);
  });

  it("should handle statements without semicolons", () => {
    const sql = "SELECT * FROM users";
    expect(isMultiStatementSQL(sql)).toBe(false);
  });

  it("should handle complex multi-statement SQL", () => {
    const sql = `
      WITH recent_orders AS (
        SELECT * FROM orders WHERE created_at > NOW() - INTERVAL '7 days'
      )
      SELECT * FROM recent_orders WHERE amount > 100;
    `;
    expect(isMultiStatementSQL(sql)).toBe(false);
  });
  it("should ignore semicolons within simple strings", () => {
    const sql = "SELECT 'This is a test; still in string' AS test_col;";
    expect(isMultiStatementSQL(sql)).toBe(false);
  });
  it("should handle CTAS statements", () => {
    const sql = "CREATE TABLE new_table AS SELECT * FROM users";
    expect(isMultiStatementSQL(sql)).toBe(false);
  });
  it("is not tricked by quotes and block comments", () => {
    const sql = `SELECT '/*'; DROP TABLE users; SELECT '*/';`;
    expect(isMultiStatementSQL(sql)).toBe(true);
  });
  it("is not tricked by quotes and line comments", () => {
    const sql = `SELECT '--'; DROP TABLE users`;
    expect(isMultiStatementSQL(sql)).toBe(true);
  });
  it("is not tricked by backslash escaped strings", () => {
    const sql = `SELECT 'It\\'s a test'; DROP TABLE users; SELECT '1';`;
    expect(isMultiStatementSQL(sql)).toBe(true);
  });
  it("is not tricked by fake escaped backslashes", () => {
    const sql = `SELECT 'This is a backslash: \\\\'; DROP TABLE users; SELECT '1';`;
    expect(isMultiStatementSQL(sql)).toBe(true);
  });
  it("is not tricked by single quotes that are escaped by doubling the quotes", () => {
    const sql = `SELECT 'It''s a test'; DROP TABLE users; SELECT '1';`;
    expect(isMultiStatementSQL(sql)).toBe(true);
  });

  it("is not tricked by double quotes and block comments", () => {
    const sql = `SELECT "/*"; DROP TABLE users; SELECT "*/";`;
    expect(isMultiStatementSQL(sql)).toBe(true);
  });
  it("is not tricked by double quotes and line comments", () => {
    const sql = `SELECT "--"; DROP TABLE users`;
    expect(isMultiStatementSQL(sql)).toBe(true);
  });
  it("is not tricked by backslash escaped double quoted strings", () => {
    const sql = `SELECT "It\\'s a test"; DROP TABLE users; SELECT "1";`;
    expect(isMultiStatementSQL(sql)).toBe(true);
  });
  it("is not tricked by fake escaped backslashes in double quoted strings", () => {
    const sql = `SELECT "This is a backslash: \\\\"; DROP TABLE users; SELECT "1";`;
    expect(isMultiStatementSQL(sql)).toBe(true);
  });
  it("is not tricked by single quotes that are escaped by doubling the double quotes", () => {
    const sql = `SELECT "It''s a test"; DROP TABLE users; SELECT "1";`;
    expect(isMultiStatementSQL(sql)).toBe(true);
  });

  it("is not tricked by backtick quotes and block comments", () => {
    const sql = `SELECT \`/*\`; DROP TABLE users; SELECT \`*/\`;`;
    expect(isMultiStatementSQL(sql)).toBe(true);
  });
  it("is not tricked by backtick quotes and line comments", () => {
    const sql = `SELECT \`--\`; DROP TABLE users`;
    expect(isMultiStatementSQL(sql)).toBe(true);
  });
  it("is not tricked by doubled backticks", () => {
    const sql = `SELECT \`It\`\`s a test\`; DROP TABLE users; SELECT \`1\`;`;
    expect(isMultiStatementSQL(sql)).toBe(true);
  });
  it("allows parse errors as long as there are no semicolons", () => {
    const sql = `SELECT 'It\\'`;
    expect(isMultiStatementSQL(sql)).toBe(false);
  });
  it("allows parse errors as long as there is only a trailing semicolon", () => {
    const sql = `SELECT 'It\\'; `;
    expect(isMultiStatementSQL(sql)).toBe(false);
  });
  it("blocks all internal semicolons when there is a parse error", () => {
    const sql = `SELECT 'It\\'; DROP TABLE users`;
    expect(isMultiStatementSQL(sql)).toBe(true);
  });
});

describe("encodeSQLResults", () => {
  it("should encode and decode SQL results correctly", () => {
    const results = [
      { id: 1, name: "Alice", age: 30 },
      { id: 2, name: "Bob", age: 25 },
      { id: 3, name: "Charlie", age: 35 },
    ];

    const encoded = encodeSQLResults(results);
    expect(encoded).toEqual([
      {
        numRows: 3,
        data: {
          id: [1, 2, 3],
          name: ["Alice", "Bob", "Charlie"],
          age: [30, 25, 35],
        },
      },
    ]);

    const decoded = decodeSQLResults(encoded);
    expect(decoded).toEqual(results);
  });

  it("should chunk results", () => {
    const results = [
      { id: 1, name: "Alice", age: 30 },
      { id: 2, name: "Bob", age: 25 },
      { id: 3, name: "Charlie", age: 35 },
    ];

    const encoded = encodeSQLResults(results, 50);
    expect(encoded).toEqual([
      {
        numRows: 2,
        data: {
          id: [1, 2],
          name: ["Alice", "Bob"],
          age: [30, 25],
        },
      },
      {
        numRows: 1,
        data: {
          id: [3],
          name: ["Charlie"],
          age: [35],
        },
      },
    ]);

    const decoded = decodeSQLResults(encoded);
    expect(decoded).toEqual(results);
  });
});
