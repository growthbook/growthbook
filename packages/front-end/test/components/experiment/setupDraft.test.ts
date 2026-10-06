import {
  buildSavePayload,
  changedFields,
  draftFromExperiment,
  rebaseDraft,
} from "@/components/Experiment/TabbedPage/SetupPage/setupDraft";

const experiment = {
  hypothesis: "Faster checkout converts better",
  goalMetrics: ["met_a"],
  secondaryMetrics: [],
  guardrailMetrics: ["met_g"],
  statusUpdateSchedule: undefined,
  decisionFrameworkSettings: { decisionCriteriaId: "gbdeccrit_x" },
};

describe("setupDraft", () => {
  it("seeds a clean draft from the experiment", () => {
    const base = draftFromExperiment(experiment);
    expect(changedFields(base, draftFromExperiment(experiment))).toEqual([]);
    expect(base.startMode).toBe("manual");
    expect(base.decisionCriteriaId).toBe("gbdeccrit_x");
  });

  it("sends only backed fields that changed", () => {
    const base = draftFromExperiment(experiment);
    const draft = {
      ...base,
      hypothesis: "New",
      goalMetrics: ["met_a", "met_b"],
    };
    expect(buildSavePayload(base, draft, undefined)).toEqual({
      hypothesis: "New",
      goalMetrics: ["met_a", "met_b"],
    });
  });

  it("never sends stubbed fields", () => {
    const base = draftFromExperiment(experiment);
    const draft = {
      ...base,
      endMode: "stopped" as const,
      atEnd: "ship-winner" as const,
    };
    expect(changedFields(base, draft)).toEqual(["endMode", "atEnd"]);
    expect(buildSavePayload(base, draft, undefined)).toEqual({});
  });

  it("seeds coverage from the latest phase and sends it when changed", () => {
    const withPhases = {
      ...experiment,
      phases: [{ coverage: 0.5 }, { coverage: 0.8 }],
    } as unknown as Parameters<typeof draftFromExperiment>[0];
    const base = draftFromExperiment(withPhases);
    expect(base.coverage).toBe(0.8);
    expect(draftFromExperiment(experiment).coverage).toBe(1);
    expect(buildSavePayload(base, { ...base, coverage: 0.25 })).toEqual({
      coverage: 0.25,
    });
  });

  it("treats metric reordering as a change", () => {
    const base = {
      ...draftFromExperiment(experiment),
      goalMetrics: ["a", "b"],
    };
    const draft = { ...base, goalMetrics: ["b", "a"] };
    expect(changedFields(base, draft)).toEqual(["goalMetrics"]);
  });

  it("sends a schedule for a dated start and clears it otherwise", () => {
    const base = draftFromExperiment(experiment);
    const dated = {
      ...base,
      startMode: "date" as const,
      startAt: "2026-09-16T07:00:00.000Z",
    };
    expect(buildSavePayload(base, dated, undefined)).toEqual({
      statusUpdateSchedule: { startAt: "2026-09-16T07:00:00.000Z" },
    });
    // "On date" with no date picked is not a schedule.
    const noDate = { ...base, startMode: "date" as const, startAt: null };
    expect(buildSavePayload(base, noDate, undefined)).toEqual({
      statusUpdateSchedule: null,
    });
  });

  it("keeps existing decision framework settings when changing criteria", () => {
    const base = draftFromExperiment(experiment);
    const draft = { ...base, decisionCriteriaId: "gbdeccrit_y" };
    const existing = {
      decisionCriteriaId: "gbdeccrit_x",
      decisionFrameworkMetricOverrides: [{ id: "met_a", targetMDE: 0.1 }],
    };
    expect(buildSavePayload(base, draft, existing)).toEqual({
      decisionFrameworkSettings: {
        decisionCriteriaId: "gbdeccrit_y",
        decisionFrameworkMetricOverrides: [{ id: "met_a", targetMDE: 0.1 }],
      },
    });
  });

  it("rebases: keeps unsaved edits, takes the new baseline elsewhere", () => {
    const oldBase = draftFromExperiment(experiment);
    const draft = { ...oldBase, hypothesis: "Unsaved edit" };
    const newBase = { ...oldBase, guardrailMetrics: ["met_g", "met_h"] };
    const rebased = rebaseDraft(oldBase, newBase, draft);
    expect(rebased.hypothesis).toBe("Unsaved edit");
    expect(rebased.guardrailMetrics).toEqual(["met_g", "met_h"]);
  });

  describe("stats settings", () => {
    const defaults = { enabled: true, tuningParameter: 5000 };

    it("reads sequential values matching the org default as Default", () => {
      const base = draftFromExperiment(
        {
          ...experiment,
          sequentialTestingEnabled: true,
          sequentialTestingTuningParameter: 5000,
        },
        defaults,
      );
      expect(base.sequentialMode).toBe("default");
    });

    it("reads a differing sequential value as an explicit choice", () => {
      const base = draftFromExperiment(
        { ...experiment, sequentialTestingEnabled: false },
        defaults,
      );
      expect(base.sequentialMode).toBe("off");
    });

    it("sends the org's values when switched to Default", () => {
      const base = draftFromExperiment(
        { ...experiment, sequentialTestingEnabled: false },
        defaults,
      );
      const draft = { ...base, sequentialMode: "default" as const };
      expect(buildSavePayload(base, draft, undefined, defaults)).toEqual({
        sequentialTestingEnabled: true,
        sequentialTestingTuningParameter: 5000,
      });
    });

    it("sends an explicit sequential choice with its tuning parameter", () => {
      const base = draftFromExperiment(experiment, defaults);
      const draft = {
        ...base,
        sequentialMode: "on" as const,
        sequentialTuningParameter: 1000,
      };
      expect(buildSavePayload(base, draft, undefined, defaults)).toEqual({
        sequentialTestingEnabled: true,
        sequentialTestingTuningParameter: 1000,
      });
    });

    it("sends engine, CUPED and post-stratification only when changed", () => {
      const base = draftFromExperiment(experiment, defaults);
      const draft = {
        ...base,
        statsEngine: "frequentist" as const,
        postStratificationEnabled: true,
      };
      expect(buildSavePayload(base, draft, undefined, defaults)).toEqual({
        statsEngine: "frequentist",
        postStratificationEnabled: true,
      });
    });

    it("sends an empty engine to reset it to the default", () => {
      const base = draftFromExperiment(
        { ...experiment, statsEngine: "bayesian" },
        defaults,
      );
      const draft = { ...base, statsEngine: "" as const };
      expect(buildSavePayload(base, draft, undefined, defaults)).toEqual({
        statsEngine: "",
      });
    });
  });

  it("treats the same tags in another order as unchanged", () => {
    const base = { ...draftFromExperiment(experiment), tags: ["a", "b"] };
    expect(changedFields(base, { ...base, tags: ["b", "a"] })).toEqual([]);
    expect(changedFields(base, { ...base, tags: ["a"] })).toEqual(["tags"]);
  });

  it("sends the rail's changed fields, never the type or the resets", () => {
    const base = draftFromExperiment(experiment);
    const draft = {
      ...base,
      description: "New description",
      project: "prj_1",
      datasource: "ds_1",
      exposureQueryId: "user_id",
      deliveryType: "feature-flag" as const,
      dataSourceResets: { segment: "" },
    };
    expect(buildSavePayload(base, draft)).toEqual({
      description: "New description",
      project: "prj_1",
      datasource: "ds_1",
      exposureQueryId: "user_id",
    });
  });
});
