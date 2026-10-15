import { stringToBoolean } from "../../src/util";
import { normalizeChecklistTaskUrl } from "../../src/util/strings";

describe("stringToBoolean", () => {
  it("should return true for truthy string values", () => {
    expect(stringToBoolean("true")).toBe(true);
    expect(stringToBoolean("yes")).toBe(true);
    expect(stringToBoolean("on")).toBe(true);
    expect(stringToBoolean("1")).toBe(true);
  });

  it("should return false for falsy string values", () => {
    expect(stringToBoolean("false")).toBe(false);
    expect(stringToBoolean("no")).toBe(false);
    expect(stringToBoolean("off")).toBe(false);
    expect(stringToBoolean("0")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(stringToBoolean("", false)).toBe(false);
    expect(stringToBoolean("", true)).toBe(false);
  });

  it("should return the default value for undefined", () => {
    expect(stringToBoolean(undefined, false)).toBe(false);
    expect(stringToBoolean(undefined, true)).toBe(true);
  });

  it("should return the default value for invalid string values", () => {
    expect(stringToBoolean("foo", true)).toBe(true);
    expect(stringToBoolean("bar", false)).toBe(false);
  });

  it("should have a default value of false if not specified", () => {
    expect(stringToBoolean("foo")).toBe(false);
  });
});

describe("normalizeChecklistTaskUrl", () => {
  it("preserves the original casing of the URL (regression for #6237)", () => {
    const url = "https://www.google.com/search?q=GrowthBook";
    expect(normalizeChecklistTaskUrl(url)).toBe(url);
  });

  it("preserves casing for a case-sensitive Google Drive style link", () => {
    const url = "https://drive.google.com/file/d/AbCdEf_123-XYZ/view";
    expect(normalizeChecklistTaskUrl(url)).toBe(url);
  });

  it("prefixes https:// when no scheme is present, keeping case", () => {
    const result = normalizeChecklistTaskUrl("example.com/MyPath");
    expect(result).toBe("https://example.com/MyPath");
  });

  it("lowercases an existing scheme while preserving the rest of the URL", () => {
    const upper = normalizeChecklistTaskUrl("HTTP://Example.com/A");
    expect(upper).toBe("http://Example.com/A");
    const mixed = normalizeChecklistTaskUrl("Https://Example.com/B");
    expect(mixed).toBe("https://Example.com/B");
  });
});
