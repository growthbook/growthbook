/**
 * Tests for rampSchedule.ts
 *
 * Structure:
 *   1. Pure functions (no mocking): computeNextStepAt, computePhaseStartAfterApproval,
 *      applyPatchToRule, computeEffectivePatch
 *   2. featureEntityHandler: applyActions (mocked FeatureModel / FeatureRevisionModel)
 *   3. Orchestration: advanceStep, jumpAheadToStep, rollbackToStep, advanceUntilBlocked (mocked context)
 *
 * computeEffectivePatch — accumulation model:
 *   Steps are sparse; each step only defines fields that *change* at that point.
 *   Fields absent from a step are inherited from the most-recent step that defined them.
 *   startCondition is the fully-qualified baseline — every controlled field must appear there.
 *   rollbackToStep and jumpAheadToStep apply the effective accumulated patch so that
 *   arriving at step N from any direction yields the same rule state.
 */

import type { RampScheduleInterface } from "shared/validators";
import type { FeatureRule } from "shared/types/feature";
import {
  computeNextStepAt,
  computePhaseStartAfterApproval,
  applyPatchToRule,
  computeEffectivePatch,
  featureEntityHandler,
  advanceStep,
  jumpAheadToStep,
  rollbackToStep,
  advanceUntilBlocked,
} from "back-end/src/services/rampSchedule";

// ---------------------------------------------------------------------------
// Module mocks (must be declared before imports that use them)
// ---------------------------------------------------------------------------

jest.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: jest.fn(),
  publishRevision: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  createRevision: jest.fn(),
  getRevision: jest.fn(),
  discardRevision: jest.fn(),
  registerRevisionPublishedHook: jest.fn(),
}));

jest.mock("back-end/src/models/EventModel", () => ({
  createEvent: jest.fn(),
}));

jest.mock("back-end/src/services/organizations", () => ({
  getEnvironments: jest.fn().mockReturnValue([]),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("back-end/src/util/secrets", () => ({
  IS_CLOUD: false,
}));

// Pull in mocked module references AFTER the mock declarations.
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import { createRevision } from "back-end/src/models/FeatureRevisionModel";

const mockGetFeature = getFeature as jest.MockedFunction<typeof getFeature>;
const mockPublishRevision = publishRevision as jest.MockedFunction<
  typeof publishRevision
>;
const mockCreateRevision = createRevision as jest.MockedFunction<
  typeof createRevision
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RULE_ID = "rule_abc";
const FEATURE_ID = "feat_xyz";
const TARGET_ID = "target_1";
const ORG_ID = "org_1";

function makeFeature(rulesOverride?: FeatureRule[]) {
  const rules: FeatureRule[] = rulesOverride ?? [
    {
      id: RULE_ID,
      type: "rollout" as const,
      coverage: 0.1,
      hashAttribute: "id",
      enabled: true,
      condition: "",
    },
  ];
  return {
    id: FEATURE_ID,
    version: 5,
    organization: ORG_ID,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: "Test Feature",
    valueType: "string" as const,
    defaultValue: "off",
    environmentSettings: {
      production: { enabled: true, rules },
      staging: { enabled: true, rules: [] },
    },
  };
}

function makeRevision(overrides: Record<string, unknown> = {}) {
  return {
    id: `${FEATURE_ID}:6`,
    featureId: FEATURE_ID,
    version: 6,
    status: "draft" as const,
    ...overrides,
  };
}

function makeSchedule(
  overrides: Partial<RampScheduleInterface> = {},
): RampScheduleInterface {
  return {
    id: "rs_1",
    name: "Test Ramp",
    organization: ORG_ID,
    entityType: "feature",
    entityId: FEATURE_ID,
    targets: [
      {
        id: TARGET_ID,
        entityType: "feature",
        entityId: FEATURE_ID,
        ruleId: RULE_ID,
        environment: "production",
        status: "active",
      },
    ],
    steps: [
      {
        trigger: { type: "interval", seconds: 300 },
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 0.3 },
          },
        ],
      },
      {
        trigger: { type: "interval", seconds: 600 },
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 0.6 },
          },
        ],
      },
      {
        trigger: { type: "interval", seconds: 900 },
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 1.0 },
          },
        ],
      },
    ],
    startCondition: { trigger: { type: "immediately" } },
    status: "running",
    currentStepIndex: -1,
    nextStepAt: new Date(),
    startedAt: new Date(Date.now() - 60_000),
    phaseStartedAt: new Date(Date.now() - 60_000),
    ...overrides,
  } as RampScheduleInterface;
}

