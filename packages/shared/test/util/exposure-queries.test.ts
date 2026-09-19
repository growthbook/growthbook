import {
  assertExposureQueryDeclaresIdentifierType,
  getExposureQueryIdentifierTypes,
  parseAssignmentQueryInput,
  getExposureQueriesOutsideProjectScope,
  getExposureQueriesWithChangedBaseIdentifier,
  getAnalysisIdentifierType,
  assertValidAssignmentQuerySelection,
  isExposureQueryAvailableForProjects,
  hasAssignmentQuerySelectionChanged,
  toApiAssignmentQueryRef,
  flattenExposureQueryInput,
  getExposureQueryExperimentIdColumn,
  getExposureQueryIdentifierColumn,
  getExposureQueryTimestampColumn,
  getExposureQueryVariationIdColumn,
} from "shared/util";
import { ExposureQuery } from "shared/types/datasource";

function query(
  partial: Partial<ExposureQuery> &
    Pick<ExposureQuery, "id" | "userIdType" | "userIdTypes">,
): ExposureQuery {
  return {
    name: partial.id,
    query: "SELECT 1",
    dimensions: [],
    ...partial,
  };
}

describe("getExposureQueriesWithChangedBaseIdentifier", () => {
  it("flags a query whose first identifier was removed", () => {
    const result = getExposureQueriesWithChangedBaseIdentifier(
      [
        query({
          id: "q1",
          userIdType: "user_id",
          userIdTypes: ["user_id", "anonymous_id"],
        }),
      ],
      [
        query({
          id: "q1",
          userIdType: "anonymous_id",
          userIdTypes: ["anonymous_id"],
        }),
      ],
    );
    expect(result).toEqual([{ id: "q1", previousIdentifierType: "user_id" }]);
  });

  it("flags a query whose identifiers were reordered", () => {
    const result = getExposureQueriesWithChangedBaseIdentifier(
      [
        query({
          id: "q1",
          userIdType: "user_id",
          userIdTypes: ["user_id", "anonymous_id"],
        }),
      ],
      [
        query({
          id: "q1",
          userIdType: "anonymous_id",
          userIdTypes: ["anonymous_id", "user_id"],
        }),
      ],
    );
    expect(result).toEqual([{ id: "q1", previousIdentifierType: "user_id" }]);
  });

  it("ignores appending an identifier (first is unchanged)", () => {
    const result = getExposureQueriesWithChangedBaseIdentifier(
      [query({ id: "q1", userIdType: "user_id", userIdTypes: ["user_id"] })],
      [
        query({
          id: "q1",
          userIdType: "user_id",
          userIdTypes: ["user_id", "anonymous_id"],
        }),
      ],
    );
    expect(result).toEqual([]);
  });

  it("ignores newly added and deleted queries", () => {
    const result = getExposureQueriesWithChangedBaseIdentifier(
      [query({ id: "gone", userIdType: "user_id", userIdTypes: ["user_id"] })],
      [
        query({
          id: "new",
          userIdType: "anonymous_id",
          userIdTypes: ["anonymous_id"],
        }),
      ],
    );
    expect(result).toEqual([]);
  });

  it("falls back to the deprecated scalar for legacy queries", () => {
    const result = getExposureQueriesWithChangedBaseIdentifier(
      [query({ id: "q1", userIdType: "user_id", userIdTypes: [] })],
      [query({ id: "q1", userIdType: "anonymous_id", userIdTypes: [] })],
    );
    expect(result).toEqual([{ id: "q1", previousIdentifierType: "user_id" }]);
  });
});

describe("getExposureQueriesOutsideProjectScope", () => {
  it("flags a query scoped to a project the data source is not", () => {
    const result = getExposureQueriesOutsideProjectScope(
      [{ id: "q1", name: "Q1", projects: ["p1", "p3"] }],
      ["p1", "p2"],
    );
    expect(result).toEqual([{ id: "q1", name: "Q1", invalidProjects: ["p3"] }]);
  });

  it("allows a query whose projects are a subset of the data source's", () => {
    expect(
      getExposureQueriesOutsideProjectScope(
        [{ id: "q1", name: "Q1", projects: ["p1"] }],
        ["p1", "p2"],
      ),
    ).toEqual([]);
  });

  it("treats an empty data source project list as all projects", () => {
    expect(
      getExposureQueriesOutsideProjectScope(
        [{ id: "q1", name: "Q1", projects: ["p1"] }],
        [],
      ),
    ).toEqual([]);
  });

  it("treats a query with no projects as inheriting the data source scope", () => {
    expect(
      getExposureQueriesOutsideProjectScope(
        [
          { id: "q1", name: "Q1", projects: [] },
          { id: "q2", name: "Q2", projects: undefined },
        ],
        ["p1"],
      ),
    ).toEqual([]);
  });
});

