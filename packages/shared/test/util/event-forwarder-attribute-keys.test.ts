import { resolveEventForwarderAttributeLookupKeys } from "../../src/util/event-forwarder-attribute-keys";

describe("resolveEventForwarderAttributeLookupKeys", () => {
  it("maps promoted UTM attributes to snake_case warehouse keys", () => {
    expect(resolveEventForwarderAttributeLookupKeys("utmSource")).toEqual([
      "utm_source",
    ]);
    expect(resolveEventForwarderAttributeLookupKeys("utmMedium")).toEqual([
      "utm_medium",
    ]);
  });

  it("prefers enriched keys with SDK fallbacks for browser and URL fields", () => {
    expect(resolveEventForwarderAttributeLookupKeys("browser")).toEqual([
      "ua_browser",
      "browser",
    ]);
    expect(resolveEventForwarderAttributeLookupKeys("path")).toEqual([
      "url_path",
      "path",
    ]);
    expect(resolveEventForwarderAttributeLookupKeys("query")).toEqual([
      "url_query",
      "query",
    ]);
  });

  it("is case-insensitive for known mappings", () => {
    expect(resolveEventForwarderAttributeLookupKeys("UTMSource")).toEqual([
      "utm_source",
    ]);
    expect(resolveEventForwarderAttributeLookupKeys("Browser")).toEqual([
      "ua_browser",
      "browser",
    ]);
  });

  it("sanitizes custom attribute properties", () => {
    expect(resolveEventForwarderAttributeLookupKeys("logged-in")).toEqual([
      "logged_in",
    ]);
    expect(resolveEventForwarderAttributeLookupKeys("company")).toEqual([
      "company",
    ]);
  });
});
