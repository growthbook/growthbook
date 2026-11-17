import { evalCondition } from "../src/mongrule";
import { getApiHosts } from "../src/core";
import { paddedVersionString, trimTrailingSlashes } from "../src/util";

describe("paddedVersionString", () => {
  it("pads numeric parts and appends ~ to plain versions", () => {
    expect(paddedVersionString("1.2.3")).toBe("    1-    2-    3-~");
    expect(paddedVersionString("10.12.13")).toBe("   10-   12-   13-~");
  });

  it("strips a leading v", () => {
    expect(paddedVersionString("v1.2.3")).toBe(paddedVersionString("1.2.3"));
    // Only a single leading v is removed, and only at the start
    expect(paddedVersionString("vv1.2.3")).toBe("v1-    2-    3-~");
    expect(paddedVersionString("1.2.v3")).toBe("    1-    2-v3-~");
  });

  it("strips build metadata after the first +", () => {
    expect(paddedVersionString("1.2.3+build")).toBe(
      paddedVersionString("1.2.3"),
    );
    expect(paddedVersionString("v1.2.3+build+more.1-2")).toBe(
      paddedVersionString("1.2.3"),
    );
    expect(paddedVersionString("1.2.3+")).toBe(paddedVersionString("1.2.3"));
    expect(paddedVersionString("+build")).toBe("");
  });

  it("keeps pre-release tags, and orders them below the release", () => {
    expect(paddedVersionString("v1.2.3-rc.1+build123")).toBe(
      "    1-    2-    3-rc-    1",
    );
    expect(
      paddedVersionString("1.0.0-beta") < paddedVersionString("1.0.0"),
    ).toBe(true);
  });

  it("handles non-string input", () => {
    expect(paddedVersionString(5)).toBe("    5");
    expect(paddedVersionString(null)).toBe("    0");
    expect(paddedVersionString(undefined)).toBe("    0");
  });

  it("cuts at the first + even when a newline follows it", () => {
    expect(paddedVersionString("1.2.3+build\nmore")).toBe(
      paddedVersionString("1.2.3"),
    );
    expect(paddedVersionString("1.2.3+\n")).toBe(paddedVersionString("1.2.3"));
  });

  it("runs in linear time on many + characters", () => {
    const input = "+".repeat(200000) + "\n";
    const start = performance.now();
    paddedVersionString(input);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("version comparison operators", () => {
  it("ignore a leading v and build metadata", () => {
    expect(
      evalCondition({ v: "v1.2.3+build" }, { v: { $veq: "1.2.3" } }, {}),
    ).toBe(true);
    expect(
      evalCondition({ v: "1.2.4+build" }, { v: { $vgt: "1.2.3" } }, {}),
    ).toBe(true);
    expect(
      evalCondition({ v: "1.2.3-rc.1" }, { v: { $vlt: "1.2.3" } }, {}),
    ).toBe(true);
    expect(
      evalCondition({ v: "1.2.3+z" }, { v: { $vgt: "1.2.3+a" } }, {}),
    ).toBe(false);
  });
});

describe("trimTrailingSlashes", () => {
  it("removes all trailing slashes and nothing else", () => {
    expect(trimTrailingSlashes("https://cdn.example.com")).toBe(
      "https://cdn.example.com",
    );
    expect(trimTrailingSlashes("https://cdn.example.com/")).toBe(
      "https://cdn.example.com",
    );
    expect(trimTrailingSlashes("https://cdn.example.com/a//")).toBe(
      "https://cdn.example.com/a",
    );
    expect(trimTrailingSlashes("///")).toBe("");
    expect(trimTrailingSlashes("")).toBe("");
  });

  it("runs in linear time on long runs of slashes", () => {
    const input = "/".repeat(200000) + "x";
    const start = performance.now();
    expect(trimTrailingSlashes(input)).toBe(input);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe("getApiHosts", () => {
  it("trims trailing slashes from the API and streaming hosts", () => {
    expect(getApiHosts({ apiHost: "https://cdn.example.com//" })).toEqual(
      expect.objectContaining({
        apiHost: "https://cdn.example.com",
        streamingHost: "https://cdn.example.com",
      }),
    );
    expect(
      getApiHosts({
        apiHost: "https://cdn.example.com",
        streamingHost: "https://sse.example.com/",
      }),
    ).toEqual(
      expect.objectContaining({
        apiHost: "https://cdn.example.com",
        streamingHost: "https://sse.example.com",
      }),
    );
  });

  it("defaults to the GrowthBook CDN", () => {
    expect(getApiHosts({}).apiHost).toBe("https://cdn.growthbook.io");
  });
});
