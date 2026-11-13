import {
  assertSafeReadOnlySQL,
  getSqlStringRules,
  buildMinimalOrCondition,
  createLikeMatchFns,
  decodeSQLResults,
  encodeSQLResults,
  ensureLimit,
  hasStartDateFilter,
  isMultiStatementSQL,
  isReadOnlySQL,
  sqlReferencesColumn,
  sqlReferencesColumnAllowingQualified,
  stripTrailingSemicolon,
  usesBackslashStringEscapes,
} from "../src/sql";
import {
  bigQueryDialect,
  mssqlDialect,
  mysqlDialect,
  postgresDialect,
  prestoDialect,
  verticaDialect,
} from "../src/dialects";
import type { SqlStringRules } from "../types/sql";

// BigQuery, MySQL, ...: `\'` escapes a quote
const BACKSLASH: SqlStringRules = {
  backslashEscapes: true,
  bracketIdentifiers: false,
  eStrings: false,
};
// Presto, Athena, ...: `\` is a literal character
const STANDARD: SqlStringRules = {
  backslashEscapes: false,
  bracketIdentifiers: false,
  eStrings: false,
};
// Postgres, Vertica: `\` is literal except inside an `E'...'` string
const POSTGRES: SqlStringRules = {
  backslashEscapes: false,
  bracketIdentifiers: false,
  eStrings: true,
};
// SQL Server: `\` is literal and `[name]` quotes an identifier
const TSQL: SqlStringRules = {
  backslashEscapes: false,
  bracketIdentifiers: true,
  eStrings: false,
};
const ALL_RULES: { name: string; rules: SqlStringRules }[] = [
  { name: "backslash", rules: BACKSLASH },
  { name: "standard", rules: STANDARD },
  { name: "postgres", rules: POSTGRES },
  { name: "tsql", rules: TSQL },
];

describe("hasStartDateFilter", () => {
  it.each([
    ["SELECT * FROM t WHERE ts >= '{{ startDate }}'", true],
    ["SELECT * FROM t WHERE ts >= '{{startDateISO}}'", true],
    [
      `SELECT * FROM events_* WHERE _TABLE_SUFFIX >= '{{date startDateISO "yyyyMMdd"}}'`,
      true,
    ],
    ["SELECT * FROM t WHERE ts <= '{{endDate}}'", false],
    ["SELECT * FROM t", false],
  ])("%s", (sql, expected) => {
    expect(hasStartDateFilter(sql)).toBe(expected);
  });
});

describe("ensureLimit", () => {
  describe("already has LIMIT and OFFSET clauses", () => {
    it("should replace existing LIMIT and OFFSET clauses", () => {
      const sql = "SELECT * FROM users LIMIT 50 OFFSET 20";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users LIMIT 10 OFFSET 20");
    });
    it("should not change the SQL if the limit is greater than or equal to existing limit", () => {
      const sql = "SELECT * FROM users LIMIT 10 OFFSET 20";
      const result = ensureLimit(sql, 15, BACKSLASH);
      expect(result).toBe("SELECT * FROM users LIMIT 10 OFFSET 20");
    });
    it("should handle semicolon at the end with LIMIT and OFFSET", () => {
      const sql = "SELECT * FROM users LIMIT 50 OFFSET 20;";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users LIMIT 10 OFFSET 20");
    });
    it("should handle lowercase limit/offset keywords", () => {
      const sql = "SELECT * FROM users limit 50 offset 20";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users LIMIT 10 OFFSET 20");
    });
  });
  describe("has OFFSET clause only", () => {
    it("should replace OFFSET with LIMIT and OFFSET", () => {
      const sql = "SELECT * FROM users OFFSET 20";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users LIMIT 10 OFFSET 20");
    });
    it("should handle semicolon at the end with OFFSET", () => {
      const sql = "SELECT * FROM users OFFSET 20;";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users LIMIT 10 OFFSET 20");
    });
    it("should handle lowercase offset keyword", () => {
      const sql = "SELECT * FROM users offset 20";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users LIMIT 10 OFFSET 20");
    });
  });
  describe("has 2-number LIMIT clause", () => {
    it("should replace existing LIMIT with two numbers", () => {
      const sql = "SELECT * FROM users LIMIT 20, 50";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users LIMIT 20, 10");
    });
    it("should not change the SQL if the limit is greater than or equal to existing limit", () => {
      const sql = "SELECT * FROM users LIMIT 20, 10";
      const result = ensureLimit(sql, 15, BACKSLASH);
      expect(result).toBe("SELECT * FROM users LIMIT 20, 10");
    });
    it("should handle semicolon at the end with two numbers", () => {
      const sql = "SELECT * FROM users LIMIT 20, 50;";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users LIMIT 20, 10");
    });
    it("should handle lowercase limit keyword with two numbers", () => {
      const sql = "SELECT * FROM users limit 20, 50";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users LIMIT 20, 10");
    });
  });
  describe("has 1-number LIMIT clause only", () => {
    it("should replace existing LIMIT clause", () => {
      const sql = "SELECT * FROM users LIMIT 50";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users LIMIT 10");
    });
    it("should not change the SQL if the limit is greater than or equal to existing limit", () => {
      const sql = "SELECT * FROM users LIMIT 10";
      const result = ensureLimit(sql, 15, BACKSLASH);
      expect(result).toBe("SELECT * FROM users LIMIT 10");
    });
    it("should handle semicolon at the end with LIMIT", () => {
      const sql = "SELECT * FROM users LIMIT 50;";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users LIMIT 10");
    });
    it("should handle lowercase limit keyword", () => {
      const sql = "SELECT * FROM users limit 50";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users LIMIT 10");
    });
  });

  describe("no LIMIT or OFFSET clauses", () => {
    it("should append LIMIT at the end", () => {
      const sql = "SELECT * FROM users";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users\nLIMIT 10");
    });
    it("should handle semicolon at the end without LIMIT or OFFSET", () => {
      const sql = "SELECT * FROM users;";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users\nLIMIT 10");
    });
  });

  describe("edge cases", () => {
    it("should handle complex case with subquery that has LIMIT", () => {
      const sql = "SELECT * FROM (SELECT * FROM users LIMIT 50) AS subquery";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe(
        "SELECT * FROM (SELECT * FROM users LIMIT 50) AS subquery\nLIMIT 10",
      );
    });
    it("should handle WHERE clause with deceptive LIMIT in string", () => {
      const sql = "SELECT * FROM users WHERE test = 'LIMIT 5'";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe(
        "SELECT * FROM users WHERE test = 'LIMIT 5'\nLIMIT 10",
      );
    });
    it("should handle SQL with single-line comments", () => {
      const sql = "SELECT * FROM users -- something";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users -- something\nLIMIT 10");
    });
    it("should handle SQL with multi-line comments", () => {
      const sql = "SELECT * FROM users /* LIMIT 5 \n*/";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users /* LIMIT 5 \n*/\nLIMIT 10");
    });
    // TODO: properly parse comments and ignore them when looking for keywords
    it.skip("should handle comments in the middle of LIMIT", () => {
      const sql = "SELECT * FROM users LI/*\ntest\n*/MIT/* LIMIT 5 */ 5";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe(
        "SELECT * FROM users LI/*\ntest\n*/MIT/* LIMIT 5 */ 5",
      );
    });
    // TODO: properly parse comments to remove trailing semicolons
    it.skip("should handle comments and semicolons at end", () => {
      const sql = "SELECT * FROM users; -- testing\n";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users -- testing\nLIMIT 10");
    });
    // TODO: properly parse comments to ignore LIMIT in comments
    it.skip("should handle SQL with single-line comments with deceptive LIMIT", () => {
      const sql = "SELECT * FROM users -- LIMIT 5";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users -- LIMIT 5\nLIMIT 10");
    });
    // TODO: Handle complex expressions in LIMIT clause
    it.skip("should handle complex expressions in LIMIT clause", () => {
      const sql = "SELECT * FROM users LIMIT abs(-10) + 5";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users LIMIT 10");
    });
    it("should strip a trailing semicolon even when a comment follows it", () => {
      const sql = "SELECT * FROM users;\n-- note";
      const result = ensureLimit(sql, 10, BACKSLASH);
      expect(result).toBe("SELECT * FROM users\nLIMIT 10");
    });
  });
});

