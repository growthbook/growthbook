import {
  columnInsertDisabledReason,
  insertColumnIntoSelect,
} from "@/services/schemaBrowserSql";

const TABLE_A = "analytics.events";
const TABLE_B = "analytics.users";

describe("columnInsertDisabledReason", () => {
  it("allows empty, simple SELECT from this table, WHERE, and JOIN", () => {
    expect(columnInsertDisabledReason("", TABLE_A, "user_id")).toBeNull();
    expect(
      columnInsertDisabledReason(
        `SELECT * FROM ${TABLE_A}`,
        TABLE_A,
        "user_id",
      ),
    ).toBeNull();
    expect(
      columnInsertDisabledReason(
        `SELECT * FROM ${TABLE_A} WHERE id = 1`,
        TABLE_A,
        "user_id",
      ),
    ).toBeNull();
    expect(
      columnInsertDisabledReason(
        `SELECT * FROM ${TABLE_A} JOIN ${TABLE_B} ON events.user_id = users.id`,
        TABLE_A,
        "user_id",
      ),
    ).toBeNull();
  });

  it("disables a simple SELECT from a different table", () => {
    expect(
      columnInsertDisabledReason(`SELECT * FROM ${TABLE_A}`, TABLE_B, "email"),
    ).toMatch(/different table/);
  });

  it("disables a column already in the SELECT list", () => {
    expect(
      columnInsertDisabledReason(
        `SELECT user_id FROM ${TABLE_A}`,
        TABLE_A,
        "user_id",
      ),
    ).toMatch(/already in SELECT/);
    expect(
      columnInsertDisabledReason(
        `SELECT user_id FROM ${TABLE_A}`,
        TABLE_A,
        "ts",
      ),
    ).toBeNull();
    expect(
      columnInsertDisabledReason(
        `SELECT "user_id" FROM ${TABLE_A}`,
        TABLE_A,
        "user_id",
      ),
    ).toMatch(/already in SELECT/);
  });

  it("matches quoted and backtick paths case-insensitively", () => {
    expect(
      columnInsertDisabledReason(
        `SELECT * FROM "Analytics"."Events"`,
        TABLE_A,
        "user_id",
      ),
    ).toBeNull();
    expect(
      columnInsertDisabledReason(
        `SELECT * FROM \`analytics\`.\`events\``,
        TABLE_A,
        "user_id",
      ),
    ).toBeNull();
  });

  it("disables CTEs, UNIONs, and multiple SELECT statements", () => {
    expect(
      columnInsertDisabledReason(
        `WITH x AS (SELECT 1) SELECT * FROM x`,
        TABLE_A,
        "user_id",
      ),
    ).toMatch(/too complex/);
    expect(
      columnInsertDisabledReason(
        `SELECT a FROM ${TABLE_A} UNION SELECT b FROM ${TABLE_B}`,
        TABLE_A,
        "user_id",
      ),
    ).toMatch(/too complex/);
  });
});

describe("insertColumnIntoSelect", () => {
  it("overwrites empty, WHERE, and JOIN queries", () => {
    expect(insertColumnIntoSelect("", "user_id", TABLE_A)).toBe(
      `SELECT user_id FROM ${TABLE_A}`,
    );
    expect(
      insertColumnIntoSelect(
        `SELECT * FROM ${TABLE_A} WHERE id = 1`,
        "user_id",
        TABLE_A,
      ),
    ).toBe(`SELECT user_id FROM ${TABLE_A}`);
    expect(
      insertColumnIntoSelect(
        `SELECT * FROM ${TABLE_A} JOIN ${TABLE_B} ON events.user_id = users.id`,
        "user_id",
        TABLE_A,
      ),
    ).toBe(`SELECT user_id FROM ${TABLE_A}`);
  });

  it("replaces star and appends columns on a simple SELECT from this table", () => {
    expect(
      insertColumnIntoSelect(`SELECT * FROM ${TABLE_A}`, "user_id", TABLE_A),
    ).toBe(`SELECT user_id FROM ${TABLE_A}`);
    expect(
      insertColumnIntoSelect(`SELECT user_id FROM ${TABLE_A}`, "ts", TABLE_A),
    ).toBe(`SELECT user_id, ts FROM ${TABLE_A}`);
  });

  it("preserves LIMIT when replacing star or appending", () => {
    expect(
      insertColumnIntoSelect(
        `SELECT * FROM ${TABLE_A} LIMIT 10`,
        "user_id",
        TABLE_A,
      ),
    ).toBe(`SELECT user_id FROM ${TABLE_A} LIMIT 10`);
    expect(
      insertColumnIntoSelect(
        `SELECT user_id FROM ${TABLE_A} LIMIT 10`,
        "ts",
        TABLE_A,
      ),
    ).toBe(`SELECT user_id, ts FROM ${TABLE_A} LIMIT 10`);
  });

  it("is a no-op for a duplicate column or a complex query", () => {
    expect(
      insertColumnIntoSelect(
        `SELECT user_id FROM ${TABLE_A}`,
        "user_id",
        TABLE_A,
      ),
    ).toBe(`SELECT user_id FROM ${TABLE_A}`);
    const cte = `WITH x AS (SELECT 1) SELECT * FROM x`;
    expect(insertColumnIntoSelect(cte, "user_id", TABLE_A)).toBe(cte);
  });

  it("does not rewrite a simple SELECT from a different table", () => {
    expect(
      insertColumnIntoSelect(`SELECT * FROM ${TABLE_A}`, "email", TABLE_B),
    ).toBe(`SELECT * FROM ${TABLE_A}`);
  });
});
