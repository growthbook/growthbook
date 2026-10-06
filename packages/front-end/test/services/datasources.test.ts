import { ExposureQuery } from "shared/types/datasource";
import { describe, expect, it } from "vitest";
import {
  getDefaultIdentifierType,
  getIdentifierTypeForHashAttribute,
  isIdentifierUndeclared,
  getCopiedAssignmentQueryNotice,
  getCopySourceIdentifierType,
  getDefaultIdentifierTypeForQuery,
  getGroupedIdentifierTypeOptions,
  getHashAttributeIdentifierTypeMap,
  getInitialSettings,
  getSelectableIdentifierTypes,
  validateSQL,
} from "@/services/datasources";

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
});

describe("isIdentifierUndeclared", () => {
  const query = makeExposureQuery({
    id: "exq_a",
    userIdType: "user_id",
    userIdTypes: ["user_id"],
  });

  it("is false for a query declaring the identifier", () => {
    expect(isIdentifierUndeclared(query, "user_id")).toBe(false);
  });

  it("flags an identifier the query no longer declares", () => {
    expect(isIdentifierUndeclared(query, "anon_id")).toBe(true);
  });

  it("is false without a query", () => {
    expect(isIdentifierUndeclared(undefined, "user_id")).toBe(false);
  });
});

describe("getCopiedAssignmentQueryNotice", () => {
  const dropped = makeExposureQuery({
    id: "exq_dropped",
    name: "Dropped",
    userIdType: "anonymous_id",
    userIdTypes: ["user_id"],
  });
  const other = makeExposureQuery({
    id: "exq_other",
    name: "Other",
    userIdType: "anonymous_id",
    userIdTypes: ["anonymous_id"],
  });
  const datasource = {
    id: "ds_1",
    settings: { queries: { exposure: [dropped, other] } },
  };
  const legacyCopy = {
    kind: "copy" as const,
    datasource: "ds_1",
    exposureQueryId: "exq_dropped",
  };

  it("explains a switch to another query declaring the source's identifier", () => {
    expect(
      getCopiedAssignmentQueryNotice(datasource, legacyCopy, {
        exposureQueryId: "exq_other",
        identifierType: "anonymous_id",
      }),
    ).toEqual({
      status: "info",
      message:
        '"Dropped" no longer declares the "anonymous_id" identifier type the source analyzed on, so this copy uses "Other", which does.',
    });
  });

  it("asks for an identifier when the copy's was left unset", () => {
    expect(
      getCopiedAssignmentQueryNotice(datasource, legacyCopy, {
        exposureQueryId: "exq_dropped",
      }),
    ).toEqual({
      status: "warning",
      message:
        'The source analyzed on "anonymous_id", which no assignment query here declares. Choose an identifier type for this copy.',
    });
  });

  it("warns when the copy measures different units than its source", () => {
    expect(
      getCopiedAssignmentQueryNotice(datasource, legacyCopy, {
        exposureQueryId: "exq_dropped",
        identifierType: "user_id",
      }),
    ).toEqual({
      status: "warning",
      message:
        'The source analyzed on "anonymous_id", which "Dropped" no longer declares. This copy analyzes on "user_id" instead, so it measures different units than the source.',
    });
  });

  it("words a template's notice for the new experiment", () => {
    expect(
      getCopiedAssignmentQueryNotice(
        datasource,
        { ...legacyCopy, kind: "template" },
        { exposureQueryId: "exq_dropped" },
      )?.message,
    ).toBe(
      'The template analyzed on "anonymous_id", which no assignment query here declares. Choose an identifier type for this experiment.',
    );
  });

  it("is null when the source's selection still works", () => {
    expect(
      getCopiedAssignmentQueryNotice(
        datasource,
        { kind: "copy", datasource: "ds_1", exposureQueryId: "exq_other" },
        { exposureQueryId: "exq_dropped", identifierType: "user_id" },
      ),
    ).toBeNull();
  });

  it("is null without a source, or for a source on another data source", () => {
    expect(
      getCopiedAssignmentQueryNotice(datasource, null, {
        exposureQueryId: "exq_other",
        identifierType: "anonymous_id",
      }),
    ).toBeNull();
    expect(
      getCopiedAssignmentQueryNotice(
        datasource,
        { ...legacyCopy, datasource: "ds_2" },
        { exposureQueryId: "exq_other", identifierType: "anonymous_id" },
      ),
    ).toBeNull();
  });
});

