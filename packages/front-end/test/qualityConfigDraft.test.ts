import { getChecksForSection } from "shared/enterprise";
import {
  QualityConfigDraft,
  addCustomCheck,
  configToDraft,
  draftToConfig,
  getEnabledSectionKeys,
  isDegenerateDraft,
  reflowSectionWeights,
  removeCustomCheck,
  updateCheck,
  updateCustomCheck,
} from "@/components/Settings/ExperimentQuality/qualityConfigDraft";

const sectionTotal = (draft: QualityConfigDraft) =>
  getEnabledSectionKeys(draft).reduce(
    (sum, key) => sum + draft.sections[key].weight,
    0,
  );

describe("qualityConfigDraft", () => {
  it("round-trips a saved configuration unchanged", () => {
    const draft = configToDraft({
      sections: { setup: { weight: 50 }, process: { enabled: false } },
      checks: {
        "goal-metrics": { enabled: true, params: { maxGoalMetrics: 5 } },
        screenshots: { enabled: true },
      },
    });
    expect(configToDraft(draftToConfig(draft))).toEqual(draft);
    expect(sectionTotal(draft)).toBe(100);
  });

  it("keeps a section dragged to 0% at zero after saving", () => {
    const draft = reflowSectionWeights(configToDraft(null), "documentation", 0);
    expect(draft.sections.documentation.weight).toBe(0);
    expect(sectionTotal(draft)).toBe(100);
    const reloaded = configToDraft(draftToConfig(draft));
    expect(reloaded.sections.documentation.weight).toBe(0);
  });

  it("drops a section from the split when its last check is turned off", () => {
    let draft = configToDraft(null);
    for (const key of getChecksForSection("documentation")) {
      draft = updateCheck(draft, key, { enabled: false });
    }
    expect(getEnabledSectionKeys(draft)).not.toContain("documentation");
    expect(sectionTotal(draft)).toBe(100);
  });

  it("refuses to save when no check would count", () => {
    let draft = configToDraft({ aiChecksEnabled: false });
    for (const section of ["setup", "process", "documentation"] as const) {
      for (const key of getChecksForSection(section)) {
        draft = updateCheck(draft, key, { enabled: false });
      }
    }
    expect(isDegenerateDraft(draft)).toBe(true);
  });

  it("adds, edits and removes custom checks", () => {
    let draft = addCustomCheck(configToDraft(null));
    const [custom] = draft.customAiChecks;
    expect(custom.enabled).toBe(true);

    draft = updateCustomCheck(draft, custom.id, {
      rule: "Fewer than 20 metrics",
    });
    // An unnamed check is saved with a placeholder name
    expect(draftToConfig(draft).customAiChecks).toEqual([
      expect.objectContaining({
        id: custom.id,
        name: "Custom check",
        rule: "Fewer than 20 metrics",
      }),
    ]);

    draft = removeCustomCheck(draft, custom.id);
    expect(draftToConfig(draft).customAiChecks).toEqual([]);
  });
});
