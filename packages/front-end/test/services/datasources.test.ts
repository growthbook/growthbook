import { describe, expect, it } from "vitest";
import { validateSQL } from "@/services/datasources";

describe("validateSQL", () => {
  describe("empty SQL", () => {
    it("throws when sql is empty string", () => {
      expect(() => validateSQL("", [])).toThrow("SQL cannot be empty");
    });
  });

  describe("SELECT ... FROM shape", () => {
    it("accepts a minimal valid SELECT ... FROM query", () => {
      expect(() => validateSQL("SELECT 1 FROM dual", [])).not.toThrow();
    });

    it("accepts lowercase select and from", () => {
      expect(() => validateSQL("select col from my_table", [])).not.toThrow();
    });

    it("accepts multiline SELECT ... FROM", () => {
      expect(() =>
        validateSQL(
          `SELECT
            user_id,
            ts
          FROM events`,
          [],
        ),
      ).not.toThrow();
    });

    it("accepts SELECT DISTINCT", () => {
      expect(() =>
        validateSQL("SELECT DISTINCT user_id FROM users", ["user_id"]),
      ).not.toThrow();
    });

    it("throws when there is no SELECT", () => {
      expect(() => validateSQL("FROM users", [])).toThrow(
        "Invalid SQL. Expecting `SELECT ... FROM ...`",
      );
    });

    it("throws when there is SELECT but no FROM", () => {
      expect(() => validateSQL("SELECT user_id", [])).toThrow(
        "Invalid SQL. Expecting `SELECT ... FROM ...`",
      );
    });

    it("throws when the query does not match SELECT ... FROM", () => {
      expect(() => validateSQL("INSERT INTO t VALUES (1)", [])).toThrow(
        "Invalid SQL. Expecting `SELECT ... FROM ...`",
      );
    });
  });

  describe("trailing semicolons", () => {
    it("throws when the statement ends with a semicolon", () => {
      expect(() => validateSQL("SELECT x FROM y;", [])).toThrow(
        "Don't end your SQL statements with semicolons since it will break our generated queries",
      );
    });

    it("throws when the statement ends with semicolon and trailing spaces", () => {
      expect(() => validateSQL("SELECT x FROM y;   ", [])).toThrow(
        "Don't end your SQL statements with semicolons since it will break our generated queries",
      );
    });

    it("throws when the statement ends with semicolon and trailing newlines", () => {
      expect(() => validateSQL("SELECT x FROM y;\n\n", [])).toThrow(
        "Don't end your SQL statements with semicolons since it will break our generated queries",
      );
    });

    it("does not throw when a semicolon appears mid-query", () => {
      expect(() => validateSQL("SELECT ';' AS delim FROM t", [])).not.toThrow();
    });
  });

  describe("required columns", () => {
    it("does not throw when requiredColumns is empty", () => {
      expect(() => validateSQL("SELECT a FROM b", [])).not.toThrow();
    });

    it("does not throw when all required columns appear in the query", () => {
      expect(() =>
        validateSQL("SELECT user_id, anonymous_id, timestamp FROM events", [
          "user_id",
          "anonymous_id",
          "timestamp",
        ]),
      ).not.toThrow();
    });

    it("matches column names case-insensitively", () => {
      expect(() =>
        validateSQL("SELECT USER_ID, Anonymous_Id FROM events", [
          "user_id",
          "anonymous_id",
        ]),
      ).not.toThrow();
    });

    it("throws listing missing columns when one column is absent", () => {
      expect(() =>
        validateSQL("SELECT user_id FROM events", ["user_id", "timestamp"]),
      ).toThrow('Missing the following required columns: "timestamp"');
    });

    it("throws listing multiple missing columns", () => {
      expect(() =>
        validateSQL("SELECT a FROM t", ["user_id", "timestamp"]),
      ).toThrow(
        'Missing the following required columns: "user_id", "timestamp"',
      );
    });

    it("allows SELECT * without naming required columns explicitly", () => {
      expect(() =>
        validateSQL("SELECT * FROM events", ["user_id", "timestamp"]),
      ).not.toThrow();
    });

    it("allows SELECT * with surrounding whitespace", () => {
      expect(() =>
        validateSQL("SELECT   *   FROM events", ["anything"]),
      ).not.toThrow();
    });

    it("still enforces required columns when listing explicit columns without star", () => {
      expect(() =>
        validateSQL("SELECT user_id, * FROM events", ["user_id", "timestamp"]),
      ).toThrow('Missing the following required columns: "timestamp"');
    });
  });

  describe("WITH (CTE) queries", () => {
    it("accepts a typical WITH ... SELECT ... FROM form", () => {
      expect(() =>
        validateSQL(
          `WITH prep AS (SELECT user_id FROM raw)
           SELECT user_id FROM prep`,
          ["user_id"],
        ),
      ).not.toThrow();
    });
  });
});
