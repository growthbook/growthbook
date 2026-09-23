import { ExposureQuery } from "shared/types/datasource";
import { getExposureQueryIdentifierTypes } from "shared/util";
import { describe, expect, it } from "vitest";
import {
  getDefaultIdentifierType,
  getIdentifierTypeForHashAttribute,
  getExposureQueriesForProject,
  getDefaultIdentifierTypeForQuery,
  getGroupedIdentifierTypeOptions,
  getHashAttributeIdentifierTypeMap,
  getSelectableIdentifierTypes,
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

describe("getDefaultIdentifierTypeForQuery", () => {
  const query = makeExposureQuery({
    userIdType: "user_id",
    userIdTypes: ["user_id", "anonymous_id"],
  });

  it("returns the preferred identifier when the query declares it", () => {
    expect(getDefaultIdentifierTypeForQuery(query, "anonymous_id")).toBe(
      "anonymous_id",
    );
  });

  it("ignores a preferred identifier the query does not declare", () => {
    expect(getDefaultIdentifierTypeForQuery(query, "device_id")).toBe(
      "user_id",
    );
  });

  it("returns the first declared identifier when no preference is given", () => {
    expect(getDefaultIdentifierTypeForQuery(query)).toBe("user_id");
  });

  it("falls back to the deprecated scalar for a legacy query", () => {
    expect(
      getDefaultIdentifierTypeForQuery(
        makeExposureQuery({ userIdType: "user_id", userIdTypes: [] }),
      ),
    ).toBe("user_id");
  });
});

describe("getExposureQueriesForProject", () => {
  const scoped = makeExposureQuery({
    id: "exq_a",
    userIdType: "user_id",
    userIdTypes: ["user_id"],
    projects: ["prj_a"],
  });
  const unscoped = makeExposureQuery({
    id: "exq_all",
    userIdType: "user_id",
    userIdTypes: ["user_id"],
    projects: [],
  });

  it("keeps queries scoped to the project and queries with no scope", () => {
    expect(
      getExposureQueriesForProject([scoped, unscoped], "prj_a").map(
        (q) => q.id,
      ),
    ).toEqual(["exq_a", "exq_all"]);
  });

  it("drops queries scoped to a different project", () => {
    expect(
      getExposureQueriesForProject([scoped, unscoped], "prj_b").map(
        (q) => q.id,
      ),
    ).toEqual(["exq_all"]);
  });
});

describe("getHashAttributeIdentifierTypeMap", () => {
  it("maps each attribute to every identifier type linked to it", () => {
    const map = getHashAttributeIdentifierTypeMap([
      { userIdType: "user_id", attributes: ["id", "email"] },
      { userIdType: "device_id", attributes: ["id"] },
      { userIdType: "anonymous_id" },
    ]);
    expect(map.get("id")).toEqual(["user_id", "device_id"]);
    expect(map.get("email")).toEqual(["user_id"]);
    expect(map.has("anonymous_id")).toBe(false);
  });

  it("returns an empty map when no identifier declares attributes", () => {
    expect(
      getHashAttributeIdentifierTypeMap([{ userIdType: "user_id" }]).size,
    ).toBe(0);
  });
});

describe("getSelectableIdentifierTypes", () => {
  it("de-duplicates across queries and keeps declaration order", () => {
    expect(
      getSelectableIdentifierTypes([
        makeExposureQuery({
          id: "exq_1",
          userIdType: "user_id",
          userIdTypes: ["user_id", "device_id"],
        }),
        makeExposureQuery({
          id: "exq_2",
          userIdType: "anonymous_id",
          userIdTypes: ["anonymous_id", "user_id"],
        }),
      ]),
    ).toEqual(["user_id", "device_id", "anonymous_id"]);
  });

  it("falls back to the deprecated scalar for legacy queries", () => {
    expect(
      getSelectableIdentifierTypes([
        makeExposureQuery({ userIdType: "user_id", userIdTypes: [] }),
      ]),
    ).toEqual(["user_id"]);
  });
});

describe("getGroupedIdentifierTypeOptions", () => {
  const identifierTypes = ["user_id", "anonymous_id"];

  it("returns a flat list when the data source has no linkages", () => {
    expect(
      getGroupedIdentifierTypeOptions({
        identifierTypes,
        hashAttributeIdentifierTypeMap: new Map(),
        hashAttribute: "id",
      }),
    ).toEqual([
      { label: "user_id", value: "user_id" },
      { label: "anonymous_id", value: "anonymous_id" },
    ]);
  });

  it("splits matching and non-matching identifiers once a linkage exists", () => {
    expect(
      getGroupedIdentifierTypeOptions({
        identifierTypes,
        hashAttributeIdentifierTypeMap: new Map([["id", ["user_id"]]]),
        hashAttribute: "id",
      }),
    ).toEqual([
      {
        label: "Matches hash attribute",
        options: [{ label: "user_id", value: "user_id" }],
      },
      {
        label: "Does not match hash attribute",
        options: [{ label: "anonymous_id", value: "anonymous_id" }],
      },
    ]);
  });

  it("omits the matching group when the hash attribute has no linkage", () => {
    expect(
      getGroupedIdentifierTypeOptions({
        identifierTypes,
        hashAttributeIdentifierTypeMap: new Map([["other", ["device_id"]]]),
        hashAttribute: "id",
      }),
    ).toEqual([
      {
        label: "Does not match hash attribute",
        options: [
          { label: "user_id", value: "user_id" },
          { label: "anonymous_id", value: "anonymous_id" },
        ],
      },
    ]);
  });
});

describe("getDefaultIdentifierType", () => {
  const identifierTypes = ["user_id", "anonymous_id"];

  it("keeps the stored identifier when it is still selectable", () => {
    expect(
      getDefaultIdentifierType({
        identifierTypes,
        hashAttributeIdentifierTypeMap: new Map([["id", ["anonymous_id"]]]),
        hashAttribute: "id",
        storedIdentifierType: "user_id",
      }),
    ).toBe("user_id");
  });

  it("pre-fills from the hash attribute when it resolves to exactly one identifier", () => {
    expect(
      getDefaultIdentifierType({
        identifierTypes,
        hashAttributeIdentifierTypeMap: new Map([["id", ["anonymous_id"]]]),
        hashAttribute: "id",
      }),
    ).toBe("anonymous_id");
  });

  it("falls back to the first identifier when the hash attribute is ambiguous", () => {
    expect(
      getDefaultIdentifierType({
        identifierTypes,
        hashAttributeIdentifierTypeMap: new Map([
          ["id", ["user_id", "anonymous_id"]],
        ]),
        hashAttribute: "id",
      }),
    ).toBe("user_id");
  });

  it("ignores a stored identifier that is no longer selectable", () => {
    expect(
      getDefaultIdentifierType({
        identifierTypes,
        hashAttributeIdentifierTypeMap: new Map(),
        hashAttribute: "id",
        storedIdentifierType: "device_id",
      }),
    ).toBe("user_id");
  });

  it("ignores a linkage to an identifier no query declares", () => {
    expect(
      getDefaultIdentifierType({
        identifierTypes,
        hashAttributeIdentifierTypeMap: new Map([["id", ["device_id"]]]),
        hashAttribute: "id",
      }),
    ).toBe("user_id");
  });

  it("returns undefined when there is nothing to select", () => {
    expect(
      getDefaultIdentifierType({
        identifierTypes: [],
        hashAttributeIdentifierTypeMap: new Map(),
        hashAttribute: "id",
      }),
    ).toBeUndefined();
  });
});

describe("getIdentifierTypeForHashAttribute", () => {
  const identifierTypes = ["anonymous_id", "user_id"];
  const hashAttributeIdentifierTypeMap = new Map([
    ["id", ["user_id"]],
    ["deviceId", ["anonymous_id"]],
    ["unlinkedToQuery", ["company_id"]],
  ]);

  it("switches to the identifier linked to the new hash attribute", () => {
    expect(
      getIdentifierTypeForHashAttribute({
        identifierTypes,
        hashAttributeIdentifierTypeMap,
        hashAttribute: "id",
        currentIdentifierType: "anonymous_id",
      }),
    ).toBe("user_id");
  });

  it("keeps an identifier already linked to the new hash attribute", () => {
    expect(
      getIdentifierTypeForHashAttribute({
        identifierTypes,
        hashAttributeIdentifierTypeMap,
        hashAttribute: "deviceId",
        currentIdentifierType: "anonymous_id",
      }),
    ).toBeNull();
  });

  it("keeps the current identifier when nothing selectable is linked", () => {
    for (const hashAttribute of ["unlinkedToQuery", "notLinked"]) {
      expect(
        getIdentifierTypeForHashAttribute({
          identifierTypes,
          hashAttributeIdentifierTypeMap,
          hashAttribute,
          currentIdentifierType: "anonymous_id",
        }),
      ).toBeNull();
    }
  });
});