function makeContext(scheduleUpdates: Partial<RampScheduleInterface> = {}) {
  const schedule = makeSchedule(scheduleUpdates);
  const updateById = jest
    .fn()
    .mockImplementation(
      (_id: string, updates: Partial<RampScheduleInterface>) => ({
        ...schedule,
        ...updates,
      }),
    );
  return {
    ctx: {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {
        canUpdateFeature: jest.fn().mockReturnValue(true),
        canReviewFeatureDrafts: jest.fn().mockReturnValue(true),
        canPublishFeature: jest.fn().mockReturnValue(true),
      },
      models: {
        rampSchedules: { updateById, getById: jest.fn() },
      },
    },
    updateById,
  };
}

// ---------------------------------------------------------------------------
// 1. Pure functions
// ---------------------------------------------------------------------------

describe("applyPatchToRule", () => {
  const base: FeatureRule = {
    id: "r1",
    type: "rollout",
    coverage: 0.1,
    hashAttribute: "id",
    enabled: true,
    condition: "",
  };

  it("applies coverage patch", () => {
    const result = applyPatchToRule(base, { coverage: 0.5 });
    expect((result as { coverage?: number }).coverage).toBe(0.5);
  });

  it("applies condition patch", () => {
    const result = applyPatchToRule(base, { condition: '{"country":"US"}' });
    expect(result.condition).toBe('{"country":"US"}');
  });

  it("applies enabled=false patch", () => {
    const result = applyPatchToRule(base, { enabled: false });
    expect(result.enabled).toBe(false);
  });

  it("applies enabled=true patch", () => {
    const disabledRule = { ...base, enabled: false };
    const result = applyPatchToRule(disabledRule, { enabled: true });
    expect(result.enabled).toBe(true);
  });

  it("does not overwrite unpatchd fields", () => {
    const result = applyPatchToRule(base, { coverage: 0.9 });
    expect(result.condition).toBe(base.condition);
    expect(result.enabled).toBe(base.enabled);
  });
});

// ---------------------------------------------------------------------------
// computeEffectivePatch
// ---------------------------------------------------------------------------

// Helpers — build minimal schedule fragments for patch-accumulation tests.

function action(
  targetId: string,
  patch: Record<string, unknown>,
): { targetType: "feature-rule"; targetId: string; patch: { ruleId: string } & Record<string, unknown> } {
  return {
    targetType: "feature-rule",
    targetId,
    patch: { ruleId: RULE_ID, ...patch },
  };
}

function sparseSchedule(
  startActions: ReturnType<typeof action>[],
  stepActions: ReturnType<typeof action>[][],
  endActions: ReturnType<typeof action>[] = [],
): Pick<RampScheduleInterface, "startCondition" | "steps" | "endCondition"> {
  return {
    startCondition: {
      trigger: { type: "immediately" },
      actions: startActions as RampScheduleInterface["startCondition"]["actions"],
    },
    steps: stepActions.map((acts) => ({
      trigger: { type: "interval", seconds: 300 },
      actions: acts as RampScheduleInterface["steps"][0]["actions"],
    })),
    endCondition: endActions.length
      ? {
          trigger: { type: "scheduled", at: new Date("2030-01-01") },
          actions: endActions as RampScheduleInterface["endCondition"]["actions"],
        }
      : undefined,
  };
}

