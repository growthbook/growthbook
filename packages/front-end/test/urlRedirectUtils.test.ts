import { validateUrl } from "@/services/url-redirect-utils";

describe("validateUrl", () => {
  it.each([
    "https://example.com",
    "https://example.com/pricing",
    "https://example.com/pricing?plan=pro",
    "http://example.com/path/to/page",
  ])("accepts a valid simple URL: %s", (url) => {
    expect(validateUrl(url)).toEqual({ isValid: true });
  });

  it.each([
    "https://example.com/pricing.+",
    "https://example.com/(about|pricing)",
    "https://example.com/$metadata",
  ])("does not mistake URL characters for regex syntax: %s", (url) => {
    expect(validateUrl(url)).toEqual({ isValid: true });
  });

  it.each(["https://example.com/path/*", "https://example.com/.*"])(
    "rejects an unsupported wildcard pattern: %s",
    (url) => {
      expect(validateUrl(url)).toEqual({
        isValid: false,
        message:
          "Regex URL patterns are not supported for URL Redirect experiments. Use Feature Flags for regex targeting.",
      });
    },
  );

  it("rejects a URL without a protocol", () => {
    expect(validateUrl("example.com/pricing")).toEqual({
      isValid: false,
      message:
        'Incomplete URL. Specify a valid URL starting with "http:// or "https://"',
    });
  });

  it("rejects an unsupported protocol", () => {
    expect(validateUrl("ftp://example.com/pricing")).toEqual({
      isValid: false,
      message:
        'Incomplete URL. Specify a valid URL starting with "http:// or "https://"',
    });
  });

  it("rejects a malformed URL", () => {
    expect(validateUrl("https://")).toEqual({
      isValid: false,
      message: "Invalid URL",
    });
  });
});
