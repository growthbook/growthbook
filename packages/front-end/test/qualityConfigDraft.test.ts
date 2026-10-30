import { getChecksForSection } from "shared/enterprise";
import {
  QualityConfigDraft,
  addCustomCheck,
  configToDraft,
  draftToConfig,
  getEnabledSectionKeys,
  isDegenerateDraft,
  isSectionChanged,
  moveSectionDivider,
  resetSection,
  setSectionWeight,
  removeCustomCheck,
  setCustomCheckJudge,
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
    const draft = setSectionWeight(configToDraft(null), "documentation", 0);
    expect(draft.sections.documentation.weight).toBe(0);
    expect(sectionTotal(draft)).toBe(100);
    const reloaded = configToDraft(draftToConfig(draft));
    expect(reloaded.sections.documentation.weight).toBe(0);
  });

  it("splits equally when every remaining section is at 0%", () => {
    let draft = setSectionWeight(configToDraft(null), "ai", 100);
    draft = updateCheck(draft, "ai-hypothesis-quality", { enabled: false });
    draft = updateCheck(draft, "ai-hypothesis-metric-alignment", {
      enabled: false,
    });
    const enabled = getEnabledSectionKeys(draft);
    expect(enabled).not.toContain("ai");
    for (const key of enabled) {
      expect(
        Math.abs(draft.sections[key].weight - 100 / enabled.length),
      ).toBeLessThanOrEqual(1);
    }
    expect(sectionTotal(draft)).toBe(100);
  });

  it("moves only the sections either side of a divider", () => {
    const start = configToDraft(null);
    const [first, second, third] = getEnabledSectionKeys(start);
    const draft = moveSectionDivider(
      start,
      0,
      start.sections[first].weight + 10,
    );
    expect(draft.sections[first].weight).toBe(
      start.sections[first].weight + 10,
    );
    expect(draft.sections[second].weight).toBe(
      start.sections[second].weight - 10,
    );
    expect(draft.sections[third]).toEqual(start.sections[third]);
    expect(sectionTotal(draft)).toBe(100);
  });

  it("resets one section to the organization default", () => {
    const base = configToDraft(null);
    let draft = updateCheck(base, "planned-end", { enabled: true });
    draft = updateCheck(draft, "screenshots", { enabled: true });
    expect(isSectionChanged(draft, base, "process")).toBe(true);
    draft = resetSection(draft, base, "process");
    expect(isSectionChanged(draft, base, "process")).toBe(false);
    expect(isSectionChanged(draft, base, "documentation")).toBe(true);
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

  it("keeps a judge until its rule changes, unless an admin chose it", () => {
    const saved = configToDraft({
      customAiChecks: [
        {
          id: "a",
          name: "A",
          rule: "Names a segment",
          judge: "decision",
          judgeChosenBy: "auto",
        },
      ],
    });
    expect(configToDraft(draftToConfig(saved))).toEqual(saved);

    const renamed = updateCustomCheck(saved, "a", { name: "B" });
    expect(renamed.customAiChecks[0].judge).toBe("decision");
    const rewritten = updateCustomCheck(saved, "a", { rule: "Other" });
    expect(draftToConfig(rewritten).customAiChecks?.[0]).not.toHaveProperty(
      "judge",
    );

    const chosen = setCustomCheckJudge(saved, "a", "llm");
    expect(
      updateCustomCheck(chosen, "a", { rule: "Other" }).customAiChecks[0],
    ).toMatchObject({ judge: "llm", judgeChosenBy: "admin" });
    expect(
      setCustomCheckJudge(chosen, "a", null).customAiChecks[0].judge,
    ).toBeUndefined();
  });
});
