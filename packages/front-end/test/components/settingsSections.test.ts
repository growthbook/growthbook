import {
  isSettingsSectionId,
  parseSettingsHash,
} from "@/components/GeneralSettings/settingsSections";

describe("parseSettingsHash", () => {
  it("parses a tab and section from a composite hash", () => {
    expect(parseSettingsHash("metrics/data-source-settings")).toEqual({
      tab: "metrics",
      section: "data-source-settings",
    });
  });

  it("derives the metrics tab from the top-values-lookback section", () => {
    expect(parseSettingsHash("metrics/top-values-lookback")).toEqual({
      tab: "metrics",
      section: "top-values-lookback",
    });
  });

  it("parses a tab-only hash", () => {
    expect(parseSettingsHash("feature")).toEqual({
      tab: "feature",
      section: null,
    });
  });

  it("falls back to the default tab for an empty or unknown hash", () => {
    expect(parseSettingsHash(undefined)).toEqual({
      tab: "experiment",
      section: null,
    });
    expect(parseSettingsHash("")).toEqual({ tab: "experiment", section: null });
    expect(parseSettingsHash("not-a-tab")).toEqual({
      tab: "experiment",
      section: null,
    });
  });

  it("ignores an unknown section segment", () => {
    expect(parseSettingsHash("metrics/not-a-section")).toEqual({
      tab: "metrics",
      section: null,
    });
  });
});

describe("isSettingsSectionId", () => {
  it("accepts registered section ids", () => {
    expect(isSettingsSectionId("data-source-settings")).toBe(true);
  });

  it("rejects unregistered values", () => {
    expect(isSettingsSectionId("not-a-section")).toBe(false);
    expect(isSettingsSectionId("")).toBe(false);
  });
});
