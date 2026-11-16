import { getConditionKeyMatches } from "back-end/src/services/attributeReferences";

describe("getConditionKeyMatches", () => {
  it("matches an exact key", () => {
    expect(getConditionKeyMatches("country", new Set(["country"]))).toEqual([
      "country",
    ]);
  });

  it("matches each requested dotted parent", () => {
    expect(
      getConditionKeyMatches("a.b.c", new Set(["a", "a.b", "a.b.c", "x"])),
    ).toEqual(["a.b.c", "a.b", "a"]);
  });

  it("matches an attribute literally named with a dot", () => {
    expect(
      getConditionKeyMatches("user.country", new Set(["user.country"])),
    ).toEqual(["user.country"]);
  });

  it("does not match children or partial segments", () => {
    expect(
      getConditionKeyMatches("user", new Set(["user.country", "use"])),
    ).toEqual([]);
    expect(getConditionKeyMatches("username", new Set(["user"]))).toEqual([]);
  });
});