describe("getCopySourceIdentifierType", () => {
  const reordered = makeExposureQuery({
    id: "exq_1",
    userIdType: "anonymous_id",
    userIdTypes: ["user_id", "anonymous_id"],
  });
  const datasource = {
    id: "ds_1",
    settings: { queries: { exposure: [reordered] } },
  };

  it("is undefined without a source query", () => {
    expect(
      getCopySourceIdentifierType(datasource, {
        kind: "copy",
        datasource: "ds_1",
        exposureQueryId: "exq_gone",
      }),
    ).toBeUndefined();
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

describe("getInitialSettings", () => {
  const clickhouseParams = {
    url: "http://localhost:8123",
    database: "default",
  };
  const postgresParams = {
    host: "localhost",
    database: "phoenix",
    defaultSchema: "public",
  };

  it("keeps the existing exposure query names for segment", () => {
    // @ts-expect-error minimal params for the test
    const settings = getInitialSettings("segment", postgresParams);
    expect(settings.queries.exposure.map((q) => q.name)).toEqual([
      "Anonymous Visitors",
      "Logged-in Users",
    ]);
  });

  it("builds langfuse exposure queries for user, session, and trace ids", () => {
    // @ts-expect-error minimal params for the test
    const settings = getInitialSettings("langfuse", clickhouseParams, {
      projectId: "proj_1",
    });
    expect(settings.queries.exposure.map((q) => q.id)).toEqual([
      "user_id",
      "session_id",
      "trace_id",
    ]);
    expect(settings.queries.exposure.map((q) => q.name)).toEqual([
      "Logged-in Users",
      "Sessions",
      "Traces",
    ]);
    for (const q of settings.queries.exposure) {
      expect(() =>
        validateSQL(q.query, [
          q.userIdType,
          "timestamp",
          "experiment_id",
          "variation_id",
          ...q.dimensions,
        ]),
      ).not.toThrow();
      expect(q.query).toContain("ARRAY JOIN");
      expect(q.query).toContain("startsWith(tag, 'gb.exp:')");
      expect(q.query).toContain("substring(splitByChar('=', tag)[1], 8)");
      expect(q.query).toContain("project_id = 'proj_1'");
    }
    expect(settings.queries.identityJoins).toHaveLength(1);
    expect(settings.queries.identityJoins[0].ids).toEqual([
      "user_id",
      "session_id",
    ]);
    for (const t of settings.userIdTypes) {
      expect(t.description).not.toEqual("");
    }
  });

  it("builds phoenix exposure queries against the root span", () => {
    // @ts-expect-error minimal params for the test
    const settings = getInitialSettings("phoenix", postgresParams, {
      projectName: "default",
    });
    expect(settings.queries.exposure.map((q) => q.id)).toEqual([
      "user_id",
      "session_id",
      "trace_id",
    ]);
    for (const q of settings.queries.exposure) {
      expect(() =>
        validateSQL(q.query, [
          q.userIdType,
          "timestamp",
          "experiment_id",
          "variation_id",
          ...q.dimensions,
        ]),
      ).not.toThrow();
      expect(q.query).toContain("jsonb_array_elements_text");
      expect(q.query).toContain("LIKE 'gb.exp:%'");
      expect(q.query).toContain("substr(split_part(gb_tags.tag, '=', 1), 8)");
      expect(q.query).toContain("public.traces");
      expect(q.query).toContain("root.parent_id IS NULL");
      expect(q.query).toContain("p.name = 'default'");
    }
    expect(settings.queries.identityJoins).toHaveLength(1);
  });

  it("omits the project filter when the option is blank", () => {
    // @ts-expect-error minimal params for the test
    const settings = getInitialSettings("langfuse", clickhouseParams, {
      projectId: "",
    });
    for (const q of settings.queries.exposure) {
      expect(q.query).not.toContain("project_id = '");
    }
  });
});
