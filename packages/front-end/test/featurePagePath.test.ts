import { getFeaturePagePath, parseVersion } from "@/hooks/useFeaturePageData";

describe("parseVersion", () => {
  it("parses a version from the query", () => {
    expect(parseVersion("3")).toBe(3);
    expect(parseVersion(["4", "5"])).toBe(4);
  });

  it("returns null when there is no usable version", () => {
    expect(parseVersion(undefined)).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion([])).toBeNull();
    expect(parseVersion("abc")).toBeNull();
  });
});

describe("getFeaturePagePath", () => {
  it("builds the feature page request path", () => {
    expect(getFeaturePagePath("my-flag", null)).toBe("/feature/my-flag");
    expect(getFeaturePagePath("my-flag", 7)).toBe("/feature/my-flag?v=7");
    expect(getFeaturePagePath("my-flag", 0)).toBe("/feature/my-flag?v=0");
  });

  it("returns an empty path without a feature id", () => {
    expect(getFeaturePagePath(undefined, null)).toBe("");
    expect(getFeaturePagePath("", 2)).toBe("");
  });
});