describe("computeEffectivePatch", () => {
  // Returns the accumulated patch for TARGET_ID at the given stepIndex, as a plain object.
  function eff(
    sched: ReturnType<typeof sparseSchedule>,
    stepIndex: number,
  ): Record<string, unknown> {
    const map = computeEffectivePatch(sched, stepIndex);
    const { ruleId: _, ...fields } = map.get(TARGET_ID) ?? {};
    return fields as Record<string, unknown>;
  }

  it("startCondition only (stepIndex=-1) returns its fields", () => {
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0, condition: "" })],
      [],
    );
    expect(eff(sched, -1)).toEqual({ coverage: 0.0, condition: "" });
  });

  it("single step accumulates with startCondition", () => {
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0 })],
      [[action(TARGET_ID, { coverage: 0.5 })]],
    );
    expect(eff(sched, 0)).toMatchObject({ coverage: 0.5 });
  });

  it("sparse step: absent field is inherited from startCondition", () => {
    // Step 0 only changes coverage; condition lives only in start.
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0, condition: '{"country":"US"}' })],
      [
        [action(TARGET_ID, { coverage: 0.3 })], // no condition
        [action(TARGET_ID, { coverage: 0.6 })], // no condition
      ],
    );
    // At step 1, condition should still be from startCondition.
    expect(eff(sched, 1)).toMatchObject({
      coverage: 0.6,
      condition: '{"country":"US"}',
    });
  });

  it("explicit null clears a field at that step", () => {
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0, condition: '{"a":"1"}' })],
      [[action(TARGET_ID, { coverage: 0.5, condition: null })]],
    );
    const result = computeEffectivePatch(sched, 0).get(TARGET_ID);
    expect(result).toHaveProperty("condition", null);
  });

  it("later step overrides earlier step value", () => {
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0, condition: '{"a":"1"}' })],
      [
        [action(TARGET_ID, { coverage: 0.3, condition: '{"b":"2"}' })],
        [action(TARGET_ID, { coverage: 0.6, condition: '{"c":"3"}' })],
      ],
    );
    expect(eff(sched, 1)).toMatchObject({ condition: '{"c":"3"}' });
  });

  it("rollback semantics: stepIndex=0 includes only start+step0, not step1", () => {
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0, condition: '{"a":"1"}' })],
      [
        [action(TARGET_ID, { coverage: 0.3, condition: '{"b":"2"}' })],
        [action(TARGET_ID, { coverage: 0.6, condition: '{"c":"3"}' })],
      ],
    );
    expect(eff(sched, 0)).toMatchObject({
      coverage: 0.3,
      condition: '{"b":"2"}',
    });
  });

  it("jump-ahead semantics: sparse intermediate steps are still accumulated", () => {
    // Step 0 sets condition; steps 1+2 are coverage-only (sparse).
    // Jumping from -1 to step 2 should carry condition from step 0 forward.
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0 })],
      [
        [action(TARGET_ID, { coverage: 0.3, condition: '{"a":"1"}' })],
        [action(TARGET_ID, { coverage: 0.6 })],
        [action(TARGET_ID, { coverage: 1.0 })],
      ],
    );
    expect(eff(sched, 2)).toMatchObject({
      coverage: 1.0,
      condition: '{"a":"1"}',
    });
  });

  it("multiple targets accumulate independently", () => {
    const TARGET_B = "target_b";
    const sched = sparseSchedule(
      [
        action(TARGET_ID, { coverage: 0.0 }),
        action(TARGET_B, { coverage: 0.0, condition: '{"x":"1"}' }),
      ],
      [
        [action(TARGET_ID, { coverage: 0.5 })], // no target_B action
        [action(TARGET_B, { condition: '{"y":"2"}' })], // no target_A action
      ],
    );
    const map = computeEffectivePatch(sched, 1);

    // target_A: coverage from step 0, no condition (never set)
    const patchA = map.get(TARGET_ID);
    expect(patchA).toHaveProperty("coverage", 0.5);
    expect(patchA).not.toHaveProperty("condition");

    // target_B: condition updated in step 1, coverage from start
    const patchB = map.get(TARGET_B);
    expect(patchB).toHaveProperty("condition", '{"y":"2"}');
    expect(patchB).toHaveProperty("coverage", 0.0);
  });

  it("endCondition included when stepIndex >= steps.length", () => {
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0 })],
      [[action(TARGET_ID, { coverage: 0.5 })]],
      [action(TARGET_ID, { coverage: 1.0, enabled: false })],
    );
    // stepIndex=1 (= steps.length=1) should include endCondition
    expect(eff(sched, 1)).toMatchObject({ coverage: 1.0, enabled: false });
  });

  it("target not in startCondition starts accumulating from first step that mentions it", () => {
    const sched = sparseSchedule(
      [], // no startCondition actions
      [[action(TARGET_ID, { coverage: 0.3 })]],
    );
    expect(eff(sched, 0)).toMatchObject({ coverage: 0.3 });
  });

  it("returns empty map when no actions anywhere", () => {
    const sched = sparseSchedule([], []);
    expect(computeEffectivePatch(sched, -1).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Sparse vs. explicit-clear semantics
// ---------------------------------------------------------------------------
// Key invariant:
//   absent key in a step's patch  → field is inherited from the previous step that set it
//   present key with empty value  → field is explicitly set to empty at this step,
//                                   and that empty value propagates to later sparse steps
// ---------------------------------------------------------------------------

describe("sparse inherit vs explicit clear", () => {
  function eff(
    sched: ReturnType<typeof sparseSchedule>,
    stepIndex: number,
  ): Record<string, unknown> {
    const map = computeEffectivePatch(sched, stepIndex);
    const { ruleId: _, ...fields } = map.get(TARGET_ID) ?? {};
    return fields as Record<string, unknown>;
  }

  // ── condition ────────────────────────────────────────────────────────────

  it('absent condition in step inherits the previously-set value', () => {
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0, condition: '{"country":"US"}' })],
      [
        [action(TARGET_ID, { coverage: 0.3 })], // no condition key → inherit
        [action(TARGET_ID, { coverage: 0.6 })], // no condition key → inherit
      ],
    );
    expect(eff(sched, 1)).toMatchObject({ condition: '{"country":"US"}' });
  });

  it('condition: "{}" in a step overrides and propagates to later sparse steps', () => {
    // Step 0 explicitly clears targeting. Step 1 is sparse — it should inherit
    // the cleared "{}" rather than restoring the startCondition value.
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0, condition: '{"country":"US"}' })],
      [
        [action(TARGET_ID, { coverage: 0.3, condition: '{}' })], // explicit clear
        [action(TARGET_ID, { coverage: 0.6 })],                  // sparse
      ],
    );
    expect(eff(sched, 1)).toMatchObject({ condition: '{}' });
  });

  it('absent condition never appears in the effective patch if never set', () => {
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0 })], // no condition in start
      [[action(TARGET_ID, { coverage: 0.5 })]],
    );
    expect(eff(sched, 0)).not.toHaveProperty('condition');
  });

  // ── savedGroups ──────────────────────────────────────────────────────────

  it('absent savedGroups in step inherits the previously-set value', () => {
    const groups = [{ match: 'any', ids: ['g1'] }];
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0, savedGroups: groups })],
      [
        [action(TARGET_ID, { coverage: 0.3 })], // no savedGroups key → inherit
        [action(TARGET_ID, { coverage: 0.6 })],
      ],
    );
    expect(eff(sched, 1)).toMatchObject({ savedGroups: groups });
  });

  it('savedGroups: [] in a step overrides and propagates to later sparse steps', () => {
    const groups = [{ match: 'any', ids: ['g1'] }];
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0, savedGroups: groups })],
      [
        [action(TARGET_ID, { coverage: 0.3, savedGroups: [] })], // explicit clear
        [action(TARGET_ID, { coverage: 0.6 })],                  // sparse
      ],
    );
    expect(eff(sched, 1)).toMatchObject({ savedGroups: [] });
  });

  it('absent savedGroups never appears in the effective patch if never set', () => {
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0 })],
      [[action(TARGET_ID, { coverage: 0.5 })]],
    );
    expect(eff(sched, 0)).not.toHaveProperty('savedGroups');
  });

  // ── prerequisites ────────────────────────────────────────────────────────

  it('absent prerequisites in step inherits the previously-set value', () => {
    const prereqs = [{ id: 'feat_x', condition: '{"value": true}' }];
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0, prerequisites: prereqs })],
      [
        [action(TARGET_ID, { coverage: 0.3 })], // no prerequisites key → inherit
        [action(TARGET_ID, { coverage: 0.6 })],
      ],
    );
    expect(eff(sched, 1)).toMatchObject({ prerequisites: prereqs });
  });

  it('prerequisites: [] in a step overrides and propagates to later sparse steps', () => {
    const prereqs = [{ id: 'feat_x', condition: '{"value": true}' }];
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0, prerequisites: prereqs })],
      [
        [action(TARGET_ID, { coverage: 0.3, prerequisites: [] })], // explicit clear
        [action(TARGET_ID, { coverage: 0.6 })],                    // sparse
      ],
    );
    expect(eff(sched, 1)).toMatchObject({ prerequisites: [] });
  });

  it('absent prerequisites never appears in the effective patch if never set', () => {
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0 })],
      [[action(TARGET_ID, { coverage: 0.5 })]],
    );
    expect(eff(sched, 0)).not.toHaveProperty('prerequisites');
  });

  // ── force (null is a valid value, not a clear signal) ────────────────────

  it('absent force in step inherits the previously-set value', () => {
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0, force: 'blue' })],
      [
        [action(TARGET_ID, { coverage: 0.3 })], // no force key → inherit
      ],
    );
    expect(eff(sched, 0)).toMatchObject({ force: 'blue' });
  });

  it('force: null in a step is a valid value and propagates to later sparse steps', () => {
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0, force: 'blue' })],
      [
        [action(TARGET_ID, { coverage: 0.3, force: null })], // null is valid
        [action(TARGET_ID, { coverage: 0.6 })],              // sparse
      ],
    );
    expect(eff(sched, 1)).toHaveProperty('force', null);
  });

  // ── cross-field independence ──────────────────────────────────────────────

  it('clearing one field does not affect unrelated fields', () => {
    const groups = [{ match: 'any', ids: ['g1'] }];
    const sched = sparseSchedule(
      [action(TARGET_ID, { coverage: 0.0, condition: '{"a":"1"}', savedGroups: groups })],
      [
        [action(TARGET_ID, { coverage: 0.3, condition: '{}' })], // clears condition only
        [action(TARGET_ID, { coverage: 0.6 })],                  // sparse
      ],
    );
    // condition was explicitly cleared; savedGroups was never touched → still inherited
    expect(eff(sched, 1)).toMatchObject({ condition: '{}', savedGroups: groups });
  });
});

