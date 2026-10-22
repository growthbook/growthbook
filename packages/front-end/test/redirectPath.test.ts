import {
  getVercelDeepLinkPath,
  isSameOriginRelativePath,
} from "@/services/redirectPath";

describe("isSameOriginRelativePath", () => {
  it.each(["/", "/features/abc", "/features/abc?org=org_1"])(
    "accepts %s",
    (path) => {
      expect(isSameOriginRelativePath(path)).toBe(true);
    },
  );

  it.each([
    "//evil.test",
    "/\\evil.test",
    "/\t/evil.test",
    "/\n/evil.test",
    "/\r\n/evil.test",
    "https://evil.test",
    "features/a",
  ])("rejects %s", (path) => {
    expect(isSameOriginRelativePath(path)).toBe(false);
  });
});

describe("getVercelDeepLinkPath", () => {
  it("builds a single-slash path for features", () => {
    expect(getVercelDeepLinkPath("features:my-flag")).toBe("/features/my-flag");
  });

  it("builds a single-slash path for experiments", () => {
    expect(getVercelDeepLinkPath("experiment:exp_123")).toBe(
      "/experiment/exp_123",
    );
  });

  it.each([undefined, "", "other:abc", "features", "https://evil.test"])(
    "returns undefined for %s",
    (value) => {
      expect(getVercelDeepLinkPath(value)).toBeUndefined();
    },
  );
});
