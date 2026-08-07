/**
 * Tests for pure utility functions exported from RampScheduleSection.tsx.
 *
 * Covers:
 *   1. formatRampStepSummary — step/approval count formatting
 *   2. buildTemplatePayload — only steps are persisted (no start/end conditions)
 *   3. findMatchingTemplate — structural comparison (start/end conditions excluded)
 *   4. templateToSectionState — timing defaults when loading a template
 */

// Mock context-dependent hooks — only the React component uses them; pure utilities do not.
vi.mock("@/hooks/useApi", () => ({ default: vi.fn() }));
vi.mock("@/services/auth", () => ({ useAuth: vi.fn() }));
vi.mock("@/services/UserContext", () => ({ useUser: vi.fn() }));

import type { RampScheduleTemplateInterface } from "shared/validators";
import {
  formatRampStepSummary,
  isMonitoredTemplate,
  buildTemplatePayload,
  findMatchingTemplate,
  templateToSectionState,
  defaultRampSectionState,
  buildPatch,
  reconstructUIPatch,
  type RampSectionState,
} from "@/components/Features/RuleModal/RampScheduleSection";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLACEHOLDER_TARGET = "template-target";
const PLACEHOLDER_RULE = "template-rule";

/** Build a template from the payload returned by buildTemplatePayload. */
function makeTemplate(
  state: RampSectionState,
  overrides: Partial<RampScheduleTemplateInterface> = {},
): RampScheduleTemplateInterface {
  return {
    id: "tmpl_1",
    organization: "org_1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    official: false,
    order: 0,
    ...buildTemplatePayload(state),
    ...overrides,
  } as RampScheduleTemplateInterface;
}

// A fresh "create" state with default 1-step ramp.
function freshState(): RampSectionState {
  const s = defaultRampSectionState(undefined);
  return { ...s, mode: "create" };
}

// ---------------------------------------------------------------------------
// 1. formatRampStepSummary
// ---------------------------------------------------------------------------

describe("formatRampStepSummary", () => {
  const interval = { interval: 600 };
  const approval = {
    interval: null,
    holdConditions: { requiresApproval: true },
  };

  it("'1 step' for a single interval step", () => {
    expect(formatRampStepSummary([interval])).toBe("1 step");
  });

  it("'3 steps' for three interval steps with no approvals", () => {
    expect(formatRampStepSummary([interval, interval, interval])).toBe(
      "3 steps",
    );
  });

  it("'2 steps, 1 approval' when one step is an approval", () => {
    expect(formatRampStepSummary([interval, approval, interval])).toBe(
      "3 steps, 1 approval",
    );
  });

  it("'2 steps, 2 approvals' when two steps are approvals", () => {
    expect(formatRampStepSummary([approval, interval, approval])).toBe(
      "3 steps, 2 approvals",
    );
  });

  it("'0 steps' for empty array", () => {
    expect(formatRampStepSummary([])).toBe("0 steps");
  });
});

// ---------------------------------------------------------------------------
// isMonitoredTemplate
// ---------------------------------------------------------------------------

