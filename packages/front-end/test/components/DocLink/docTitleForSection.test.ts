import {
  docTitleForSection,
  getDocSectionsForCommandPalette,
} from "@/components/DocLink";

describe("docTitleForSection", () => {
  it("title-cases a simple key", () => {
    expect(docTitleForSection("home")).toBe("Home");
  });

  it("splits camelCase", () => {
    expect(docTitleForSection("experimentConfiguration")).toBe(
      "Experiment Configuration",
    );
  });

  it("splits snake_case", () => {
    expect(docTitleForSection("google_analytics")).toBe("Google Analytics");
  });

  it("handles hash segments in keys", () => {
    expect(docTitleForSection("sdkWebhooks#payload-format")).toBe(
      "Sdk Webhooks Payload Format",
    );
  });
});

describe("getDocSectionsForCommandPalette", () => {
  it("returns one row per doc section with https docs URLs", () => {
    const rows = getDocSectionsForCommandPalette();
    expect(rows.length).toBeGreaterThan(10);
    const home = rows.find((r) => r.section === "home");
    expect(home).toBeDefined();
    expect(home?.title).toBe("Home");
    expect(home?.url).toBe("https://docs.growthbook.io");
    expect(home?.tags).toContain("home");
    expect(home?.tags).toContain("documentation");
    const bigquery = rows.find((r) => r.section === "bigquery");
    expect(bigquery?.url).toBe("https://docs.growthbook.io/guide/bigquery");
  });
});