describe("stripTrailingSemicolon", () => {
  // Inputs without backslashes read the same under either quoting rule
  const eitherDialect: [string, string][] = [
    ["SELECT 1", "SELECT 1"],
    ["SELECT 1;", "SELECT 1"],
    ["SELECT 1 ;  \n\t", "SELECT 1"],
    ["  SELECT 1;  ", "SELECT 1"],
    ["SELECT 1;\n-- note", "SELECT 1"],
    ["SELECT 1; -- note\n", "SELECT 1"],
    ["SELECT 1; -- a\n-- b\n", "SELECT 1"],
    ["SELECT 1; /* note */", "SELECT 1"],
    ["SELECT 1;/* a *//* b */", "SELECT 1"],
    ["SELECT 1; /* multi\nline */ -- and more\n", "SELECT 1"],
    ["SELECT 1;/**/", "SELECT 1"],
    // Only the terminating semicolon is removed
    ["SELECT 1;;", "SELECT 1;"],
    ["SELECT 1; ;", "SELECT 1;"],
    ["SELECT 1; SELECT 2;", "SELECT 1; SELECT 2"],
    // Content after the semicolon means it is not terminating
    ["SELECT 1; SELECT 2", "SELECT 1; SELECT 2"],
    ["SELECT 1; /* c */ SELECT 2", "SELECT 1; /* c */ SELECT 2"],
    ["SELECT 1; -- c\nSELECT 2", "SELECT 1; -- c\nSELECT 2"],
    ["SELECT ';' AS a", "SELECT ';' AS a"],
    // `;` and `--` inside quoted text are not a terminator or a comment
    ["SELECT ';--' AS value", "SELECT ';--' AS value"],
    ["SELECT ';' AS a; -- done", "SELECT ';' AS a"],
    ["SELECT 'it''s;--' AS a;", "SELECT 'it''s;--' AS a"],
    ['SELECT 1 AS ";--";', 'SELECT 1 AS ";--"'],
    ["SELECT 1 AS `a;--b`", "SELECT 1 AS `a;--b`"],
    // A quote that is never closed: quotes are ignored, as before
    ["SELECT 'never closed;", "SELECT 'never closed"],
    // Quotes inside comments do not start a string
    ["SELECT 1 -- don't\n;", "SELECT 1 -- don't"],
    ["SELECT 1; /* it's */", "SELECT 1"],
    ["SELECT 'x' AS a; -- don't", "SELECT 'x' AS a"],
    // A line comment also ends at a bare carriage return
    ["SELECT 1 -- note\rFROM t;", "SELECT 1 -- note\rFROM t"],
    ["SELECT 1 /* a; */", "SELECT 1 /* a; */"],
    // A comment that never closes is not trailing trivia
    ["SELECT 1; /* never closed", "SELECT 1; /* never closed"],
    ["SELECT 1; /* a; ", "SELECT 1; /* a"],
    // A line comment ends at the newline, so a later `*/` is not part of it
    ["SELECT 1; -- a /*\n*/", "SELECT 1; -- a /*\n*/"],
    ["", ""],
    [";", ""],
  ];

  describe.each(ALL_RULES)("$name rules", ({ rules }) => {
    it.each(eitherDialect)("%j", (sql, expected) => {
      expect(stripTrailingSemicolon(sql, rules)).toBe(expected);
    });
  });

  // Backslash-escaped quotes (BigQuery, MySQL, ...)
  it.each([
    ["SELECT 'it\\'s' AS a;", "SELECT 'it\\'s' AS a"],
    ["SELECT 'it\\'s;--' AS a;", "SELECT 'it\\'s;--' AS a"],
    ['SELECT "a\\";--" AS b;', 'SELECT "a\\";--" AS b'],
    ["SELECT 'a\\\\' AS b;", "SELECT 'a\\\\' AS b"],
    ["SELECT 'it\\'s' AS a; -- don't", "SELECT 'it\\'s' AS a"],
  ])("with backslash escapes: %j", (sql, expected) => {
    expect(stripTrailingSemicolon(sql, BACKSLASH)).toBe(expected);
  });

  // Standard SQL, where a backslash is literal (Postgres, ...)
  it.each([
    ["SELECT 'C:\\' AS p;", "SELECT 'C:\\' AS p"],
    [
      "SELECT 'C:\\' AS p, ';--' AS value;",
      "SELECT 'C:\\' AS p, ';--' AS value",
    ],
    [
      "SELECT 'C:\\' AS p, ';--' AS value",
      "SELECT 'C:\\' AS p, ';--' AS value",
    ],
    ["SELECT \"C:\\\" AS p, ';' AS v;", "SELECT \"C:\\\" AS p, ';' AS v"],
    ["SELECT 'C:\\' AS p; -- it's", "SELECT 'C:\\' AS p"],
  ])("with standard strings: %j", (sql, expected) => {
    expect(stripTrailingSemicolon(sql, STANDARD)).toBe(expected);
  });

  // SQL Server bracket identifiers; `]]` is an escaped `]`
  it.each([
    ["SELECT [a;--b] FROM t;", "SELECT [a;--b] FROM t"],
    ["SELECT [it's] FROM t; -- don't", "SELECT [it's] FROM t"],
    ["SELECT [a]];--] FROM t;", "SELECT [a]];--] FROM t"],
  ])("with bracket identifiers: %j", (sql, expected) => {
    expect(stripTrailingSemicolon(sql, TSQL)).toBe(expected);
  });

  // Postgres `E'...'` strings take backslash escapes; other strings do not
  it.each([
    ["SELECT E'\\'' AS a; -- it's", "SELECT E'\\'' AS a"],
    ["SELECT e'it\\'s;--' AS a;", "SELECT e'it\\'s;--' AS a"],
    ["SELECT E'a\\\\' AS b;", "SELECT E'a\\\\' AS b"],
    [
      "SELECT 'C:\\' AS p, E'\\'' AS q; -- it's",
      "SELECT 'C:\\' AS p, E'\\'' AS q",
    ],
    // A doubled quote must not end the E-string early
    ["SELECT E'it''s \\'' AS a; -- it's", "SELECT E'it''s \\'' AS a"],
    // `date` ends in `e`, but the string after it is a plain one
    ["SELECT date'C:\\' AS p; -- it's", "SELECT date'C:\\' AS p"],
  ])("with E-strings: %j", (sql, expected) => {
    expect(stripTrailingSemicolon(sql, POSTGRES)).toBe(expected);
  });

  it("does not treat brackets as quotes outside SQL Server", () => {
    expect(stripTrailingSemicolon("SELECT arr[1]; -- a;", STANDARD)).toBe(
      "SELECT arr[1]",
    );
  });

  // A `;` that ends the SQL is removed whatever precedes it
  describe.each(ALL_RULES)("final semicolon, $name rules", ({ rules }) => {
    it.each([
      ["SELECT $t$a--b$t$;", "SELECT $t$a--b$t$"],
      [
        "SELECT $$it's$$ AS a, $$it's -- x$$ AS c;\n",
        "SELECT $$it's$$ AS a, $$it's -- x$$ AS c",
      ],
      // MySQL reads `5--3` as arithmetic, not as a comment
      ["SELECT 5--3 AS a;", "SELECT 5--3 AS a"],
      ["SELECT 1 -- note;", "SELECT 1 -- note"],
    ])("%j", (sql, expected) => {
      expect(stripTrailingSemicolon(sql, rules)).toBe(expected);
    });
  });

  describe("pathological input", () => {
    // These used to backtrack exponentially (each extra `/**/` doubled the
    // time), which stalled the server on user-supplied SQL.
    const pathological = [
      ";" + "/**/".repeat(30) + "x",
      ";" + "/**/".repeat(100000) + "x",
      ";/*".repeat(100000) + "x",
      ";--\n".repeat(100000) + "x",
      ";" + " ".repeat(100000) + "x",
      ";'x'".repeat(100000) + "x",
      "'".repeat(100001) + ";x",
      "'" + "\\".repeat(200000) + ";x",
      ";'" + "\\'".repeat(100000) + "x",
    ];

    it.each(
      pathological.flatMap((sql) =>
        ALL_RULES.map(({ name, rules }) => ({
          label: sql.slice(0, 20),
          sql,
          name,
          rules,
        })),
      ),
    )("finishes quickly for $label... ($name rules)", ({ sql, rules }) => {
      const start = Date.now();
      // Nothing trailing to strip: x follows every semicolon. Compare as a
      // boolean so a failure does not print a megabyte of SQL.
      expect(stripTrailingSemicolon(sql, rules) === sql).toBe(true);
      expect(Date.now() - start).toBeLessThan(500);
    });

    it("ensureLimit stays fast on the same input", () => {
      const sql = ";" + "/**/".repeat(30) + "x";
      const start = Date.now();
      expect(ensureLimit(sql, 10, BACKSLASH)).toBe(`${sql}\nLIMIT 10`);
      expect(Date.now() - start).toBeLessThan(500);
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
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(true);
  });

  it("should return false for single statement", () => {
    const sql = "SELECT * FROM users;";
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(false);
  });

  it("should ignore comments when counting statements", () => {
    const sql = `
      -- This is a comment; Select 1;
      SELECT * FROM users; /* Another comment; SELECT 1; */
    `;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(false);
  });

  it("should handle statements without semicolons", () => {
    const sql = "SELECT * FROM users";
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(false);
  });

  it("should handle complex multi-statement SQL", () => {
    const sql = `
      WITH recent_orders AS (
        SELECT * FROM orders WHERE created_at > NOW() - INTERVAL '7 days'
      )
      SELECT * FROM recent_orders WHERE amount > 100;
    `;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(false);
  });
  it("should ignore semicolons within simple strings", () => {
    const sql = "SELECT 'This is a test; still in string' AS test_col;";
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(false);
  });
  it("should handle CTAS statements", () => {
    const sql = "CREATE TABLE new_table AS SELECT * FROM users";
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(false);
  });
  it("is not tricked by quotes and block comments", () => {
    const sql = `SELECT '/*'; DROP TABLE users; SELECT '*/';`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(true);
  });
  it("is not tricked by quotes and line comments", () => {
    const sql = `SELECT '--'; DROP TABLE users`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(true);
  });
  it("is not tricked by backslash escaped strings", () => {
    const sql = `SELECT 'It\\'s a test'; DROP TABLE users; SELECT '1';`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(true);
  });
  it("is not tricked by fake escaped backslashes", () => {
    const sql = `SELECT 'This is a backslash: \\\\'; DROP TABLE users; SELECT '1';`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(true);
  });
  it("is not tricked by single quotes that are escaped by doubling the quotes", () => {
    const sql = `SELECT 'It''s a test'; DROP TABLE users; SELECT '1';`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(true);
  });

  it("is not tricked by double quotes and block comments", () => {
    const sql = `SELECT "/*"; DROP TABLE users; SELECT "*/";`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(true);
  });
  it("is not tricked by double quotes and line comments", () => {
    const sql = `SELECT "--"; DROP TABLE users`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(true);
  });
  it("is not tricked by backslash escaped double quoted strings", () => {
    const sql = `SELECT "It\\'s a test"; DROP TABLE users; SELECT "1";`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(true);
  });
  it("is not tricked by fake escaped backslashes in double quoted strings", () => {
    const sql = `SELECT "This is a backslash: \\\\"; DROP TABLE users; SELECT "1";`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(true);
  });
  it("is not tricked by single quotes that are escaped by doubling the double quotes", () => {
    const sql = `SELECT "It''s a test"; DROP TABLE users; SELECT "1";`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(true);
  });

  it("is not tricked by backtick quotes and block comments", () => {
    const sql = `SELECT \`/*\`; DROP TABLE users; SELECT \`*/\`;`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(true);
  });
  it("is not tricked by backtick quotes and line comments", () => {
    const sql = `SELECT \`--\`; DROP TABLE users`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(true);
  });
  it("is not tricked by doubled backticks", () => {
    const sql = `SELECT \`It\`\`s a test\`; DROP TABLE users; SELECT \`1\`;`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(true);
  });
  it("allows parse errors as long as there are no semicolons", () => {
    const sql = `SELECT 'It\\'`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(false);
  });
  it("allows parse errors as long as there is only a trailing semicolon", () => {
    const sql = `SELECT 'It\\'; `;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(false);
  });
  it("blocks all internal semicolons when there is a parse error", () => {
    const sql = `SELECT 'It\\'; DROP TABLE users`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(true);
  });
});

describe("isMultiStatementSQL — SQL Server bracket identifiers", () => {
  it("ignores a semicolon inside a bracket identifier", () => {
    expect(isMultiStatementSQL("SELECT [a;b] FROM t", TSQL)).toBe(false);
  });

  it("finds a statement after a bracket identifier containing a quote", () => {
    const sql = "SELECT [it's] FROM x; DROP TABLE y -- '";
    expect(isMultiStatementSQL(sql, TSQL)).toBe(true);
  });
});

describe("isMultiStatementSQL — Postgres E-strings", () => {
  it("finds a statement after an E-string ending in an escaped quote", () => {
    const sql = "SELECT E'\\'' AS a; DROP TABLE x; SELECT 1 --'";
    expect(isMultiStatementSQL(sql, POSTGRES)).toBe(true);
  });

  it("ignores a semicolon inside an E-string with an escaped quote", () => {
    expect(isMultiStatementSQL("SELECT E'it\\'s; fine' AS a", POSTGRES)).toBe(
      false,
    );
  });

  it("keeps reading an E-string past a doubled quote", () => {
    const sql = "SELECT E'a''\\''; DROP TABLE x; SELECT 1 --'";
    expect(isMultiStatementSQL(sql, POSTGRES)).toBe(true);
    expect(isMultiStatementSQL("SELECT E'a''\\'; b' AS c", POSTGRES)).toBe(
      false,
    );
  });

  it("reads the string after an identifier ending in e as a plain string", () => {
    const sql = "SELECT date'C:\\' AS p; DROP TABLE x --'";
    expect(isMultiStatementSQL(sql, POSTGRES)).toBe(true);
  });

  // In T-SQL `e'\'` is column e with a string alias, so `\` stays literal
  it("does not read E-strings on dialects without them", () => {
    const sql = "SELECT e'\\' FROM t; DROP TABLE x --'";
    expect(isMultiStatementSQL(sql, TSQL)).toBe(true);
    expect(isMultiStatementSQL(sql, STANDARD)).toBe(true);
  });
});

describe("isMultiStatementSQL — dialect-aware backslash escaping", () => {
  it("allows a backslash string literal on a non-backslash dialect (the reported bug)", () => {
    const sql = `SELECT * FROM t WHERE id LIKE 'a\\_b' ESCAPE '\\'`;
    expect(isMultiStatementSQL(sql, STANDARD)).toBe(false);
  });
  it("allows multi-line  query with a ';' in a comment and a backslash ESCAPE literal", () => {
    const sql = `-- Dimension: Country (by user_id); Fact Table: Sessions (by user_id)
WITH __rawExperiment AS (
  SELECT timestamp, experiment_id, user_id
  FROM "fake-database".sessions
  WHERE timestamp >= timestamp '2026-05-26 19:00:00'
    AND experiment_id LIKE replace('my-experiment-id-here', '_', '\\_') ESCAPE '\\'
)
SELECT timestamp, user_id FROM __rawExperiment;`;
    expect(isMultiStatementSQL(sql, STANDARD)).toBe(false);
  });
  it("still blocks a real statement separator on a non-backslash dialect", () => {
    expect(isMultiStatementSQL(`SELECT 1; DROP TABLE users`, STANDARD)).toBe(
      true,
    );
  });
  it("blocks an injection hidden behind a backslash literal on a non-backslash dialect", () => {
    const sql = `SELECT 1 WHERE x = '\\'; DROP TABLE t; --'`;
    expect(isMultiStatementSQL(sql, STANDARD)).toBe(true);
  });
  it("blocks a real statement separator when a -- sits inside a string and the query ends mid-string", () => {
    const sql = `SELECT '--'; DROP TABLE users; SELECT 'unterminated`;
    expect(isMultiStatementSQL(sql, STANDARD)).toBe(true);
  });
  it("blocks a backslash-escaped-quote injection on a backslash dialect", () => {
    const sql = `SELECT 'It\\'s a test'; DROP TABLE users`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(true);
  });
  it("allows a benign single statement with a backslash escape on a backslash dialect", () => {
    const sql = `SELECT 'a\\nb' AS c`;
    expect(isMultiStatementSQL(sql, BACKSLASH)).toBe(false);
  });
});

describe("getSqlStringRules", () => {
  it.each([
    ["postgres", postgresDialect, POSTGRES],
    ["vertica", verticaDialect, POSTGRES],
    ["presto", prestoDialect, STANDARD],
    ["mssql", mssqlDialect, TSQL],
    ["bigquery", bigQueryDialect, BACKSLASH],
    ["mysql", mysqlDialect, BACKSLASH],
  ])("%s", (_name, dialect, expected) => {
    expect(getSqlStringRules(dialect)).toEqual(expected);
  });
});

describe("usesBackslashStringEscapes", () => {
  it("is false for ANSI doubled-quote escaping (Trino, Athena, Postgres, MSSQL, Vertica)", () => {
    const escapeStringLiteral = (v: string) => v.replace(/'/g, "''");
    expect(usesBackslashStringEscapes({ escapeStringLiteral })).toBe(false);
  });
  it("is true when backslashes are doubled (MySQL, Snowflake, Redshift, ClickHouse)", () => {
    const escapeStringLiteral = (v: string) =>
      v.replace(/\\/g, "\\\\").replace(/'/g, "''");
    expect(usesBackslashStringEscapes({ escapeStringLiteral })).toBe(true);
  });
  it("is true when quotes/backslashes are backslash-prefixed (BigQuery, Databricks)", () => {
    const escapeStringLiteral = (v: string) => v.replace(/(['\\])/g, "\\$1");
    expect(usesBackslashStringEscapes({ escapeStringLiteral })).toBe(true);
  });
});

describe("buildMinimalOrCondition", () => {
  it("returns empty string for empty input", () => {
    expect(buildMinimalOrCondition([])).toBe("");
  });

  it("returns empty string when a group has no filters (matches everything)", () => {
    expect(buildMinimalOrCondition([["A"], []])).toBe("");
  });

  it("returns empty string when a group has only null filters", () => {
    expect(buildMinimalOrCondition([["A"], [null, null]])).toBe("");
  });

  it("returns single condition for one metric with one filter", () => {
    expect(buildMinimalOrCondition([["color='blue'"]])).toBe("color='blue'");
  });

  it("ANDs multiple filters within a single metric", () => {
    expect(buildMinimalOrCondition([["color='blue'", "shape='circle'"]])).toBe(
      "(color='blue' AND shape='circle')",
    );
  });

  it("ORs independent metric filter groups", () => {
    expect(
      buildMinimalOrCondition([["color='blue'"], ["shape='circle'"]]),
    ).toBe("(color='blue'\nOR\nshape='circle')");
  });

  it("removes a metric subsumed by a less restrictive metric", () => {
    // Metric 1: color='blue' AND shape='circle'
    // Metric 2: color='blue'
    // Metric 2 is less restrictive, so metric 1 is redundant
    expect(
      buildMinimalOrCondition([
        ["color='blue'", "shape='circle'"],
        ["color='blue'"],
      ]),
    ).toBe("color='blue'");
  });

  it("removes a metric subsumed by a less restrictive metric (reversed order)", () => {
    expect(
      buildMinimalOrCondition([
        ["color='blue'"],
        ["color='blue'", "shape='circle'"],
      ]),
    ).toBe("color='blue'");
  });

  it("removes multiple subsumed metrics", () => {
    // Metric 1: A AND B
    // Metric 2: A AND C
    // Metric 3: A (subsumes both 1 and 2)
    expect(buildMinimalOrCondition([["A", "B"], ["A", "C"], ["A"]])).toBe("A");
  });

  it("deduplicates identical metric groups", () => {
    expect(
      buildMinimalOrCondition([
        ["color='blue'", "shape='circle'"],
        ["color='blue'", "shape='circle'"],
      ]),
    ).toBe("(color='blue' AND shape='circle')");
  });

  it("deduplicates identical groups regardless of filter order", () => {
    expect(
      buildMinimalOrCondition([
        ["shape='circle'", "color='blue'"],
        ["color='blue'", "shape='circle'"],
      ]),
    ).toBe("(shape='circle' AND color='blue')");
  });

  it("handles mix of subsumed, independent, and null filters", () => {
    // Metric 1: A AND B (subsumed by metric 3)
    // Metric 2: C AND D (independent)
    // Metric 3: A (less restrictive)
    expect(buildMinimalOrCondition([["A", "B"], ["C", "D"], ["A"]])).toBe(
      "((C AND D)\nOR\nA)",
    );
  });

  it("ignores null filters within groups", () => {
    expect(buildMinimalOrCondition([["A", null, "B"], ["A"]])).toBe("A");
  });

  it("deduplicates filters within a group", () => {
    expect(buildMinimalOrCondition([["A", "A", "B"]])).toBe("(A AND B)");
  });

  it("handles transitive subsumption correctly", () => {
    // Group 0: {A, B} — subsumed by group 2
    // Group 1: {A, B, C} — subsumed by group 0, and transitively by group 2
    // Group 2: {A}
    expect(buildMinimalOrCondition([["A", "B"], ["A", "B", "C"], ["A"]])).toBe(
      "A",
    );
  });

  it("handles transitive subsumption correctly with different filters", () => {
    // Group 0: {A, C} — subsumed by group 1
    // Group 1: {A, B, C} — subsumed by group 0
    expect(
      buildMinimalOrCondition([
        ["A", "C"],
        ["A", "B", "C"],
      ]),
    ).toBe("(A AND C)");
  });

  it("keeps non-overlapping groups intact", () => {
    expect(buildMinimalOrCondition([["A"], ["B"], ["C"]])).toBe(
      "(A\nOR\nB\nOR\nC)",
    );
  });

  it("keeps overlapping but non-subset groups", () => {
    // {A, B} and {B, C} share condition B but neither is a subset of the other
    expect(
      buildMinimalOrCondition([
        ["A", "B"],
        ["B", "C"],
      ]),
    ).toBe("((A AND B)\nOR\n(B AND C))");
  });

  it("dominates a group that is a superset of multiple independent minimals", () => {
    // {A, B} and {C, D} are independent minimals
    // {A, B, C, D} is a superset of both — should be removed
    expect(
      buildMinimalOrCondition([
        ["A", "B"],
        ["C", "D"],
        ["A", "B", "C", "D"],
      ]),
    ).toBe("((A AND B)\nOR\n(C AND D))");
  });

  it("keeps a partial-overlap chain where no group dominates another", () => {
    // {A, B}, {B, C}, {C, D} — each pair overlaps but none is a subset
    expect(
      buildMinimalOrCondition([
        ["A", "B"],
        ["B", "C"],
        ["C", "D"],
      ]),
    ).toBe("((A AND B)\nOR\n(B AND C)\nOR\n(C AND D))");
  });

  it("collapses many duplicates of the same group to one", () => {
    expect(
      buildMinimalOrCondition([
        ["A", "B"],
        ["A", "B"],
        ["A", "B"],
        ["A", "B"],
      ]),
    ).toBe("(A AND B)");
  });
});

describe("assertSafeReadOnlySQL", () => {
  // --- Valid queries ---
  it("allows simple SELECT", () => {
    expect(() => assertSafeReadOnlySQL("SELECT 1", BACKSLASH)).not.toThrow();
  });

  it("allows SELECT with FROM", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT * FROM users WHERE id = 1", BACKSLASH),
    ).not.toThrow();
  });

  it("allows WITH (CTE)", () => {
    expect(() =>
      assertSafeReadOnlySQL(
        "WITH cte AS (SELECT 1 AS n) SELECT * FROM cte",
        BACKSLASH,
      ),
    ).not.toThrow();
  });

  it("allows subqueries and aggregates", () => {
    expect(() =>
      assertSafeReadOnlySQL(
        "SELECT source, COUNT(*) AS cnt FROM signups GROUP BY source ORDER BY cnt DESC LIMIT 10",
        BACKSLASH,
      ),
    ).not.toThrow();
  });

  // --- DML keywords inside string literals should NOT trigger ---
  it("ignores DML keywords inside single-quoted strings", () => {
    expect(() =>
      assertSafeReadOnlySQL(
        "SELECT * FROM t WHERE name = 'DROP TABLE'",
        BACKSLASH,
      ),
    ).not.toThrow();
  });

  it("ignores DML keywords inside double-quoted identifiers", () => {
    expect(() =>
      assertSafeReadOnlySQL('SELECT "DELETE" FROM t', BACKSLASH),
    ).not.toThrow();
  });

  it("ignores DML keywords inside backtick-quoted identifiers", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT `INSERT` FROM t", BACKSLASH),
    ).not.toThrow();
  });

  // --- First keyword ---
  it("rejects EXPLAIN", () => {
    expect(() => assertSafeReadOnlySQL("EXPLAIN SELECT 1", BACKSLASH)).toThrow(
      "Only SELECT and WITH",
    );
  });

  it("rejects SHOW", () => {
    expect(() => assertSafeReadOnlySQL("SHOW TABLES", BACKSLASH)).toThrow(
      "Only SELECT and WITH",
    );
  });

  it("rejects INSERT as first keyword", () => {
    expect(() =>
      assertSafeReadOnlySQL("INSERT INTO t VALUES (1)", BACKSLASH),
    ).toThrow();
  });

  // --- Multi-statement ---
  it("rejects multi-statement with semicolon", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT 1; DROP TABLE users", BACKSLASH),
    ).toThrow("Multi-statement");
  });

  it("allows trailing semicolon (stripped by parser)", () => {
    expect(() => assertSafeReadOnlySQL("SELECT 1;", BACKSLASH)).not.toThrow();
  });

  // --- DML/DDL deny-list ---
  it("rejects DELETE anywhere in query", () => {
    expect(() =>
      assertSafeReadOnlySQL(
        "SELECT * FROM t WHERE 1=1 DELETE FROM t",
        BACKSLASH,
      ),
    ).toThrow("DELETE");
  });

  it("rejects DROP in subquery", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT (DROP TABLE users) FROM dual", BACKSLASH),
    ).toThrow("DROP");
  });

  it("rejects CREATE", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT 1 CREATE TABLE foo (id INT)", BACKSLASH),
    ).toThrow("CREATE");
  });

  it("rejects TRUNCATE", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT 1 TRUNCATE TABLE foo", BACKSLASH),
    ).toThrow("TRUNCATE");
  });

  it("rejects GRANT", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT 1 GRANT ALL ON foo TO bar", BACKSLASH),
    ).toThrow("GRANT");
  });

  // --- SELECT INTO ---
  it("rejects SELECT INTO", () => {
    expect(() =>
      assertSafeReadOnlySQL(
        "SELECT * INTO new_table FROM old_table",
        BACKSLASH,
      ),
    ).toThrow("SELECT INTO");
  });

  it.each([
    "SELECT *\nINTO new_table\nFROM old_table",
    "SELECT *\r\nINTO new_table FROM old_table",
    "SELECT 1\n\tINTO new_table",
    "WITH a AS (SELECT 1 AS x)\nSELECT x\nINTO new_table FROM a",
  ])("rejects SELECT INTO across lines: %j", (sql) => {
    expect(() => assertSafeReadOnlySQL(sql, BACKSLASH)).toThrow("SELECT INTO");
  });

  it.each([
    "SELECT 'into' AS a",
    'SELECT "into" FROM t',
    "SELECT into_count, count_into FROM t",
    "SELECT 1 -- copied into the report\nFROM t",
  ])("allows INTO in strings, identifiers and comments: %j", (sql) => {
    expect(() => assertSafeReadOnlySQL(sql, BACKSLASH)).not.toThrow();
  });

  it("checks for SELECT INTO in linear time", () => {
    const sql = "SELECT " + "SELECT ".repeat(14000);
    const start = Date.now();
    expect(() => assertSafeReadOnlySQL(sql, BACKSLASH)).not.toThrow();
    expect(Date.now() - start).toBeLessThan(500);
  });

  it.each([
    ["WITH a AS (SELECT 1)\nINSERT INTO t SELECT * FROM a", "INSERT"],
    ["SELECT 1\nMERGE INTO t USING s ON true", "MERGE"],
  ])("reports the statement, not SELECT INTO: %j", (sql, keyword) => {
    expect(() => assertSafeReadOnlySQL(sql, BACKSLASH)).toThrow(
      `Disallowed keyword: ${keyword}`,
    );
  });

  // A comment separates words, so it cannot glue a keyword to the next token
  it.each([
    ["SELECT * INTO/**/t FROM x", "SELECT INTO"],
    ["SELECT * INTO--c\nt FROM x", "SELECT INTO"],
    ["WITH d AS (DELETE/**/FROM t RETURNING 1) SELECT * FROM d", "DELETE"],
    ["WITH d AS (UPDATE/**/t SET a = 1 RETURNING 1) SELECT * FROM d", "UPDATE"],
  ])("rejects a write split by a comment: %j", (sql, error) => {
    expect(() => assertSafeReadOnlySQL(sql, BACKSLASH)).toThrow(error);
    expect(() => assertSafeReadOnlySQL(sql, STANDARD)).toThrow(error);
  });

  // Reading `'C:\'` with backslash escapes would swallow the rest of the query
  it.each([
    "SELECT 'C:\\' AS p, 1 INTO t FROM x -- '",
    "WITH a AS (SELECT 'x\\' AS p), d AS (DELETE FROM t RETURNING 1) SELECT * FROM d -- '",
  ])(
    "rejects a write after a backslash-ended string in standard SQL: %j",
    (sql) => {
      expect(() => assertSafeReadOnlySQL(sql, STANDARD)).toThrow();
    },
  );

  it("allows backslash-escaped quotes when the dialect uses them", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT 'it\\'s' AS a FROM t", BACKSLASH),
    ).not.toThrow();
  });

  it.each([
    ["SELECT E'\\'' AS a; DROP TABLE x; SELECT 1 --'", "Multi-statement"],
    ["SELECT E'\\'' AS a, 1 INTO t FROM x --'", "SELECT INTO"],
    ["SELECT E'a''\\'' AS a, 1 INTO t FROM x --'", "SELECT INTO"],
  ])("rejects a write hidden by a Postgres E-string: %j", (sql, error) => {
    expect(() => assertSafeReadOnlySQL(sql, POSTGRES)).toThrow(error);
  });

  it("allows backslash-escaped quotes in a Postgres E-string", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT E'it\\'s' AS a FROM t", POSTGRES),
    ).not.toThrow();
  });

  it.each([
    "SELECT $$x$$ AS a",
    "SELECT $tag$x$tag$ AS a",
    "SELECT $$it's$$ AS a",
    "SELECT $\u00e9$x$\u00e9$ AS a",
  ])("rejects dollar-quoted strings: %j", (sql) => {
    expect(() => assertSafeReadOnlySQL(sql, POSTGRES)).toThrow(
      "Dollar-quoted strings are not allowed",
    );
  });

  it.each([
    "SELECT 'cost: $$' AS a",
    "SELECT '$USD$' AS a",
    'SELECT "$$" FROM t',
    "SELECT 1 -- costs $$\nFROM t",
    "SELECT 1 /* $tag$ */ FROM t",
  ])("allows dollar signs inside strings and comments: %j", (sql) => {
    expect(() => assertSafeReadOnlySQL(sql, POSTGRES)).not.toThrow();
  });

  it.each(["SELECT $1 FROM t", "SELECT a$b$c FROM t", "SELECT price$ FROM t"])(
    "allows $ that does not open a dollar-quoted string: %j",
    (sql) => {
      expect(() => assertSafeReadOnlySQL(sql, POSTGRES)).not.toThrow();
    },
  );

  // A quote inside a SQL Server [identifier] must not open a string. The
  // trailing `LIMIT 5` comment also stops ensureLimit from appending a limit.
  it.each([
    ["SELECT [it's], 1 INTO t FROM x -- ' LIMIT 5", "SELECT INTO"],
    [
      "SELECT [it's], 1 AS a FROM x; DROP TABLE y -- ' LIMIT 5",
      "Multi-statement",
    ],
    ["SELECT [x]]' ], 1 INTO t FROM y -- '", "SELECT INTO"],
  ])("rejects a write hidden by a bracket identifier: %j", (sql, error) => {
    expect(() => assertSafeReadOnlySQL(sql, TSQL)).toThrow(error);
  });

  it("allows deny-list words and quotes inside bracket identifiers", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT [into], [DELETE], [it's] FROM t", TSQL),
    ).not.toThrow();
  });

  it("rejects an unterminated bracket identifier", () => {
    expect(() => assertSafeReadOnlySQL("SELECT [abc FROM t", TSQL)).toThrow(
      "unterminated",
    );
  });

  it("allows array subscripts outside SQL Server", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT arr[1], m['k'] FROM t", BACKSLASH),
    ).not.toThrow();
  });

  // --- Comment-wrapped DML ---
  it("rejects DML after line comment on next line", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT 1 -- safe\nDROP TABLE x", BACKSLASH),
    ).toThrow("DROP");
  });

  it("rejects DML after block comment", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT 1 /* comment */ DROP TABLE x", BACKSLASH),
    ).toThrow("DROP");
  });

  it("allows DML keyword inside block comment (stripped)", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT /* DROP TABLE x */ 1 FROM t", BACKSLASH),
    ).not.toThrow();
  });

  // --- Dialect escape hatches ---
  it("rejects INTO OUTFILE", () => {
    expect(() =>
      assertSafeReadOnlySQL(
        "SELECT * FROM t INTO OUTFILE '/tmp/data.csv'",
        BACKSLASH,
      ),
    ).toThrow("INTO OUTFILE");
  });

  it("rejects INTO DUMPFILE", () => {
    expect(() =>
      assertSafeReadOnlySQL(
        "SELECT * FROM t INTO DUMPFILE '/tmp/data.bin'",
        BACKSLASH,
      ),
    ).toThrow("INTO DUMPFILE");
  });

  it("rejects pg_read_file", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT pg_read_file('/etc/passwd')", BACKSLASH),
    ).toThrow("pg_read_file");
  });

  it("rejects LOAD_FILE", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT LOAD_FILE('/etc/passwd')", BACKSLASH),
    ).toThrow("LOAD_FILE");
  });

  it("rejects ClickHouse file() function", () => {
    expect(() =>
      assertSafeReadOnlySQL(
        "SELECT * FROM file('/path/to/data.csv')",
        BACKSLASH,
      ),
    ).toThrow("file(");
  });

  it("rejects ClickHouse url() function", () => {
    expect(() =>
      assertSafeReadOnlySQL(
        "SELECT * FROM url('http://evil.com/data')",
        BACKSLASH,
      ),
    ).toThrow("url(");
  });

  it("rejects ClickHouse s3() function", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT * FROM s3('s3://bucket/key')", BACKSLASH),
    ).toThrow("s3(");
  });

  // --- Unterminated strings/comments ---
  it("rejects unterminated single-quoted string", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT 'unterminated", BACKSLASH),
    ).toThrow("unterminated");
  });

  it("rejects unterminated block comment", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT /* never closed", BACKSLASH),
    ).toThrow("unterminated");
  });

  // --- Length cap ---
  it("rejects queries exceeding length cap", () => {
    const long = "SELECT " + "x".repeat(100_001);
    expect(() => assertSafeReadOnlySQL(long, BACKSLASH)).toThrow(
      "safety limit",
    );
  });

  // --- Edge cases ---
  it("allows quoted identifiers containing deny-list words", () => {
    expect(() =>
      assertSafeReadOnlySQL('SELECT 1 AS "EXECUTE" FROM t', BACKSLASH),
    ).not.toThrow();
  });

  it("does not false-positive on words containing deny-list substrings", () => {
    expect(() =>
      assertSafeReadOnlySQL(
        "SELECT updated_at, created_at FROM events",
        BACKSLASH,
      ),
    ).not.toThrow();
  });

  it("does not false-positive on 'file' as a column name (no parens)", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT file FROM documents", BACKSLASH),
    ).not.toThrow();
  });

  it("handles case-insensitive DML", () => {
    expect(() =>
      assertSafeReadOnlySQL("SELECT 1 dRoP TABLE foo", BACKSLASH),
    ).toThrow("DROP");
  });

  it("handles leading whitespace and newlines", () => {
    expect(() =>
      assertSafeReadOnlySQL("  \n  SELECT 1 FROM t", BACKSLASH),
    ).not.toThrow();
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

  it("preserves columns that are missing from the first row", () => {
    const results = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob", grid: [1, 2, 3] },
    ];

    const encoded = encodeSQLResults(results);
    expect(encoded).toEqual([
      {
        numRows: 2,
        data: {
          id: [1, 2],
          name: ["Alice", "Bob"],
          grid: [null, [1, 2, 3]],
        },
      },
    ]);

    const decoded = decodeSQLResults(encoded);
    expect(decoded).toEqual([
      { id: 1, name: "Alice", grid: null },
      { id: 2, name: "Bob", grid: [1, 2, 3] },
    ]);
  });
});

it("uses the same escaping for wildcard row filters and journey grouping", () => {
  for (const emitEscapeClause of [true, false]) {
    const matchers = createLikeMatchFns({
      escapeStringLiteral: (value) => value.replace(/'/g, "''"),
      emitEscapeClause,
    });
    const pattern = "/items/50%_?'/*";
    const expected = matchers.globMatch("url", pattern);
    expect(matchers.stringMatch("url", "matches_pattern", pattern)).toBe(
      expected,
    );
    expect(matchers.stringMatch("url", "not_matches_pattern", pattern)).toBe(
      expected.replace(" LIKE ", " NOT LIKE "),
    );
  }
});

// journeyToFunnel emits every glob-shaped step filter as `matches_pattern`
// rather than deriving starts_with/ends_with/contains, which is only safe
// because the compiled LIKE clause is identical either way.
it("compiles a glob to the same LIKE clause as the equivalent operator", () => {
  const matchers = createLikeMatchFns({
    escapeStringLiteral: (value) => value.replace(/'/g, "''"),
    emitEscapeClause: true,
  });
  const cases: [string, string, string][] = [
    ["/items/*", "starts_with", "/items/"],
    ["*/checkout", "ends_with", "/checkout"],
    ["*items*", "contains", "items"],
  ];
  for (const [glob, operator, value] of cases) {
    expect(matchers.stringMatch("url", "matches_pattern", glob)).toBe(
      matchers.stringMatch("url", operator as "starts_with", value),
    );
  }
});

