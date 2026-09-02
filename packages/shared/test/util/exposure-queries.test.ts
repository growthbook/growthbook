import { getExposureQueriesWithChangedBaseIdentifier } from "shared/util";
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
