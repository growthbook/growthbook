import { getDimensionSlicesIdentifierType } from "back-end/src/queryRunners/DimensionSlicesQueryRunner";

describe("getDimensionSlicesIdentifierType", () => {
  it("keeps the legacy identifier while the query declares it", () => {
    expect(
      getDimensionSlicesIdentifierType({
        userIdType: "anonymous_id",
        userIdTypes: ["user_id", "anonymous_id"],
      }),
    ).toBe("anonymous_id");
  });

  it("uses a declared identifier once the legacy one was removed", () => {
    expect(
      getDimensionSlicesIdentifierType({
        userIdType: "anonymous_id",
        userIdTypes: ["user_id"],
      }),
    ).toBe("user_id");
  });
});
