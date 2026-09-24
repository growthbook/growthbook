import { describe, expect, it } from "vitest";
import {
  getFactTableSelectList,
  getUserIdTypesInSql,
  validateSQL,
} from "@/services/datasources";

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

describe("getUserIdTypesInSql", () => {
  const idTypes = ["user_id", "anonymous_id", "device_id", "account_id"];
  const getColumn = (idType: string) => idType;

  it("keeps only the identifier types whose columns the SQL returns", () => {
    const sql = "SELECT user_id, device_id, ts FROM events";
    expect(getUserIdTypesInSql(sql, idTypes, getColumn)).toEqual([
      "user_id",
      "device_id",
    ]);
  });

  it("matches column names case-insensitively", () => {
    expect(
      getUserIdTypesInSql(
        "SELECT USER_ID, ts FROM events",
        ["user_id"],
        getColumn,
      ),
    ).toEqual(["user_id"]);
  });

  it("keeps every selected identifier type for SELECT *", () => {
    expect(
      getUserIdTypesInSql("SELECT * FROM events", idTypes, getColumn),
    ).toEqual(idTypes);
  });

  it("matches a JSON field path mapping on its root column", () => {
    expect(
      getUserIdTypesInSql(
        "SELECT props, ts FROM events",
        ["user_id"],
        () => "props.user_id",
      ),
    ).toEqual(["user_id"]);
  });

  it("returns an empty list when the SQL returns no identifier columns", () => {
    expect(
      getUserIdTypesInSql("SELECT ts, value FROM events", idTypes, getColumn),
    ).toEqual([]);
  });

  it("ignores identifiers referenced only in the WHERE clause", () => {
    const sql =
      "SELECT timestamp, user_id FROM events WHERE device_id IS NOT NULL";
    expect(getUserIdTypesInSql(sql, idTypes, getColumn)).toEqual(["user_id"]);
  });

  it("ignores identifiers referenced only in GROUP BY or JOIN clauses", () => {
    const sql = `SELECT user_id, ts FROM events e
      JOIN devices d ON d.device_id = e.device_id
      GROUP BY user_id, anonymous_id`;
    expect(getUserIdTypesInSql(sql, idTypes, getColumn)).toEqual(["user_id"]);
  });

  it("only looks at the outermost SELECT list when CTEs are present", () => {
    const sql = `WITH ids AS (
        SELECT device_id, anonymous_id FROM raw_events
      )
      SELECT user_id, ts FROM ids`;
    expect(getUserIdTypesInSql(sql, idTypes, getColumn)).toEqual(["user_id"]);
  });

  it("ignores from keywords inside quoted strings", () => {
    expect(
      getUserIdTypesInSql(
        "SELECT 'from web' AS src, user_id FROM events",
        idTypes,
        getColumn,
      ),
    ).toEqual(["user_id"]);
    expect(
      getUserIdTypesInSql(
        "SELECT user_id, 'from app' AS src, device_id FROM events",
        idTypes,
        getColumn,
      ),
    ).toEqual(["user_id", "device_id"]);
  });

  it("handles backslash-escaped quotes inside strings", () => {
    expect(
      getUserIdTypesInSql(
        "SELECT 'it\\'s from web' AS s, user_id, device_id FROM events",
        idTypes,
        getColumn,
      ),
    ).toEqual(["user_id", "device_id"]);
  });

  it("ignores from keywords inside line and block comments", () => {
    expect(
      getUserIdTypesInSql(
        "SELECT -- copied from raw\n user_id FROM events",
        idTypes,
        getColumn,
      ),
    ).toEqual(["user_id"]);
    expect(
      getUserIdTypesInSql(
        "SELECT /* ids from crm */ user_id, device_id FROM events",
        idTypes,
        getColumn,
      ),
    ).toEqual(["user_id", "device_id"]);
  });

  it("ignores parens inside comments and strings", () => {
    expect(
      getUserIdTypesInSql(
        "SELECT user_id /* ( */ FROM events WHERE device_id IS NOT NULL",
        idTypes,
        getColumn,
      ),
    ).toEqual(["user_id"]);
    expect(
      getUserIdTypesInSql(
        "SELECT user_id FROM events WHERE note = '(' AND device_id IS NOT NULL",
        idTypes,
        getColumn,
      ),
    ).toEqual(["user_id"]);
  });
});

describe("getFactTableSelectList", () => {
  it("returns the text between the outermost SELECT and FROM", () => {
    expect(getFactTableSelectList("SELECT user_id, ts FROM events")).toEqual(
      "user_id, ts ",
    );
  });

  it("skips SELECT ... FROM pairs nested in CTEs and subqueries", () => {
    const sql = `WITH x AS (SELECT a, b FROM t1)
      SELECT (SELECT max(ts) FROM t2) AS m, user_id FROM x`;
    expect(getFactTableSelectList(sql)).toEqual(
      "(SELECT max(ts) FROM t2) AS m, user_id ",
    );
  });

  it("handles newlines and mixed case keywords", () => {
    expect(
      getFactTableSelectList("select\n  user_id,\n  ts\nfrom events"),
    ).toEqual("  user_id,\n  ts\n");
  });

  it("skips quoted spans, including doubled-quote escapes", () => {
    expect(
      getFactTableSelectList(
        "SELECT 'it''s from here' AS x, user_id FROM events",
      ),
    ).toEqual("'it''s from here' AS x, user_id ");
  });

  it("skips line and block comments", () => {
    expect(
      getFactTableSelectList("SELECT -- copied from raw\n user_id FROM events"),
    ).toEqual("-- copied from raw\n user_id ");
    expect(
      getFactTableSelectList("SELECT /* ids from crm */ user_id FROM events"),
    ).toEqual("/* ids from crm */ user_id ");
  });
});
