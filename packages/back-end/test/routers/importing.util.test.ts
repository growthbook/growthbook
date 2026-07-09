import { resolveProxyUrl } from "back-end/src/routers/importing/importing.util";

const STATSIG_BASE = "https://statsigapi.net/console/v1/";
const LAUNCHDARKLY_BASE = "https://app.launchdarkly.com";

describe("resolveProxyUrl", () => {
  describe("Statsig base (with path prefix)", () => {
    it.each([
      ["gates", "https://statsigapi.net/console/v1/gates"],
      ["metrics/list", "https://statsigapi.net/console/v1/metrics/list"],
      [
        "metrics/metric_source/list",
        "https://statsigapi.net/console/v1/metrics/metric_source/list",
      ],
      [
        "experiments?page=2",
        "https://statsigapi.net/console/v1/experiments?page=2",
      ],
    ])("resolves legitimate segment %p", (input, expected) => {
      expect(resolveProxyUrl(input, STATSIG_BASE)).toBe(expected);
    });

    it.each([
      // Leading slashes are stripped and treated as relative to the base path
      ["/foo", "https://statsigapi.net/console/v1/foo"],
      ["/metrics/list", "https://statsigapi.net/console/v1/metrics/list"],
      // Protocol-relative authority injection is neutralized to a same-host path
      ["//evil.com", "https://statsigapi.net/console/v1/evil.com"],
      // "@" stays a path segment, not userinfo
      ["@evil.com", "https://statsigapi.net/console/v1/@evil.com"],
    ])("neutralizes %p to stay on host/path", (input, expected) => {
      expect(resolveProxyUrl(input, STATSIG_BASE)).toBe(expected);
    });

    it.each([
      ["../foo"], // escapes the base path
      ["../../secrets"],
      ["https://evil.com"], // absolute URL to another host
      ["https://evil.com/console/v1/x"],
    ])("rejects %p", (input) => {
      expect(() => resolveProxyUrl(input, STATSIG_BASE)).toThrow(
        "Invalid request URL.",
      );
    });
  });

  describe("LaunchDarkly base (no path prefix)", () => {
    it.each([
      [
        "/api/v2/projects?limit=300",
        "https://app.launchdarkly.com/api/v2/projects?limit=300",
      ],
      [
        "/api/v2/flags/x?summary=true",
        "https://app.launchdarkly.com/api/v2/flags/x?summary=true",
      ],
      ["api/v2/x", "https://app.launchdarkly.com/api/v2/x"],
    ])("resolves legitimate path %p", (input, expected) => {
      expect(resolveProxyUrl(input, LAUNCHDARKLY_BASE)).toBe(expected);
    });

    it.each([
      ["//evil.com", "https://app.launchdarkly.com/evil.com"],
      ["@evil.com/x", "https://app.launchdarkly.com/@evil.com/x"],
    ])("neutralizes %p to stay on host", (input, expected) => {
      expect(resolveProxyUrl(input, LAUNCHDARKLY_BASE)).toBe(expected);
    });

    it.each([["https://evil.com"], ["https://evil.com/api/v2/x"]])(
      "rejects %p",
      (input) => {
        expect(() => resolveProxyUrl(input, LAUNCHDARKLY_BASE)).toThrow(
          "Invalid request URL.",
        );
      },
    );
  });
});
