import { normalizeChecklistTaskUrl } from "@/components/Settings/NewExperimentChecklistItem";

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
