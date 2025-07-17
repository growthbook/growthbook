import { ensureLimit } from "../src/sql";

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
