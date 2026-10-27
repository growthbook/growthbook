import { assertSafeTablePathParts } from "back-end/src/integrations/sql/primitives/table-path";

describe("assertSafeTablePathParts", () => {
  it("accepts plain names, BigQuery project ids, and missing parts", () => {
    expect(() =>
      assertSafeTablePathParts("my-project-123", "analytics_1", "événements"),
    ).not.toThrow();
    expect(() =>
      assertSafeTablePathParts(undefined, "", "events"),
    ).not.toThrow();
  });

  it.each(["x'y", "a b", "a--b", "a.b", "a`b", "a\\b", "t; DROP TABLE x"])(
    "rejects %s",
    (part) => {
      expect(() => assertSafeTablePathParts("db", part)).toThrow(
        "Invalid table path name",
      );
    },
  );
});
