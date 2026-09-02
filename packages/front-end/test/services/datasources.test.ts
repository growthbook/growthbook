import { ExposureQuery } from "shared/types/datasource";
import { describe, expect, it } from "vitest";
import {
  getExposureQueryIdentifierType,
  getExposureQueryIdentifierTypes,
  validateSQL,
} from "@/services/datasources";

// The helpers only read userIdType/userIdTypes; build a minimal query.
function makeExposureQuery(
  partial: Partial<ExposureQuery> &
    Pick<ExposureQuery, "userIdType" | "userIdTypes">,
): ExposureQuery {
  return {
    id: "exq_1",
    name: "Assignments",
    query: "SELECT 1",
    dimensions: [],
    ...partial,
  };
}

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

describe("getExposureQueryIdentifierTypes", () => {
  it("returns userIdTypes when present", () => {
    expect(
      getExposureQueryIdentifierTypes(
        makeExposureQuery({
          userIdType: "user_id",
          userIdTypes: ["user_id", "anonymous_id"],
        }),
      ),
    ).toEqual(["user_id", "anonymous_id"]);
  });

  it("falls back to the deprecated scalar when userIdTypes is empty", () => {
    expect(
      getExposureQueryIdentifierTypes(
        makeExposureQuery({ userIdType: "user_id", userIdTypes: [] }),
      ),
    ).toEqual(["user_id"]);
  });

  it("returns an empty list when neither is set", () => {
    expect(
      getExposureQueryIdentifierTypes(
        makeExposureQuery({ userIdType: "", userIdTypes: [] }),
      ),
    ).toEqual([]);
  });
});

describe("getExposureQueryIdentifierType", () => {
  const query = makeExposureQuery({
    userIdType: "user_id",
    userIdTypes: ["user_id", "anonymous_id"],
  });

  it("returns the preferred identifier when the query declares it", () => {
    expect(getExposureQueryIdentifierType(query, "anonymous_id")).toBe(
      "anonymous_id",
    );
  });

  it("ignores a preferred identifier the query does not declare", () => {
    expect(getExposureQueryIdentifierType(query, "device_id")).toBe("user_id");
  });

  it("returns the first declared identifier when no preference is given", () => {
    expect(getExposureQueryIdentifierType(query)).toBe("user_id");
  });

  it("falls back to the deprecated scalar for a legacy query", () => {
    expect(
      getExposureQueryIdentifierType(
        makeExposureQuery({ userIdType: "user_id", userIdTypes: [] }),
      ),
    ).toBe("user_id");
  });
});
