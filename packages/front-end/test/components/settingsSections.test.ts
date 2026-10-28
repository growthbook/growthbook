import {
  describeUnsavedChanges,
  matchesSettingsQuery,
  resolveSettingsHash,
  sameSetting,
  sectionForField,
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

describe("unsaved change tracking", () => {
  it("maps fields to the section that renders them", () => {
    expect(sectionForField("statsEngine")).toBe("statistics");
    expect(sectionForField("featureListMarkdown")).toBe("markdown");
    expect(sectionForField("not-a-field")).toBeNull();
  });

  it("describes where the unsaved changes are", () => {
    expect(describeUnsavedChanges(1, ["sdk"])).toBe(
      "1 unsaved change in SDK Configuration",
    );
    expect(describeUnsavedChanges(2, ["ai", "markdown"])).toBe(
      "2 unsaved changes in AI and Custom Markdown",
    );
    expect(describeUnsavedChanges(5, ["ai", "markdown", "sdk"])).toBe(
      "5 unsaved changes in 3 sections",
    );
  });
});

describe("sameSetting", () => {
  it("ignores unset nested keys the saved value lacks", () => {
    expect(
      sameSetting(
        { type: "stale", hours: 6, analysisEndDateLagHours: undefined },
        { type: "stale", hours: 6 },
      ),
    ).toBe(true);
    expect(sameSetting(NaN, undefined)).toBe(true);
  });

  it("still detects real changes", () => {
    expect(sameSetting({ hours: 6 }, { hours: 12 })).toBe(false);
    expect(sameSetting({ hours: 6, lag: 2 }, { hours: 6 })).toBe(false);
    expect(sameSetting(["a"], ["a", "b"])).toBe(false);
  });
});

describe("sectionForField paths", () => {
  it("maps prior settings to Statistics and other metric defaults to Metrics", () => {
    expect(sectionForField("metricDefaults.priorSettings")).toBe("statistics");
    expect(sectionForField("metricDefaults.targetMDE")).toBe("metrics");
    expect(sectionForField("displayCurrency")).toBe("metrics");
  });
});