describe("assertExposureQueryDeclaresIdentifierType", () => {
  const multi = query({
    id: "exq_multi",
    name: "Multi",
    userIdType: "user_id",
    userIdTypes: ["user_id", "anonymous_id"],
  });

  it("allows any declared identifier, including a secondary one", () => {
    expect(() =>
      assertExposureQueryDeclaresIdentifierType(multi, "anonymous_id"),
    ).not.toThrow();
  });

  it("allows a missing identifier type", () => {
    expect(() =>
      assertExposureQueryDeclaresIdentifierType(multi, undefined),
    ).not.toThrow();
    expect(() =>
      assertExposureQueryDeclaresIdentifierType(multi, ""),
    ).not.toThrow();
  });

  it("throws for an identifier the query does not declare", () => {
    expect(() =>
      assertExposureQueryDeclaresIdentifierType(multi, "device_id"),
    ).toThrow(
      'Assignment query "Multi" no longer declares the "device_id" identifier type. Choose an assignment query that declares it',
    );
  });

  it("falls back to the legacy scalar when userIdTypes is empty", () => {
    const legacy = query({
      id: "exq_legacy",
      userIdType: "user_id",
      userIdTypes: [],
    });
    expect(() =>
      assertExposureQueryDeclaresIdentifierType(legacy, "user_id"),
    ).not.toThrow();
    expect(() =>
      assertExposureQueryDeclaresIdentifierType(legacy, "anonymous_id"),
    ).toThrow();
  });
});

describe("getExposureQueryIdentifierTypes", () => {
  it("returns the declared identifier types", () => {
    expect(
      getExposureQueryIdentifierTypes({
        userIdType: "user_id",
        userIdTypes: ["user_id", "anonymous_id"],
      }),
    ).toEqual(["user_id", "anonymous_id"]);
  });

  it("falls back to the legacy scalar", () => {
    expect(
      getExposureQueryIdentifierTypes({
        userIdType: "user_id",
        userIdTypes: [],
      }),
    ).toEqual(["user_id"]);
  });

  it("returns nothing when neither is set", () => {
    expect(
      getExposureQueryIdentifierTypes({ userIdType: "", userIdTypes: [] }),
    ).toEqual([]);
  });
});

describe("parseAssignmentQueryInput", () => {
  it("reads the id and identifier type from the grouped field", () => {
    expect(
      parseAssignmentQueryInput(
        { id: "exq_1", identifierType: "anonymous_id" },
        undefined,
        "assignmentQuery",
      ),
    ).toEqual({ id: "exq_1", identifierType: "anonymous_id" });
  });

  it("falls back to the deprecated id with no identifier type", () => {
    expect(
      parseAssignmentQueryInput(undefined, "exq_1", "exposureQuery"),
    ).toEqual({ id: "exq_1", identifierType: undefined });
  });

  it("returns nothing when neither is set", () => {
    expect(
      parseAssignmentQueryInput(undefined, undefined, "assignmentQuery"),
    ).toEqual({ id: undefined, identifierType: undefined });
  });

  it("rejects both fields together, naming them", () => {
    expect(() =>
      parseAssignmentQueryInput(
        { id: "exq_1", identifierType: "user_id" },
        "exq_2",
        "exposureQuery",
      ),
    ).toThrow(
      "Cannot set exposureQuery together with the deprecated exposureQueryId",
    );
  });
});

