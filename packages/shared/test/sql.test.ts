import { ensureLimit, isReadOnlySQL } from "../src/sql";

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
        "SELECT * FROM (SELECT * FROM users LIMIT 50) AS subquery\nLIMIT 10"
      );
    });
    it("should handle WHERE clause with deceptive LIMIT in string", () => {
      const sql = "SELECT * FROM users WHERE test = 'LIMIT 5'";
      const result = ensureLimit(sql, 10);
      expect(result).toBe(
        "SELECT * FROM users WHERE test = 'LIMIT 5'\nLIMIT 10"
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
        "SELECT * FROM users LI/*\ntest\n*/MIT/* LIMIT 5 */ 5"
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
});
