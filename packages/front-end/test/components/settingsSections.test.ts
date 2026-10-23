import {
  matchesSettingsQuery,
  resolveSettingsHash,
  SETTINGS_SECTIONS,
  tokenizeSettingsQuery,
} from "@/components/GeneralSettings/settingsSections";

describe("resolveSettingsHash", () => {
  it("returns null for no hash", () => {
    expect(resolveSettingsHash(undefined)).toBeNull();
    expect(resolveSettingsHash("")).toBeNull();
  });

  it("maps legacy tab hashes onto section ids", () => {
    expect(resolveSettingsHash("experiment")).toBe("experiments");
    expect(resolveSettingsHash("feature")).toBe("features");
    expect(resolveSettingsHash("approval-flow")).toBe("approvals");
    expect(resolveSettingsHash("custom")).toBe("markdown");
  });

  it("keeps section ids and element ids as they are", () => {
    expect(resolveSettingsHash("metrics")).toBe("metrics");
    expect(resolveSettingsHash("configure-code-refs")).toBe(
      "configure-code-refs",
    );
  });

  it("targets the nested element of a legacy tab/section hash", () => {
    expect(resolveSettingsHash("metrics/data-source-settings")).toBe(
      "data-source-settings",
    );
  });

  it("has unique section ids", () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("settings search matching", () => {
  it("tokenizes on whitespace, lowercased", () => {
    expect(tokenizeSettingsQuery("  Sticky   Bucketing ")).toEqual([
      "sticky",
      "bucketing",
    ]);
    expect(tokenizeSettingsQuery("   ")).toEqual([]);
  });

  it("requires every token to appear", () => {
    const hay = "Sticky bucketing keeps users in their variation";
    expect(matchesSettingsQuery(hay, ["sticky", "variation"])).toBe(true);
    expect(matchesSettingsQuery(hay, ["sticky", "warehouse"])).toBe(false);
    expect(matchesSettingsQuery(hay, [])).toBe(true);
  });
});