describe("getAnalysisIdentifierType", () => {
  const multi = query({
    id: "eq_1",
    userIdType: "anonymous_id",
    userIdTypes: ["anonymous_id", "user_id"],
  });

  it("uses the stored identifier, even when the query no longer declares it", () => {
    expect(getAnalysisIdentifierType(multi, "user_id")).toBe("user_id");
    expect(getAnalysisIdentifierType(multi, "company_id")).toBe("company_id");
  });

  it("falls back to the query's first identifier when none is stored", () => {
    expect(getAnalysisIdentifierType(multi, undefined)).toBe("anonymous_id");
  });

  it("is undefined with neither a stored identifier nor a query", () => {
    expect(getAnalysisIdentifierType(undefined, undefined)).toBeUndefined();
  });
});

describe("assertValidAssignmentQuerySelection", () => {
  const exposureQueries = [
    query({
      id: "eq_multi",
      userIdType: "anonymous_id",
      userIdTypes: ["anonymous_id", "user_id"],
    }),
    query({
      id: "eq_scoped",
      userIdType: "user_id",
      userIdTypes: ["user_id"],
      projects: ["prj_a"],
    }),
  ];

  it("returns the query for a valid selection", () => {
    expect(
      assertValidAssignmentQuerySelection({
        exposureQueries,
        exposureQueryId: "eq_multi",
        identifierType: "user_id",
        project: "prj_b",
      }).id,
    ).toBe("eq_multi");
  });

  it("rejects an unknown query", () => {
    expect(() =>
      assertValidAssignmentQuerySelection({
        exposureQueries,
        exposureQueryId: "eq_missing",
        project: undefined,
      }),
    ).toThrow('Assignment query "eq_missing" doesn\'t exist');
  });

  it("rejects an identifier the query does not declare", () => {
    expect(() =>
      assertValidAssignmentQuerySelection({
        exposureQueries,
        exposureQueryId: "eq_multi",
        identifierType: "company_id",
        project: undefined,
      }),
    ).toThrow('doesn\'t declare the "company_id" identifier type');
  });

  it("rejects a query outside the project, unless the scope check is skipped", () => {
    const selection = {
      exposureQueries,
      exposureQueryId: "eq_scoped",
      identifierType: "user_id",
    };
    expect(() =>
      assertValidAssignmentQuerySelection({ ...selection, project: "prj_b" }),
    ).toThrow("isn't available for the selected project");
    expect(
      assertValidAssignmentQuerySelection({ ...selection, project: undefined })
        .id,
    ).toBe("eq_scoped");
  });
});

describe("isExposureQueryAvailableForProjects", () => {
  it("allows an unrestricted query for any projects, including all", () => {
    expect(isExposureQueryAvailableForProjects({ projects: [] }, [], [])).toBe(
      true,
    );
    expect(isExposureQueryAvailableForProjects({}, ["prj_a"], undefined)).toBe(
      true,
    );
  });

  it("requires a scoped query to cover every project", () => {
    const query = { projects: ["prj_a", "prj_b"] };
    expect(isExposureQueryAvailableForProjects(query, ["prj_a"], [])).toBe(
      true,
    );
    expect(
      isExposureQueryAvailableForProjects(query, ["prj_a", "prj_c"], []),
    ).toBe(false);
  });

  it("rejects a scoped query when all projects are covered", () => {
    expect(
      isExposureQueryAvailableForProjects({ projects: ["prj_a"] }, [], []),
    ).toBe(false);
  });

  it("applies the data source's projects to an unscoped query", () => {
    const dsProjects = ["prj_a", "prj_b"];
    expect(
      isExposureQueryAvailableForProjects({ projects: [] }, [], dsProjects),
    ).toBe(false);
    expect(
      isExposureQueryAvailableForProjects(
        { projects: [] },
        ["prj_a", "prj_c"],
        dsProjects,
      ),
    ).toBe(false);
    expect(
      isExposureQueryAvailableForProjects(
        { projects: [] },
        ["prj_b"],
        dsProjects,
      ),
    ).toBe(true);
  });
});

