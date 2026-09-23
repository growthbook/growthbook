import {
  docTitleForSection,
  getDocSectionsForCommandPalette,
} from "@/components/DocLink";
import { getApiReferencePaletteRows } from "@/components/CommandPalette/apiReferencePalette";

describe("docTitleForSection", () => {
  it("preserves acronyms in generated titles for affected documentation keys", () => {
    expect(docTitleForSection("api")).toBe("API");
    expect(docTitleForSection("sdkWebhooks")).toBe("SDK Webhooks");
    expect(docTitleForSection("encryptedSDKEndpoints")).toBe(
      "Encrypted SDK Endpoints",
    );
    expect(docTitleForSection("apiPostEnvironment")).toBe(
      "API Post Environment",
    );
    expect(docTitleForSection("gtmSetup")).toBe("GTM Setup");
    expect(docTitleForSection("gtmCustomTracking")).toBe("GTM Custom Tracking");
    expect(docTitleForSection("url_redirects")).toBe("URL Redirects");
    expect(docTitleForSection("hashSecureAttributes")).toBe(
      "Hash Secure Attributes",
    );
  });

  it("keeps display-title overrides unchanged", () => {
    expect(docTitleForSection("javascript")).toBe("JavaScript SDK");
  });
});

describe("getDocSectionsForCommandPalette", () => {
  it("exposes corrected acronym titles in palette rows", () => {
    const rows = getDocSectionsForCommandPalette();
    const titleBySection = new Map(rows.map((r) => [r.section, r.title]));

    expect(titleBySection.get("api")).toBe("API");
    expect(titleBySection.get("sdkWebhooks")).toBe("SDK Webhooks");
    expect(titleBySection.get("encryptedSDKEndpoints")).toBe(
      "Encrypted SDK Endpoints",
    );
    expect(titleBySection.get("apiPostEnvironment")).toBe(
      "API Post Environment",
    );
    expect(titleBySection.get("gtmSetup")).toBe("GTM Setup");
    expect(titleBySection.get("gtmCustomTracking")).toBe("GTM Custom Tracking");
    expect(titleBySection.get("url_redirects")).toBe("URL Redirects");
    expect(titleBySection.get("hashSecureAttributes")).toBe(
      "Hash Secure Attributes",
    );
  });
});

describe("Cmd+K docs and API reference rows", () => {
  it("lists each API reference resource once, as an API reference row", () => {
    const apiRows = getApiReferencePaletteRows();
    const apiUrls = apiRows.map((r) => r.url);
    const docUrls = new Set(
      getDocSectionsForCommandPalette().map((r) => r.url),
    );

    expect(new Set(apiUrls).size).toBe(apiUrls.length);
    // The overview row shares its URL with the `apiIntroduction` docs row.
    expect(apiRows.slice(1).filter((r) => docUrls.has(r.url))).toEqual([]);
    expect(apiRows.slice(1).every((r) => !r.url.includes("#"))).toBe(true);
  });
});
