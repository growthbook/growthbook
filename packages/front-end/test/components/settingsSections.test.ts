import {
  describeUnsavedChanges,
  matchesSettingsQuery,
  resolveSettingsHash,
  sameSetting,
  sectionForField,
  settingPaths,
  SETTINGS_SECTIONS,
  tokenizeSettingsQuery,
  parseBranches,
  toPercent,
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

  it("treats empty and missing values alike", () => {
    expect(sameSetting("", undefined)).toBe(true);
    expect(sameSetting(null, "")).toBe(true);
    expect(sameSetting({ a: "" }, {})).toBe(true);
  });

  it("counts false and 0 as real values", () => {
    expect(sameSetting(true, undefined)).toBe(false);
    expect(sameSetting(false, undefined)).toBe(false);
    expect(sameSetting(0, undefined)).toBe(false);
    expect(sameSetting({ on: false }, {})).toBe(false);
  });

  it("detects nested metric default edits", () => {
    const saved = { targetMDE: 10, priorSettings: { mean: 0, stddev: 0.3 } };
    expect(sameSetting({ ...saved }, saved)).toBe(true);
    expect(sameSetting({ ...saved, targetMDE: 11 }, saved)).toBe(false);
    expect(
      sameSetting(
        { ...saved, priorSettings: { mean: 0.1, stddev: 0.3 } },
        saved,
      ),
    ).toBe(false);
  });

  it("compares arrays in order, including objects inside them", () => {
    expect(sameSetting(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameSetting([{ id: 1, note: "" }], [{ id: 1 }])).toBe(true);
    expect(sameSetting([{ id: 1, on: true }], [{ id: 1 }])).toBe(false);
  });
});

describe("parseBranches", () => {
  it("splits on commas and trims each name", () => {
    expect(parseBranches("main, qa ,dev")).toEqual(["main", "qa", "dev"]);
  });

  it("drops empty entries, including a trailing comma", () => {
    expect(parseBranches("main,, qa,")).toEqual(["main", "qa"]);
    expect(parseBranches(" , ")).toEqual([]);
    expect(parseBranches("")).toEqual([]);
  });
});

describe("settingPaths", () => {
  it("expands split settings into child paths and leaves the rest alone", () => {
    expect(
      settingPaths({
        metricDefaults: { targetMDE: 10, minimumSampleSize: 150 },
        northStar: { title: "" },
        confidenceLevel: 95,
      }),
    ).toEqual([
      "metricDefaults.targetMDE",
      "metricDefaults.minimumSampleSize",
      "northStar",
      "confidenceLevel",
    ]);
    expect(settingPaths({ metricDefaults: undefined })).toEqual([
      "metricDefaults",
    ]);
  });
});

describe("toPercent", () => {
  it("drops float noise from fraction to percent", () => {
    expect(toPercent(0.07)).toBe(7);
    expect(toPercent(0.29)).toBe(29);
    expect(toPercent(0.955)).toBe(95.5);
    expect(toPercent(0.0001)).toBe(0.01);
  });
});

describe("sectionForField paths", () => {
  it("maps prior settings to Statistics and other metric defaults to Metrics", () => {
    expect(sectionForField("metricDefaults.priorSettings")).toBe("statistics");
    expect(sectionForField("metricDefaults.targetMDE")).toBe("metrics");
    expect(sectionForField("displayCurrency")).toBe("metrics");
  });
});