describe("hasAssignmentQuerySelectionChanged", () => {
  const multi = query({
    id: "eq_1",
    userIdType: "anonymous_id",
    userIdTypes: ["anonymous_id", "user_id"],
  });
  const legacy = { datasource: "ds_1", exposureQueryId: "eq_1" };

  it("treats echoing a legacy record's resolved identifier as unchanged", async () => {
    await expect(
      hasAssignmentQuerySelectionChanged(
        legacy,
        { ...legacy, identifierType: "anonymous_id" },
        async () => [multi],
      ),
    ).resolves.toBe(false);
  });

  it("detects a real identifier change", async () => {
    await expect(
      hasAssignmentQuerySelectionChanged(
        legacy,
        { ...legacy, identifierType: "user_id" },
        async () => [multi],
      ),
    ).resolves.toBe(true);
  });

  it("detects a query change without loading queries", async () => {
    const load = jest.fn(async () => [multi]);
    await expect(
      hasAssignmentQuerySelectionChanged(
        legacy,
        { ...legacy, exposureQueryId: "eq_2" },
        load,
      ),
    ).resolves.toBe(true);
    expect(load).not.toHaveBeenCalled();
  });
});

describe("toApiAssignmentQueryRef", () => {
  const multi = query({
    id: "eq_1",
    userIdType: "anonymous_id",
    userIdTypes: ["anonymous_id", "user_id"],
  });

  it("resolves a legacy record to its query's first identifier", () => {
    expect(toApiAssignmentQueryRef("eq_1", undefined, [multi])).toEqual({
      id: "eq_1",
      identifierType: "anonymous_id",
    });
  });

  it("reports the stored identifier as is, even if no longer declared", () => {
    expect(toApiAssignmentQueryRef("eq_1", "company_id", [multi])).toEqual({
      id: "eq_1",
      identifierType: "company_id",
    });
  });

  it("is undefined without a query id or a resolvable identifier", () => {
    expect(toApiAssignmentQueryRef("", "user_id", [multi])).toBeUndefined();
    expect(
      toApiAssignmentQueryRef("eq_gone", undefined, [multi]),
    ).toBeUndefined();
  });
});

describe("flattenExposureQueryInput", () => {
  it("maps the grouped object onto the flat fields and keeps the rest", () => {
    expect(
      flattenExposureQueryInput({
        exposureQuery: { id: "eq_1", identifierType: "user_id" },
        datasourceId: "ds_1",
      }),
    ).toEqual({
      exposureQueryId: "eq_1",
      exposureQueryIdentifierType: "user_id",
      datasourceId: "ds_1",
    });
  });

  it("leaves a partial body without either field untouched", () => {
    const flat = flattenExposureQueryInput({ name: "renamed" } as {
      name: string;
      exposureQueryId?: string;
    });
    expect(flat).toEqual({ name: "renamed" });
    expect(flat).not.toHaveProperty("exposureQueryId");
  });

  it("rejects the grouped object together with the deprecated id", () => {
    expect(() =>
      flattenExposureQueryInput({
        exposureQuery: { id: "eq_1", identifierType: "user_id" },
        exposureQueryId: "eq_1",
      }),
    ).toThrow("Cannot set exposureQuery together with the deprecated");
  });
});

describe("exposure query column resolvers", () => {
  it("fall back to canonical role names when unmapped", () => {
    expect(getExposureQueryExperimentIdColumn({})).toBe("experiment_id");
    expect(getExposureQueryVariationIdColumn({})).toBe("variation_id");
    expect(getExposureQueryTimestampColumn({})).toBe("timestamp");
    expect(getExposureQueryIdentifierColumn({}, "user_id")).toBe("user_id");
  });

  it("return the mapped column when set", () => {
    expect(
      getExposureQueryExperimentIdColumn({ experimentIdColumn: "exp" }),
    ).toBe("exp");
    expect(
      getExposureQueryVariationIdColumn({ variationIdColumn: "var" }),
    ).toBe("var");
    expect(getExposureQueryTimestampColumn({ timestampColumn: "ts" })).toBe(
      "ts",
    );
    expect(
      getExposureQueryIdentifierColumn(
        { userIdColumns: { user_id: "uid" } },
        "user_id",
      ),
    ).toBe("uid");
  });

  it("resolve each identifier independently, unmapped by its own name", () => {
    const query = { userIdColumns: { anonymous_id: "anon" } };
    expect(getExposureQueryIdentifierColumn(query, "anonymous_id")).toBe(
      "anon",
    );
    expect(getExposureQueryIdentifierColumn(query, "user_id")).toBe("user_id");
  });
});