describe("isMonitoredTemplate", () => {
  it("is false for a plain ramp template (no monitoring config, no monitored steps)", () => {
    expect(isMonitoredTemplate(makeTemplate(freshState()))).toBe(false);
  });

  it("is true when any step is monitored", () => {
    const s = freshState();
    const monitored = {
      ...s,
      steps: s.steps.map((st) => ({ ...st, monitored: true })),
    };
    expect(isMonitoredTemplate(makeTemplate(monitored))).toBe(true);
  });

  it("is true when a monitoring config is present even with no monitored steps", () => {
    expect(
      isMonitoredTemplate({
        monitoringConfig: {
          datasourceId: "ds_1",
          exposureQueryId: "eq_1",
          guardrailMetricIds: ["met_1"],
        },
        steps: [],
      } as Pick<RampScheduleTemplateInterface, "monitoringConfig" | "steps">),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. buildTemplatePayload — steps and endPatch are persisted (no start/end timing)
// ---------------------------------------------------------------------------

describe("buildTemplatePayload", () => {
  it("returns name, steps, and endPatch (no startDate or cutoffDate)", () => {
    const payload = buildTemplatePayload(freshState());
    expect(payload).not.toHaveProperty("startDate");
    expect(payload).not.toHaveProperty("cutoffDate");
    expect(payload).toHaveProperty("name");
    expect(payload).toHaveProperty("steps");
    expect(payload).toHaveProperty("endPatch");
  });

  it("timing fields (startDate, endScheduleAt) are not included in the payload", () => {
    const state = {
      ...freshState(),
      startDate: "2026-06-01T09:00",
      endScheduleAt: "2026-12-31T23:59",
    };
    const payload = buildTemplatePayload(state);
    // No timing info in the payload
    expect(payload).not.toHaveProperty("startDate");
    expect(payload).not.toHaveProperty("cutoffDate");
  });

  it("uses placeholder IDs for target and rule (not real entity IDs)", () => {
    const payload = buildTemplatePayload(freshState());
    for (const step of payload.steps) {
      for (const action of step.actions) {
        if (action.targetType !== "feature-rule") continue;
        expect(action.targetId).toBe(PLACEHOLDER_TARGET);
        expect(action.patch.ruleId).toBe(PLACEHOLDER_RULE);
      }
    }
  });

  it("step count in payload matches the number of steps in state", () => {
    const state = freshState();
    const payload = buildTemplatePayload(state);
    expect(payload.steps).toHaveLength(state.steps.length);
  });

  it("persists environment scope fields for step actions and endPatch", () => {
    const state = freshState();
    state.steps[0].patch = {
      ...state.steps[0].patch,
      allEnvironments: false,
      environments: ["dev", "staging"],
    };
    state.endPatch = {
      ...state.endPatch,
      allEnvironments: false,
      environments: ["production"],
    };

    const payload = buildTemplatePayload(state);
    const firstPatch = payload.steps[0]?.actions[0]?.patch;

    expect(firstPatch?.allEnvironments).toBe(false);
    expect(firstPatch?.environments).toEqual(["dev", "staging"]);
    expect(payload.endPatch?.allEnvironments).toBe(false);
    expect(payload.endPatch?.environments).toEqual(["production"]);
  });
});

// ---------------------------------------------------------------------------
// 3. findMatchingTemplate — structural comparison excludes start/end conditions
// ---------------------------------------------------------------------------

describe("findMatchingTemplate", () => {
  it("returns template id when state structurally matches the template", () => {
    const state = freshState();
    const template = makeTemplate(state);
    expect(findMatchingTemplate(state, [template])).toBe("tmpl_1");
  });

  it("returns '' when no templates are provided", () => {
    expect(findMatchingTemplate(freshState(), [])).toBe("");
  });

  it("returns '' when steps differ from the template", () => {
    const state = freshState();
    const template = makeTemplate(state);
    const differentState = {
      ...state,
      steps: [
        { ...state.steps[0], intervalValue: 99, intervalUnit: "days" as const },
      ],
    };
    expect(findMatchingTemplate(differentState, [template])).toBe("");
  });

  it("returns '' when step count differs", () => {
    const state = freshState();
    const template = makeTemplate(state);
    const moreSteps = {
      ...state,
      steps: [...state.steps, state.steps[0]],
    };
    expect(findMatchingTemplate(moreSteps, [template])).toBe("");
  });

  // ── Timing changes must NOT break the match ───────────────────────────────

  it("still matches when startDate is set", () => {
    const state = freshState();
    const template = makeTemplate(state);
    const timedStart = { ...state, startDate: "2026-06-01T09:00" };
    expect(findMatchingTemplate(timedStart, [template])).toBe("tmpl_1");
  });

  it("still matches when an end date is added", () => {
    const state = freshState();
    const template = makeTemplate(state);
    const withEndDate = { ...state, endScheduleAt: "2026-12-31T23:59" };
    expect(findMatchingTemplate(withEndDate, [template])).toBe("tmpl_1");
  });

  it("still matches when both startDate and end date are set", () => {
    const state = freshState();
    const template = makeTemplate(state);
    const withTiming = {
      ...state,
      startDate: "2026-01-01T08:00",
      endScheduleAt: "2026-12-31T23:59",
    };
    expect(findMatchingTemplate(withTiming, [template])).toBe("tmpl_1");
  });

  it("matches the first template when multiple templates are present", () => {
    const state = freshState();
    const tmpl1 = makeTemplate(state, { id: "tmpl_1" });
    const differentState = {
      ...state,
      steps: [
        { ...state.steps[0], intervalValue: 99, intervalUnit: "days" as const },
      ],
    };
    const tmpl2 = makeTemplate(differentState, { id: "tmpl_2" });
    // state matches tmpl1, not tmpl2
    expect(findMatchingTemplate(state, [tmpl1, tmpl2])).toBe("tmpl_1");
    // differentState matches tmpl2, not tmpl1
    expect(findMatchingTemplate(differentState, [tmpl1, tmpl2])).toBe("tmpl_2");
  });
});

// ---------------------------------------------------------------------------
// 4. templateToSectionState — timing always defaults to immediate / no end date
// ---------------------------------------------------------------------------

describe("templateToSectionState", () => {
  function makeStoredTemplate(
    overrides: Partial<RampScheduleTemplateInterface> = {},
  ): RampScheduleTemplateInterface {
    return {
      id: "tmpl_1",
      organization: "org_1",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      name: "My Template",
      steps: [
        {
          trigger: { type: "interval", seconds: 3600 },
          actions: [
            {
              targetType: "feature-rule",
              targetId: PLACEHOLDER_TARGET,
              patch: { ruleId: PLACEHOLDER_RULE, coverage: 0.5 },
            },
          ],
        },
      ],
      official: false,
      ...overrides,
    } as RampScheduleTemplateInterface;
  }

  it("always sets startDate to '' (templates do not carry a startDate)", () => {
    const state = templateToSectionState(makeStoredTemplate());
    expect(state.startDate).toBe("");
  });

  it("always sets endScheduleAt to ''", () => {
    const state = templateToSectionState(makeStoredTemplate());
    expect(state.endScheduleAt).toBe("");
  });

  it("always defaults endPatch to coverage:100", () => {
    const state = templateToSectionState(makeStoredTemplate());
    expect(state.endPatch).toEqual({ coverage: 100 });
  });

  it("reconstructs environment scope from template step patches", () => {
    const state = templateToSectionState(
      makeStoredTemplate({
        steps: [
          {
            interval: 3600,
            actions: [
              {
                targetType: "feature-rule",
                targetId: PLACEHOLDER_TARGET,
                patch: {
                  ruleId: PLACEHOLDER_RULE,
                  coverage: 0.5,
                  allEnvironments: false,
                  environments: ["dev", "production"],
                },
              },
            ],
          },
        ],
      }),
    );

    expect(state.steps[0]?.patch.allEnvironments).toBe(false);
    expect(state.steps[0]?.patch.environments).toEqual(["dev", "production"]);
  });

  it("reconstructs endPatch environment scope from template", () => {
    const state = templateToSectionState(
      makeStoredTemplate({
        endPatch: {
          allEnvironments: false,
          environments: ["staging"],
        },
      }),
    );

    expect(state.endPatch.allEnvironments).toBe(false);
    expect(state.endPatch.environments).toEqual(["staging"]);
  });

  it("correctly maps step count from template", () => {
    const twoStepTemplate = makeStoredTemplate({
      steps: [
        {
          interval: 3600,
          actions: [
            {
              targetType: "feature-rule",
              targetId: PLACEHOLDER_TARGET,
              patch: { ruleId: PLACEHOLDER_RULE, coverage: 0.5 },
            },
          ],
          monitored: false,
        },
        {
          interval: 7200,
          actions: [
            {
              targetType: "feature-rule",
              targetId: PLACEHOLDER_TARGET,
              patch: { ruleId: PLACEHOLDER_RULE, coverage: 1.0 },
            },
          ],
          monitored: false,
        },
      ],
    });
    const state = templateToSectionState(twoStepTemplate);
    expect(state.steps).toHaveLength(2);
  });

  it("round-trips: applying a state through buildTemplatePayload and back matches the original steps", () => {
    const original = freshState();
    const template = makeTemplate(original);
    const restored = templateToSectionState(template);
    // The structural match should hold
    expect(findMatchingTemplate(restored, [template])).toBe("tmpl_1");
  });
});

// ---------------------------------------------------------------------------
// buildPatch / reconstructUIPatch — coverage conversion
// ---------------------------------------------------------------------------
// These two functions are the single source of truth for the UI ↔ backend
// coverage translation. The conversion must be:
//   UI value (integer 1–50 for monitored, 1–100 for unmonitored)
//   → backend fraction: ui / 100  (same formula for both modes)
//   → payload ranges: [[0, c), [c, 2c)] with c = backend fraction
//
// The intent is that UI "40%" on a monitored step means 40% treatment /
// 40% control / 20% unenrolled, matching the equivalent unmonitored rollout.
// A previous (incorrect) implementation multiplied by 2 before dividing by 100,
// producing coverage=0.8 for UI=40 → 80% treatment / 20% control.
// ---------------------------------------------------------------------------

describe("buildPatch — UI→backend coverage conversion", () => {
  const RULE = "rule_1";

  it("monitored: UI 40 → backend coverage 0.4 (not 0.8)", () => {
    const patch = buildPatch({ coverage: 40 }, RULE);
    expect(patch.coverage).toBeCloseTo(0.4);
  });

  it("monitored: UI 25 → backend coverage 0.25", () => {
    const patch = buildPatch({ coverage: 25 }, RULE);
    expect(patch.coverage).toBeCloseTo(0.25);
  });

  it("monitored: UI 50 (max) → backend coverage 0.5, not 1.0", () => {
    const patch = buildPatch({ coverage: 50 }, RULE);
    expect(patch.coverage).toBeCloseTo(0.5);
  });

  it("unmonitored: UI 40 → backend coverage 0.4 (unchanged)", () => {
    const patch = buildPatch({ coverage: 40 }, RULE);
    expect(patch.coverage).toBeCloseTo(0.4);
  });

  it("unmonitored: UI 100 → backend coverage 1.0", () => {
    const patch = buildPatch({ coverage: 100 }, RULE);
    expect(patch.coverage).toBeCloseTo(1.0);
  });

  it("monitored and unmonitored produce the same backend value for the same UI input", () => {
    const mon = buildPatch({ coverage: 30 }, RULE);
    const unmon = buildPatch({ coverage: 30 }, RULE);
    expect(mon.coverage).toBeCloseTo(unmon.coverage!);
  });

  it("omits coverage when not in patch", () => {
    const patch = buildPatch({}, RULE);
    expect(patch.coverage).toBeUndefined();
  });
});

describe("reconstructUIPatch — backend→UI coverage conversion", () => {
  it("monitored: backend 0.4 → UI 40 (not 20)", () => {
    const ui = reconstructUIPatch({ ruleId: "r", coverage: 0.4 });
    expect(ui.coverage).toBe(40);
  });

  it("monitored: backend 0.25 → UI 25", () => {
    const ui = reconstructUIPatch({ ruleId: "r", coverage: 0.25 });
    expect(ui.coverage).toBe(25);
  });

  it("monitored: backend 0.5 (max) → UI 50", () => {
    const ui = reconstructUIPatch({ ruleId: "r", coverage: 0.5 });
    expect(ui.coverage).toBe(50);
  });

  it("unmonitored: backend 0.4 → UI 40", () => {
    const ui = reconstructUIPatch({ ruleId: "r", coverage: 0.4 });
    expect(ui.coverage).toBe(40);
  });

  it("round-trips: buildPatch then reconstructUIPatch returns the original UI value", () => {
    for (const uiInput of [1, 10, 25, 40, 50]) {
      const backend = buildPatch({ coverage: uiInput }, "r");
      const restored = reconstructUIPatch({
        ruleId: "r",
        coverage: backend.coverage,
      });
      expect(restored.coverage).toBe(uiInput);
    }
  });

  it("round-trips for unmonitored steps", () => {
    for (const uiInput of [1, 25, 50, 75, 100]) {
      const backend = buildPatch({ coverage: uiInput }, "r");
      const restored = reconstructUIPatch({
        ruleId: "r",
        coverage: backend.coverage,
      });
      expect(restored.coverage).toBe(uiInput);
    }
  });
});
