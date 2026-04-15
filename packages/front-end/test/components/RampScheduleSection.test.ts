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
  buildTemplatePayload,
  findMatchingTemplate,
  templateToSectionState,
  defaultRampSectionState,
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
  const interval = { trigger: { type: "interval" } };
  const approval = { trigger: { type: "approval" } };

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
// 2. buildTemplatePayload — steps and endPatch are persisted (no start/end timing)
// ---------------------------------------------------------------------------

describe("buildTemplatePayload", () => {
  it("returns name, steps, and endPatch (no startDate or endCondition)", () => {
    const payload = buildTemplatePayload(freshState());
    expect(payload).not.toHaveProperty("startDate");
    expect(payload).not.toHaveProperty("endCondition");
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
    expect(payload).not.toHaveProperty("endCondition");
  });

  it("uses placeholder IDs for target and rule (not real entity IDs)", () => {
    const payload = buildTemplatePayload(freshState());
    for (const step of payload.steps) {
      for (const action of step.actions) {
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

  it("correctly maps step count from template", () => {
    const twoStepTemplate = makeStoredTemplate({
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
        {
          trigger: { type: "interval", seconds: 7200 },
          actions: [
            {
              targetType: "feature-rule",
              targetId: PLACEHOLDER_TARGET,
              patch: { ruleId: PLACEHOLDER_RULE, coverage: 1.0 },
            },
          ],
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