describe("sqlReferencesColumn", () => {
  it("detects a bare identifier reference", () => {
    expect(sqlReferencesColumn("margin_vc / price", "margin_vc")).toBe(true);
  });

  it("does not match a name inside a string literal", () => {
    expect(sqlReferencesColumn("status = 'margin_vc'", "margin_vc")).toBe(
      false,
    );
  });

  it("does not match a partial identifier", () => {
    expect(sqlReferencesColumn("gross_margin_vc + 1", "margin_vc")).toBe(false);
  });

  it("does not match an already-qualified identifier", () => {
    expect(sqlReferencesColumn("m.price", "price")).toBe(false);
  });

  it("does not match a qualified identifier with whitespace around the dot", () => {
    expect(sqlReferencesColumn("m . price", "price")).toBe(false);
    expect(sqlReferencesColumn("m.\n  price", "price")).toBe(false);
    expect(sqlReferencesColumn('m . "price"', "price")).toBe(false);
    expect(sqlReferencesColumn("`m` . `price`", "price", "`")).toBe(false);
  });

  it("matches a double-quoted identifier in the default dialect", () => {
    expect(sqlReferencesColumn('"margin_vc" / 2', "margin_vc")).toBe(true);
  });

  it("treats a double-quoted span as a string literal in a backtick dialect", () => {
    expect(sqlReferencesColumn('label = "margin_vc"', "margin_vc", "`")).toBe(
      false,
    );
  });

  it("matches a backtick-quoted identifier in a backtick dialect", () => {
    expect(sqlReferencesColumn("`margin_vc` / 2", "margin_vc", "`")).toBe(true);
  });

  it("does not match a name inside a line comment", () => {
    expect(sqlReferencesColumn("price -- margin_vc\n + 1", "margin_vc")).toBe(
      false,
    );
  });

  it("does not match a name inside a block comment", () => {
    expect(sqlReferencesColumn("price /* margin_vc */ + 1", "margin_vc")).toBe(
      false,
    );
  });

  it("does not match a name inside a dollar-quoted string", () => {
    expect(sqlReferencesColumn("$$margin_vc$$", "margin_vc")).toBe(false);
    expect(sqlReferencesColumn("$tag$margin_vc$tag$", "margin_vc")).toBe(false);
  });

  it("still matches around a lone dollar sign with no closing delimiter", () => {
    expect(sqlReferencesColumn("margin_vc + $1", "margin_vc")).toBe(true);
  });
});