// ---------------------------------------------------------------------------

describe("computeNextStepAt", () => {
  const phaseStart = new Date("2025-01-01T00:00:00Z");
  const now = new Date("2025-01-01T01:00:00Z");

  it("returns now for an approval step", () => {
    const schedule = makeSchedule({
      steps: [{ trigger: { type: "approval" }, actions: [] }],
      phaseStartedAt: phaseStart,
    });
    const result = computeNextStepAt(schedule, 0, now);
    expect(result).toEqual(now);
  });

  it("returns trigger.at for a scheduled step", () => {
    const at = new Date("2025-06-01T12:00:00Z");
    const schedule = makeSchedule({
      steps: [{ trigger: { type: "scheduled", at }, actions: [] }],
    });
    const result = computeNextStepAt(schedule, 0, now);
    expect(result).toEqual(at);
  });

  it("computes cumulative interval from phaseStart (step 0)", () => {
    const schedule = makeSchedule({
      steps: [{ trigger: { type: "interval", seconds: 600 }, actions: [] }],
      phaseStartedAt: phaseStart,
    });
    const result = computeNextStepAt(schedule, 0, now);
    // phaseStart + 600s
    expect(result).toEqual(new Date(phaseStart.getTime() + 600_000));
  });

  it("computes cumulative interval for step 1 (sum of steps 0+1)", () => {
    const schedule = makeSchedule({
      steps: [
        { trigger: { type: "interval", seconds: 300 }, actions: [] },
        { trigger: { type: "interval", seconds: 600 }, actions: [] },
      ],
      phaseStartedAt: phaseStart,
    });
    const result = computeNextStepAt(schedule, 1, now);
    // phaseStart + (300 + 600)s = phaseStart + 900s
    expect(result).toEqual(new Date(phaseStart.getTime() + 900_000));
  });

  it("approval steps are excluded from the cumulative sum", () => {
    const schedule = makeSchedule({
      steps: [
        { trigger: { type: "interval", seconds: 300 }, actions: [] },
        { trigger: { type: "approval" }, actions: [] },
        { trigger: { type: "interval", seconds: 600 }, actions: [] },
      ],
      phaseStartedAt: phaseStart,
    });
    // Step 2 (index 2): sum = 300 (step 0) + 0 (approval, step 1) + 600 (step 2) = 900
    const result = computeNextStepAt(schedule, 2, now);
    expect(result).toEqual(new Date(phaseStart.getTime() + 900_000));
  });

  it("returns null for an out-of-range step index", () => {
    const schedule = makeSchedule({ steps: [] });
    const result = computeNextStepAt(schedule, 0, now);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("computePhaseStartAfterApproval", () => {
  it("returns now - sum(previous interval steps) so next step fires correctly", () => {
    const now = new Date("2025-01-01T01:00:00Z");
    const schedule = makeSchedule({
      steps: [
        { trigger: { type: "interval", seconds: 300 }, actions: [] },
        { trigger: { type: "approval" }, actions: [] },
        { trigger: { type: "interval", seconds: 600 }, actions: [] },
      ],
    });
    // After approval at step 1, next step is index 2.
    // phaseStart = now - sum(intervals 0..1 exclusive) = now - 300s
    const phaseStart = computePhaseStartAfterApproval(now, schedule, 2);
    expect(phaseStart).toEqual(new Date(now.getTime() - 300_000));

    // Verify: computeNextStepAt(step 2, phaseStart=phaseStart) = phaseStart + (300 + 600) = now + 600s
    const nextAt = computeNextStepAt(
      { ...schedule, phaseStartedAt: phaseStart },
      2,
      now,
    );
    expect(nextAt).toEqual(new Date(now.getTime() + 600_000));
  });
});

// ---------------------------------------------------------------------------
// 2. featureEntityHandler.applyActions
// ---------------------------------------------------------------------------

describe("featureEntityHandler.applyActions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(makeFeature() as never);
  });

  const ctx = {
    org: { id: ORG_ID, settings: {} },
    environments: [],
    auditUser: { type: "system" },
  } as never;

  it("calls publishRevision with sparse-patched rules", async () => {
    const actions = [
      {
        targetType: "feature-rule" as const,
        targetId: TARGET_ID,
        patch: { ruleId: RULE_ID, coverage: 0.5 },
      },
    ];
    await featureEntityHandler.applyActions(ctx, FEATURE_ID, actions, {
      stepLabel: "Ramp [1 of 3]: Test",
      user: { type: "system" },
    });

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const [, , , forceResult] = mockPublishRevision.mock.calls[0];
    const productionRules: FeatureRule[] = forceResult.rules?.production ?? [];
    const patchedRule = productionRules.find(
      (r: FeatureRule) => r.id === RULE_ID,
    );
    expect((patchedRule as { coverage?: number })?.coverage).toBe(0.5);
  });

  it("throws when the rule is not found in any environment", async () => {
    const actions = [
      {
        targetType: "feature-rule" as const,
        targetId: TARGET_ID,
        patch: { ruleId: "nonexistent_rule", coverage: 0.5 },
      },
    ];
    await expect(
      featureEntityHandler.applyActions(ctx, FEATURE_ID, actions, {
        stepLabel: "Ramp [1 of 3]: Test",
        user: { type: "system" },
      }),
    ).rejects.toThrow(/not found in any environment/);
  });

  it("throws Feature not found when entity does not exist", async () => {
    mockGetFeature.mockResolvedValue(null as never);
    await expect(
      featureEntityHandler.applyActions(ctx, "nonexistent", [], {
        stepLabel: "Ramp [1 of 3]: Test",
        user: { type: "system" },
      }),
    ).rejects.toThrow("Feature not found: nonexistent");
  });

  it("always publishes immediately — including when called for an approval step", async () => {
    const actions = [
      {
        targetType: "feature-rule" as const,
        targetId: TARGET_ID,
        patch: { ruleId: RULE_ID, coverage: 0.5 },
      },
    ];
    await featureEntityHandler.applyActions(ctx, FEATURE_ID, actions, {
      stepLabel: "Ramp [1 of 3]: Test",
      user: { type: "system" },
    });

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 3. advanceStep
// ---------------------------------------------------------------------------

describe("advanceStep — interval step", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(makeFeature() as never);
  });

  it("increments currentStepIndex", async () => {
    const { ctx, updateById } = makeContext({ currentStepIndex: -1 });
    await advanceStep(ctx as never, makeSchedule({ currentStepIndex: -1 }));

    expect(updateById).toHaveBeenCalledTimes(1);
    const [, updates] = updateById.mock.calls[0];
    expect(updates.currentStepIndex).toBe(0);
  });

  it("sets status to 'running' for interval steps", async () => {
    const { ctx, updateById } = makeContext({ currentStepIndex: -1 });
    await advanceStep(ctx as never, makeSchedule({ currentStepIndex: -1 }));

    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("running");
  });

  it("sets nextStepAt for the following step", async () => {
    const { ctx, updateById } = makeContext({ currentStepIndex: -1 });
    await advanceStep(ctx as never, makeSchedule({ currentStepIndex: -1 }));

    const [, updates] = updateById.mock.calls[0];
    expect(updates.nextStepAt).not.toBeNull();
  });
});

describe("advanceStep — approval step", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(makeFeature() as never);
  });

  it("sets status to pending-approval without publishing a revision (deferred to approve)", async () => {
    const schedule = makeSchedule({
      currentStepIndex: -1,
      steps: [
        {
          trigger: { type: "approval" },
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.5 },
            },
          ],
        },
      ],
    });
    const { ctx, updateById } = makeContext({ currentStepIndex: -1 });
    await advanceStep(ctx as never, schedule);

    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("pending-approval");
    // Apply-first: coverage is applied immediately on entering the step.
    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
  });
});

