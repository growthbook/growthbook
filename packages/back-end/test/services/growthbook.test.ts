import {
  getRoutePath,
  parseContentLength,
} from "back-end/src/services/growthbook";

describe("parseContentLength", () => {
  it("returns undefined when the header is absent", () => {
    expect(parseContentLength(undefined)).toBeUndefined();
  });

  it("parses a numeric header value", () => {
    expect(parseContentLength("1234")).toBe(1234);
  });

  it("parses a zero-length header value", () => {
    expect(parseContentLength("0")).toBe(0);
  });

  it("returns undefined for a non-numeric header value", () => {
    expect(parseContentLength("not-a-number")).toBeUndefined();
  });
});

describe("getRoutePath", () => {
  it("combines baseUrl and the matched route pattern", () => {
    expect(
      getRoutePath({
        path: "/reset/abc123secrettoken",
        baseUrl: "/auth",
        route: { path: "/reset/:token" },
      }),
    ).toBe("/auth/reset/:token");
  });

  it("returns the bare route pattern when there is no baseUrl", () => {
    expect(
      getRoutePath({
        path: "/revision/feature",
        baseUrl: "",
        route: { path: "/revision/feature" },
      }),
    ).toBe("/revision/feature");
  });

  it("falls back to a placeholder instead of the raw path when nothing matched", () => {
    expect(
      getRoutePath({
        path: "/api/keys/sk-live-abc123",
        baseUrl: "",
        route: undefined,
      }),
    ).toBe("(unmatched)");
  });
});
