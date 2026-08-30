import {
  docTitleForSection,
  getDocSectionsForCommandPalette,
} from "@/components/DocLink";

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