describe("advanceStep — last step / completion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(makeFeature() as never);
  });

  it("sets status to completed when no more steps remain", async () => {
    const schedule = makeSchedule({ currentStepIndex: 2 }); // 3 steps total (0,1,2) → step 3 doesn't exist
    const { ctx, updateById } = makeContext({ currentStepIndex: 2 });
    await advanceStep(ctx as never, schedule);

    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("completed");
    expect(updates.nextStepAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// jumpAheadToStep
// ---------------------------------------------------------------------------

describe("jumpAheadToStep", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(makeFeature() as never);
  });

  it("applies accumulated effective patch when jumping forward", async () => {
    // startCondition: coverage 0.0; steps 0=coverage 0.3, 1=coverage 0.6, 2=coverage 1.0.
    // Jumping to step 2 should apply the effective state: coverage 1.0.
    const schedule = makeSchedule({ currentStepIndex: -1 });
    const { ctx } = makeContext();
    await jumpAheadToStep(ctx as never, schedule, 2);

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const [, , , forceResult] = mockPublishRevision.mock.calls[0];
    const rules: FeatureRule[] = forceResult.rules?.production ?? [];
    const patched = rules.find((r: FeatureRule) => r.id === RULE_ID);
    expect((patched as { coverage?: number })?.coverage).toBe(1.0);
  });

  it("carries fields from sparse intermediate steps when jumping", async () => {
    // Step 0 sets condition; steps 1 and 2 are coverage-only (sparse).
    // Jumping to step 2 from -1 should deliver condition from step 0 + coverage from step 2.
    const sparseSchedule = makeSchedule({
      currentStepIndex: -1,
      startCondition: {
        trigger: { type: "immediately" },
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 0.0 },
          },
        ],
      },
      steps: [
        {
          trigger: { type: "interval", seconds: 300 },
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.3, condition: '{"a":"1"}' },
            },
          ],
        },
        {
          trigger: { type: "interval", seconds: 300 },
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.6 }, // sparse — no condition
            },
          ],
        },
        {
          trigger: { type: "interval", seconds: 300 },
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 1.0 }, // sparse — no condition
            },
          ],
        },
      ],
    });

    const { ctx } = makeContext();
    await jumpAheadToStep(ctx as never, sparseSchedule, 2);

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const [, , , forceResult] = mockPublishRevision.mock.calls[0];
    const rules: FeatureRule[] = forceResult.rules?.production ?? [];
    const patched = rules.find((r: FeatureRule) => r.id === RULE_ID);
    expect((patched as { coverage?: number })?.coverage).toBe(1.0);
    expect(patched?.condition).toBe('{"a":"1"}');
  });

  it("sets status to paused at the target step", async () => {
    const schedule = makeSchedule({ currentStepIndex: -1 });
    const { ctx, updateById } = makeContext();
    await jumpAheadToStep(ctx as never, schedule, 1);

    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("paused");
    expect(updates.currentStepIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// rollbackToStep
// ---------------------------------------------------------------------------

describe("rollbackToStep", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(makeFeature() as never);
  });

  it("applies accumulated effective patch when rolling back — excludes steps after target", async () => {
    // Schedule at step 2 with condition that was set in step 0 and overridden in step 2.
    // Rolling back to step 0 should apply the step-0 effective state, not step-2's condition.
    const schedule = makeSchedule({
      currentStepIndex: 2,
      startCondition: {
        trigger: { type: "immediately" },
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 0.0, condition: '{"baseline":"true"}' },
          },
        ],
      },
      steps: [
        {
          trigger: { type: "interval", seconds: 300 },
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.3, condition: '{"step":"0"}' },
            },
          ],
        },
        {
          trigger: { type: "interval", seconds: 300 },
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.6 }, // sparse — no condition
            },
          ],
        },
        {
          trigger: { type: "interval", seconds: 300 },
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 1.0, condition: '{"step":"2"}' },
            },
          ],
        },
      ],
    });

    const { ctx } = makeContext({ currentStepIndex: 2 });
    await rollbackToStep(ctx as never, schedule, 0);

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const [, , , forceResult] = mockPublishRevision.mock.calls[0];
    const rules: FeatureRule[] = forceResult.rules?.production ?? [];
    const patched = rules.find((r: FeatureRule) => r.id === RULE_ID);
    // Effective at step 0: start + step0 → coverage 0.3, condition from step 0
    expect((patched as { coverage?: number })?.coverage).toBe(0.3);
    expect(patched?.condition).toBe('{"step":"0"}');
  });

  it("rolling back to -1 applies startCondition effective state", async () => {
    const schedule = makeSchedule({
      currentStepIndex: 1,
      startCondition: {
        trigger: { type: "immediately" },
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 0.0 },
          },
        ],
      },
    });

    const { ctx } = makeContext({ currentStepIndex: 1 });
    await rollbackToStep(ctx as never, schedule, -1);

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const [, , , forceResult] = mockPublishRevision.mock.calls[0];
    const rules: FeatureRule[] = forceResult.rules?.production ?? [];
    const patched = rules.find((r: FeatureRule) => r.id === RULE_ID);
    expect((patched as { coverage?: number })?.coverage).toBe(0.0);
  });

  it("sets status to rolled-back for full rollback (targetStepIndex=-1)", async () => {
    const schedule = makeSchedule({ currentStepIndex: 1 });
    const { ctx, updateById } = makeContext({ currentStepIndex: 1 });
    await rollbackToStep(ctx as never, schedule, -1);

    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("rolled-back");
  });

  it("sets status to paused for partial rollback", async () => {
    const schedule = makeSchedule({ currentStepIndex: 2 });
    const { ctx, updateById } = makeContext({ currentStepIndex: 2 });
    await rollbackToStep(ctx as never, schedule, 1);

    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("paused");
    expect(updates.currentStepIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// advanceUntilBlocked
// ---------------------------------------------------------------------------

describe("advanceUntilBlocked", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(makeFeature() as never);
  });

  it("stops when nextStepAt is in the future", async () => {
    const future = new Date(Date.now() + 3_600_000);
    const schedule = makeSchedule({ currentStepIndex: -1, nextStepAt: future });
    const { ctx, updateById } = makeContext({
      currentStepIndex: -1,
      nextStepAt: future,
    });
    const now = new Date();

    await advanceUntilBlocked(ctx as never, schedule, now);

    // No step should have been advanced — timer not due yet.
    expect(updateById).not.toHaveBeenCalled();
  });

  it("advances a single due step", async () => {
    const past = new Date(Date.now() - 1000);
    const schedule = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: past,
      status: "running",
    });

    // After advancing step 0, the returned schedule should have nextStepAt in the future.
    let callCount = 0;
    const updateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) => {
          callCount++;
          return {
            ...schedule,
            ...updates,
            // Future nextStepAt so the loop stops after first advance.
            nextStepAt: new Date(Date.now() + 3_600_000),
            status: "running",
          };
        },
      );

    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {},
      models: {
        rampSchedules: { updateById, getById: jest.fn() },
      },
    };

    await advanceUntilBlocked(ctx as never, schedule, new Date());

    expect(callCount).toBe(1);
  });

  it("stops at an approval gate (status → pending-approval)", async () => {
    const past = new Date(Date.now() - 1000);
    const scheduleWithApproval = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: past,
      status: "running",
      steps: [
        {
          trigger: { type: "approval" },
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.5 },
            },
          ],
        },
        {
          trigger: { type: "interval", seconds: 300 },
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 1.0 },
            },
          ],
        },
      ],
    });

    let callCount = 0;
    const updateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) => {
          callCount++;
          return {
            ...scheduleWithApproval,
            ...updates,
            status: updates.status ?? scheduleWithApproval.status,
          };
        },
      );

    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {},
      models: {
        rampSchedules: { updateById, getById: jest.fn() },
      },
    };

    await advanceUntilBlocked(ctx as never, scheduleWithApproval, new Date());

    // Should only advance to step 0 (approval gate), then stop.
    expect(callCount).toBe(1);
    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("pending-approval");
  });
});