describe("sqlReferencesColumnAllowingQualified", () => {
  it("detects a bare identifier reference", () => {
    expect(
      sqlReferencesColumnAllowingQualified("margin_vc / price", "margin_vc"),
    ).toBe(true);
  });

  it("detects a table-qualified reference", () => {
    expect(
      sqlReferencesColumnAllowingQualified(
        "SELECT e.bandit_version FROM exposures e",
        "bandit_version",
      ),
    ).toBe(true);
  });

  it("detects a qualified reference with whitespace around the dot", () => {
    expect(sqlReferencesColumnAllowingQualified("e . price", "price")).toBe(
      true,
    );
    expect(sqlReferencesColumnAllowingQualified("e.\n  price", "price")).toBe(
      true,
    );
    expect(sqlReferencesColumnAllowingQualified('e . "price"', "price")).toBe(
      true,
    );
    expect(
      sqlReferencesColumnAllowingQualified("`e` . `price`", "price", "`"),
    ).toBe(true);
  });

  it("does not match a name inside a string literal", () => {
    expect(
      sqlReferencesColumnAllowingQualified(
        "status = 'bandit_version'",
        "bandit_version",
      ),
    ).toBe(false);
  });

  it("does not match a partial identifier", () => {
    expect(
      sqlReferencesColumnAllowingQualified("e.gross_margin_vc", "margin_vc"),
    ).toBe(false);
  });

  it("does not match a name inside a comment", () => {
    expect(
      sqlReferencesColumnAllowingQualified(
        "e.price -- e.margin_vc\n",
        "margin_vc",
      ),
    ).toBe(false);
    expect(
      sqlReferencesColumnAllowingQualified(
        "e.price /* e.margin_vc */",
        "margin_vc",
      ),
    ).toBe(false);
  });
});
