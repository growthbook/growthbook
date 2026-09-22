import {
  assertExposureQueryDeclaresIdentifierType,
  getExposureQueryIdentifierTypes,
  parseAssignmentQueryInput,
  getExposureQueriesOutsideProjectScope,
  getExposureQueriesWithChangedBaseIdentifier,
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
      'Identifier type "device_id" is no longer declared by assignment query "Multi"',
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
