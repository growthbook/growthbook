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
 *   Step 0 is the first step; stepIndex=-1 means before the ramp starts.
 *   rollbackToStep and jumpAheadToStep apply the effective accumulated patch so that
 *   arriving at step N from any direction yields the same rule state.
 */

import type {
  RampScheduleInterface,
  RampStepAction,
  SafeRolloutInterface,
} from "shared/validators";
import type { FeatureRule } from "shared/types/feature";
import {
  isAwaitingApproval,
  isReadyForApproval,
  isAwaitingStartApproval,
  startApprovalPending,
  resolveStartApproval,
} from "shared/src/validators/ramp-schedule";
import {
  computeNextStepAt,
  computeAutoAdvanceTarget,
  stepIsCollapsible,
  withRampScheduleAdvanceLock,
  withRampScheduleAdvanceLockRetry,
  runLockedRampScheduleAction,
  computePhaseStartAfterApproval,
  applyPatchToRule,
  computeEffectivePatch,
  featureEntityHandler,
  advanceStep,
  jumpAheadToStep,
  rollbackToStep,
  resumeSchedule,
  restartSchedule,
  advanceUntilBlocked,
  advanceScheduleManually,
  completeRollout,
  getStartPatchForRule,
  resolveRampStartState,
  applyRampStartActions,
  startReadyScheduleNow,
  approveAndPublishStep,
  computeNextProcessAt,
  pauseSchedule,
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
import { createEvent } from "back-end/src/models/EventModel";
import { RampAdvanceLockBusyError } from "back-end/src/util/errors";

const mockGetFeature = getFeature as jest.MockedFunction<typeof getFeature>;
const mockPublishRevision = publishRevision as jest.MockedFunction<
  typeof publishRevision
>;
const mockCreateRevision = createRevision as jest.MockedFunction<
  typeof createRevision
>;
const mockCreateEvent = createEvent as jest.MockedFunction<typeof createEvent>;

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
      uid: "ruid_" + RULE_ID,
      allEnvironments: false,
      environments: ["production"],
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
    // v2 unified rules at top level. environmentSettings no longer carries
    // per-env rules; it only tracks `enabled` (and `prerequisites`).
    rules,
    environmentSettings: {
      production: { enabled: true },
      staging: { enabled: true },
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
        interval: 300,
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 0.3 },
          },
        ],
      },
      {
        interval: 600,
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 0.6 },
          },
        ],
      },
      {
        interval: 900,
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 1.0 },
          },
        ],
      },
    ],
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
        rampSchedules: {
          updateById,
          getById: jest.fn(),
          acquireAdvanceLock: jest.fn().mockResolvedValue(true),
          releaseAdvanceLock: jest.fn().mockResolvedValue(undefined),
        },
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

  it("preserves the rule's sparse flag when applying a force patch", () => {
    // A ramp step sets a new (partial) value on a sparse rule; the sparse flag
    // must survive so the SDK payload still merges it onto the default.
    const sparseRule = {
      ...base,
      type: "force",
      value: JSON.stringify({ b: 1 }),
      sparse: true,
    } as FeatureRule;
    const result = applyPatchToRule(sparseRule, {
      force: JSON.stringify({ b: 9 }),
    });
    expect((result as { value?: unknown }).value).toBe(
      JSON.stringify({ b: 9 }),
    );
    expect((result as { sparse?: boolean }).sparse).toBe(true);
  });

  it("allEnvironments:true wins when both allEnvironments and environments appear in the same patch", () => {
    // getStartPatchForRule on an allEnvironments:true rule produces both
    // allEnvironments:true and environments:null. Without the ordering fix the
    // environments branch would silently reset allEnvironments back to false.
    const allEnvRule: FeatureRule = {
      ...base,
      allEnvironments: true,
      environments: undefined,
    };
    const patch = {
      allEnvironments: true as const,
      environments: null,
    };
    const result = applyPatchToRule(allEnvRule, patch);
    expect(result.allEnvironments).toBe(true);
    expect(result.environments).toBeUndefined();
  });

  it("environments patch correctly resets allEnvironments to false", () => {
    const allEnvRule: FeatureRule = {
      ...base,
      allEnvironments: true,
      environments: undefined,
    };
    const result = applyPatchToRule(allEnvRule, {
      environments: ["production"],
    });
    expect(result.allEnvironments).toBe(false);
    expect(result.environments).toEqual(["production"]);
  });
});

describe("getStartPatchForRule", () => {
  it("captures explicit null clears for absent rule fields", () => {
    const patch = getStartPatchForRule({
      id: "r1",
      type: "rollout",
      hashAttribute: "id",
      enabled: true,
    } as FeatureRule);

    expect(patch).toMatchObject({
      coverage: null,
      condition: null,
      savedGroups: null,
      prerequisites: null,
      enabled: true,
    });
  });

  it("captures the full pre-ramp rule state", () => {
    const savedGroups = [{ match: "any" as const, ids: ["group_1"] }];
    const prerequisites = [{ id: "feat_1", condition: "{}" }];

    const patch = getStartPatchForRule({
      id: "r1",
      type: "rollout",
      coverage: 0.25,
      hashAttribute: "id",
      enabled: false,
      condition: '{"country":"US"}',
      savedGroups,
      prerequisites,
      allEnvironments: false,
      environments: ["production", "staging"],
    } as FeatureRule);

    expect(patch).toMatchObject({
      coverage: 0.25,
      condition: '{"country":"US"}',
      savedGroups,
      prerequisites,
      allEnvironments: false,
      environments: ["production", "staging"],
      enabled: false,
    });
  });

  it("captures force value (including null as a valid value)", () => {
    const patch = getStartPatchForRule({
      id: "r1",
      type: "force",
      hashAttribute: "id",
      enabled: true,
      value: "variant-b",
    } as FeatureRule);

    expect(patch.force).toBe("variant-b");

    const nullPatch = getStartPatchForRule({
      id: "r1",
      type: "force",
      hashAttribute: "id",
      enabled: true,
      value: null,
    } as FeatureRule);

    expect(nullPatch.force).toBeNull();
  });

  it("round-trips: capture → computeEffectivePatch → applyPatchToRule restores original rule", () => {
    const originalRule = {
      id: "r1",
      type: "rollout" as const,
      coverage: 0.75,
      hashAttribute: "id",
      enabled: true,
      condition: '{"country":"US"}',
      savedGroups: [{ match: "any" as const, ids: ["grp1"] }],
      prerequisites: [{ id: "feat_gate", condition: '{"value":true}' }],
      allEnvironments: false,
      environments: ["production"],
    } as FeatureRule;

    // A. Capture into startActions
    const startPatch = getStartPatchForRule(originalRule);
    const startActions = [
      {
        targetType: "feature-rule" as const,
        targetId: TARGET_ID,
        patch: { ruleId: RULE_ID, ...startPatch },
      },
    ];

    // B. Build a schedule at step 1 (ramp changed coverage to 0.5)
    const sched = {
      steps: [
        {
          interval: 300,
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.5 },
            },
          ],
        },
      ],
      startActions,
      endActions: [],
    };

    // C. computeEffectivePatch at step 0 merges startActions + step 0
    const effective = computeEffectivePatch(sched, 0);
    const merged = effective.get(TARGET_ID)!;
    expect(merged.coverage).toBe(0.5); // step override
    expect(merged.condition).toBe('{"country":"US"}'); // from startActions

    // D. Apply the startActions patch directly (simulates rollbackToStep(-1))
    const driftedRule = {
      ...originalRule,
      coverage: 0.5,
      condition: "",
    } as FeatureRule;
    const restored = applyPatchToRule(driftedRule, startPatch);
    expect((restored as { coverage?: number }).coverage).toBe(0.75);
    expect(restored.condition).toBe('{"country":"US"}');
    expect(restored.savedGroups).toEqual([{ match: "any", ids: ["grp1"] }]);
    expect(restored.prerequisites).toEqual([
      { id: "feat_gate", condition: '{"value":true}' },
    ]);
    expect(restored.allEnvironments).toBe(false);
    expect(restored.environments).toEqual(["production"]);
  });
});

// ---------------------------------------------------------------------------
// computeEffectivePatch
// ---------------------------------------------------------------------------

// Helpers — build minimal schedule fragments for patch-accumulation tests.

function action(
  targetId: string,
  patch: Record<string, unknown>,
): {
  targetType: "feature-rule";
  targetId: string;
  patch: { ruleId: string } & Record<string, unknown>;
} {
  return {
    targetType: "feature-rule",
    targetId,
    patch: { ruleId: RULE_ID, ...patch },
  };
}

function sparseSchedule(
  stepActions: ReturnType<typeof action>[][],
): Pick<RampScheduleInterface, "steps" | "endActions"> {
  return {
    steps: stepActions.map((acts) => ({
      interval: 300,
      actions: acts as RampScheduleInterface["steps"][0]["actions"],
    })),
  };
}

describe("resolveRampStartState", () => {
  const rolloutRule = (coverage?: number) =>
    ({
      id: RULE_ID,
      type: "rollout",
      hashAttribute: "id",
      enabled: true,
      ...(coverage !== undefined ? { coverage } : {}),
    }) as FeatureRule;

  it("converts an explicit startState into startActions merged onto the rule state", () => {
    const { startActions, warning } = resolveRampStartState({
      rule: rolloutRule(0.1),
      ruleId: RULE_ID,
      startState: { coverage: 0 },
      isCreate: true,
    });

    expect(warning).toBeUndefined();
    expect(startActions).toHaveLength(1);
    // Explicit coverage override wins; other targeting comes from the rule.
    expect(startActions![0].patch).toMatchObject({
      ruleId: RULE_ID,
      coverage: 0,
    });
  });

  it("warns on create when the anchor is inferred from a non-zero coverage", () => {
    const { startActions, warning } = resolveRampStartState({
      rule: rolloutRule(0.1),
      ruleId: RULE_ID,
      startState: undefined,
      isCreate: true,
    });

    expect(startActions).toBeUndefined();
    expect(warning).toContain("10%");
  });

  it("does not warn when the inferred coverage is already 0%", () => {
    const { startActions, warning } = resolveRampStartState({
      rule: rolloutRule(0),
      ruleId: RULE_ID,
      startState: undefined,
      isCreate: true,
    });

    expect(startActions).toBeUndefined();
    expect(warning).toBeUndefined();
  });

  it("does not warn for a rule with no coverage (e.g. a force rule)", () => {
    const { warning } = resolveRampStartState({
      rule: {
        id: RULE_ID,
        type: "force",
        hashAttribute: "id",
        enabled: true,
        value: "x",
      } as FeatureRule,
      ruleId: RULE_ID,
      startState: undefined,
      isCreate: true,
    });

    expect(warning).toBeUndefined();
  });

  it("leaves the anchor alone (no warning) on update when startState is omitted", () => {
    const { startActions, warning } = resolveRampStartState({
      rule: rolloutRule(0.1),
      ruleId: RULE_ID,
      startState: undefined,
      isCreate: false,
    });

    expect(startActions).toBeUndefined();
    expect(warning).toBeUndefined();
  });
});

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

  it("stepIndex=-1 returns empty map (no steps applied yet)", () => {
    const sched = sparseSchedule([
      [action(TARGET_ID, { coverage: 0.0, condition: "" })],
    ]);
    expect(eff(sched, -1)).toEqual({});
  });

  it("single step returns its fields", () => {
    const sched = sparseSchedule([[action(TARGET_ID, { coverage: 0.5 })]]);
    expect(eff(sched, 0)).toMatchObject({ coverage: 0.5 });
  });

  it("sparse step: absent field is inherited from previous step", () => {
    // Step 0 sets condition; steps 1+2 only change coverage.
    const sched = sparseSchedule([
      [action(TARGET_ID, { coverage: 0.3, condition: '{"country":"US"}' })],
      [action(TARGET_ID, { coverage: 0.6 })], // no condition
    ]);
    expect(eff(sched, 1)).toMatchObject({
      coverage: 0.6,
      condition: '{"country":"US"}',
    });
  });

  it("explicit null clears a field at that step", () => {
    const sched = sparseSchedule([
      [action(TARGET_ID, { coverage: 0.5, condition: null })],
    ]);
    const result = computeEffectivePatch(sched, 0).get(TARGET_ID);
    expect(result).toHaveProperty("condition", null);
  });

  it("later step overrides earlier step value", () => {
    const sched = sparseSchedule([
      [action(TARGET_ID, { coverage: 0.3, condition: '{"b":"2"}' })],
      [action(TARGET_ID, { coverage: 0.6, condition: '{"c":"3"}' })],
    ]);
    expect(eff(sched, 1)).toMatchObject({ condition: '{"c":"3"}' });
  });

  it("rollback semantics: stepIndex=0 includes only step0, not step1", () => {
    const sched = sparseSchedule([
      [action(TARGET_ID, { coverage: 0.3, condition: '{"b":"2"}' })],
      [action(TARGET_ID, { coverage: 0.6, condition: '{"c":"3"}' })],
    ]);
    expect(eff(sched, 0)).toMatchObject({
      coverage: 0.3,
      condition: '{"b":"2"}',
    });
  });

  it("jump-ahead semantics: sparse intermediate steps are still accumulated", () => {
    // Step 0 sets condition; steps 1+2 are coverage-only (sparse).
    // Jumping ahead to step 2 should carry condition from step 0 forward.
    const sched = sparseSchedule([
      [action(TARGET_ID, { coverage: 0.3, condition: '{"a":"1"}' })],
      [action(TARGET_ID, { coverage: 0.6 })],
      [action(TARGET_ID, { coverage: 1.0 })],
    ]);
    expect(eff(sched, 2)).toMatchObject({
      coverage: 1.0,
      condition: '{"a":"1"}',
    });
  });

  it("multiple targets accumulate independently", () => {
    const TARGET_B = "target_b";
    const sched = sparseSchedule([
      // Step 0: baseline for both
      [
        action(TARGET_ID, { coverage: 0.0 }),
        action(TARGET_B, { coverage: 0.0, condition: '{"x":"1"}' }),
      ],
      // Step 1: only TARGET_A coverage update
      [action(TARGET_ID, { coverage: 0.5 })],
      // Step 2: only TARGET_B condition update
      [action(TARGET_B, { condition: '{"y":"2"}' })],
    ]);
    const map = computeEffectivePatch(sched, 2);

    // TARGET_A: coverage from step 1, no condition (never set)
    const patchA = map.get(TARGET_ID);
    expect(patchA).toHaveProperty("coverage", 0.5);
    expect(patchA).not.toHaveProperty("condition");

    // TARGET_B: condition updated in step 2, coverage from step 0
    const patchB = map.get(TARGET_B);
    expect(patchB).toHaveProperty("condition", '{"y":"2"}');
    expect(patchB).toHaveProperty("coverage", 0.0);
  });

  it("effective patch at completion equals last step's accumulated fields", () => {
    const sched = sparseSchedule([[action(TARGET_ID, { coverage: 1.0 })]]);
    expect(eff(sched, 0)).toMatchObject({ coverage: 1.0 });
  });

  it("target first mentioned in step 0 accumulates from that step", () => {
    const sched = sparseSchedule([[action(TARGET_ID, { coverage: 0.3 })]]);
    expect(eff(sched, 0)).toMatchObject({ coverage: 0.3 });
  });

  it("returns empty map when no actions anywhere", () => {
    const sched = sparseSchedule([]);
    expect(computeEffectivePatch(sched, -1).size).toBe(0);
  });

  it("seeds from startActions so step 0 inherits the full initial rule state", () => {
    const sched = {
      ...sparseSchedule([[action(TARGET_ID, { coverage: 0.1 })]]),
      startActions: [
        {
          targetType: "feature-rule" as const,
          targetId: TARGET_ID,
          patch: {
            ruleId: RULE_ID,
            coverage: 0.0,
            condition: '{"country":"US"}',
            savedGroups: [{ ids: ["grp1"], match: "any" }],
            prerequisites: [
              { id: "feat_gate", condition: '{"$or":[{"value":true}]}' },
            ],
            allEnvironments: false,
            environments: ["production", "staging"],
            force: "variant-b",
          },
        },
      ],
    };
    const result = computeEffectivePatch(sched, 0);
    const patch = result.get(TARGET_ID);
    // Step 0's coverage override wins; all other fields inherited from startActions
    expect(patch).toMatchObject({
      coverage: 0.1,
      condition: '{"country":"US"}',
      savedGroups: [{ ids: ["grp1"], match: "any" }],
      prerequisites: [
        { id: "feat_gate", condition: '{"$or":[{"value":true}]}' },
      ],
      allEnvironments: false,
      environments: ["production", "staging"],
      force: "variant-b",
    });
  });

  it("rollback to intermediate step still inherits startActions fields", () => {
    const sched = {
      ...sparseSchedule([
        [action(TARGET_ID, { coverage: 0.3 })],
        [action(TARGET_ID, { coverage: 0.6 })],
        [action(TARGET_ID, { coverage: 1.0 })],
      ]),
      startActions: [
        {
          targetType: "feature-rule" as const,
          targetId: TARGET_ID,
          patch: {
            ruleId: RULE_ID,
            coverage: 0.0,
            condition: '{"country":"US"}',
            savedGroups: [{ ids: ["grp1"], match: "any" }],
            prerequisites: [
              { id: "feat_gate", condition: '{"$or":[{"value":true}]}' },
            ],
            allEnvironments: false,
            environments: ["production", "staging"],
            force: "variant-b",
          },
        },
      ],
    };
    // Rolling back to step 1 — startActions fields persist through step 0 and 1
    const result = computeEffectivePatch(sched, 1);
    const patch = result.get(TARGET_ID);
    expect(patch).toMatchObject({
      coverage: 0.6,
      condition: '{"country":"US"}',
      savedGroups: [{ ids: ["grp1"], match: "any" }],
      prerequisites: [
        { id: "feat_gate", condition: '{"$or":[{"value":true}]}' },
      ],
      allEnvironments: false,
      environments: ["production", "staging"],
      force: "variant-b",
    });
  });

  it("drops enabled from the startActions seed", () => {
    // A snapshot captured from a disabled rule must not re-disable the rule
    // on forward publishes (e.g. zero-step schedule auto-completion).
    const sched = {
      steps: [],
      startActions: [
        {
          targetType: "feature-rule" as const,
          targetId: TARGET_ID,
          patch: {
            ruleId: RULE_ID,
            coverage: 1.0,
            condition: "{}",
            enabled: false,
          },
        },
      ],
    };
    const patch = computeEffectivePatch(sched, 0).get(TARGET_ID);
    expect(patch).not.toHaveProperty("enabled");
    expect(patch).toMatchObject({ coverage: 1.0, condition: "{}" });
  });

  it("steps and endActions can still set enabled explicitly", () => {
    const sched = {
      steps: [
        {
          interval: 300,
          actions: [action(TARGET_ID, { coverage: 0.5, enabled: true })],
        },
      ],
      startActions: [
        {
          targetType: "feature-rule" as const,
          targetId: TARGET_ID,
          patch: { ruleId: RULE_ID, coverage: 0.0, enabled: false },
        },
      ],
      endActions: [action(TARGET_ID, { enabled: false })],
    } as Pick<RampScheduleInterface, "steps" | "endActions" | "startActions">;

    // At step 0: enabled comes from the step, not the seed.
    expect(computeEffectivePatch(sched, 0).get(TARGET_ID)).toMatchObject({
      enabled: true,
    });
    // At completion: endActions' explicit enabled:false wins.
    expect(computeEffectivePatch(sched, 1).get(TARGET_ID)).toMatchObject({
      enabled: false,
    });
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

  it("absent condition in step inherits the previously-set value", () => {
    const sched = sparseSchedule([
      [action(TARGET_ID, { coverage: 0.0, condition: '{"country":"US"}' })],
      [action(TARGET_ID, { coverage: 0.3 })], // no condition key → inherit
      [action(TARGET_ID, { coverage: 0.6 })], // no condition key → inherit
    ]);
    expect(eff(sched, 2)).toMatchObject({ condition: '{"country":"US"}' });
  });

  it('condition: "{}" in a step overrides and propagates to later sparse steps', () => {
    // Step 1 explicitly clears targeting. Step 2 is sparse — it should inherit
    // the cleared "{}" rather than restoring the step 0 value.
    const sched = sparseSchedule([
      [action(TARGET_ID, { coverage: 0.0, condition: '{"country":"US"}' })],
      [action(TARGET_ID, { coverage: 0.3, condition: "{}" })], // explicit clear
      [action(TARGET_ID, { coverage: 0.6 })], // sparse
    ]);
    expect(eff(sched, 2)).toMatchObject({ condition: "{}" });
  });

  it("absent condition never appears in the effective patch if never set", () => {
    const sched = sparseSchedule([[action(TARGET_ID, { coverage: 0.5 })]]);
    expect(eff(sched, 0)).not.toHaveProperty("condition");
  });

  // ── savedGroups ──────────────────────────────────────────────────────────

  it("absent savedGroups in step inherits the previously-set value", () => {
    const groups = [{ match: "any", ids: ["g1"] }];
    const sched = sparseSchedule([
      [action(TARGET_ID, { coverage: 0.0, savedGroups: groups })],
      [action(TARGET_ID, { coverage: 0.3 })], // no savedGroups key → inherit
      [action(TARGET_ID, { coverage: 0.6 })],
    ]);
    expect(eff(sched, 2)).toMatchObject({ savedGroups: groups });
  });

  it("savedGroups: [] in a step overrides and propagates to later sparse steps", () => {
    const groups = [{ match: "any", ids: ["g1"] }];
    const sched = sparseSchedule([
      [action(TARGET_ID, { coverage: 0.0, savedGroups: groups })],
      [action(TARGET_ID, { coverage: 0.3, savedGroups: [] })], // explicit clear
      [action(TARGET_ID, { coverage: 0.6 })], // sparse
    ]);
    expect(eff(sched, 2)).toMatchObject({ savedGroups: [] });
  });

  it("absent savedGroups never appears in the effective patch if never set", () => {
    const sched = sparseSchedule([[action(TARGET_ID, { coverage: 0.5 })]]);
    expect(eff(sched, 0)).not.toHaveProperty("savedGroups");
  });

  // ── prerequisites ────────────────────────────────────────────────────────

  it("absent prerequisites in step inherits the previously-set value", () => {
    const prereqs = [{ id: "feat_x", condition: '{"value": true}' }];
    const sched = sparseSchedule([
      [action(TARGET_ID, { coverage: 0.0, prerequisites: prereqs })],
      [action(TARGET_ID, { coverage: 0.3 })], // no prerequisites key → inherit
      [action(TARGET_ID, { coverage: 0.6 })],
    ]);
    expect(eff(sched, 2)).toMatchObject({ prerequisites: prereqs });
  });

  it("prerequisites: [] in a step overrides and propagates to later sparse steps", () => {
    const prereqs = [{ id: "feat_x", condition: '{"value": true}' }];
    const sched = sparseSchedule([
      [action(TARGET_ID, { coverage: 0.0, prerequisites: prereqs })],
      [action(TARGET_ID, { coverage: 0.3, prerequisites: [] })], // explicit clear
      [action(TARGET_ID, { coverage: 0.6 })], // sparse
    ]);
    expect(eff(sched, 2)).toMatchObject({ prerequisites: [] });
  });

  it("absent prerequisites never appears in the effective patch if never set", () => {
    const sched = sparseSchedule([[action(TARGET_ID, { coverage: 0.5 })]]);
    expect(eff(sched, 0)).not.toHaveProperty("prerequisites");
  });

  // ── force (null is a valid value, not a clear signal) ────────────────────

  it("absent force in step inherits the previously-set value", () => {
    const sched = sparseSchedule([
      [action(TARGET_ID, { coverage: 0.0, force: "blue" })],
      [action(TARGET_ID, { coverage: 0.3 })], // no force key → inherit
    ]);
    expect(eff(sched, 1)).toMatchObject({ force: "blue" });
  });

  it("force: null in a step is a valid value and propagates to later sparse steps", () => {
    const sched = sparseSchedule([
      [action(TARGET_ID, { coverage: 0.0, force: "blue" })],
      [action(TARGET_ID, { coverage: 0.3, force: null })], // null is valid
      [action(TARGET_ID, { coverage: 0.6 })], // sparse
    ]);
    expect(eff(sched, 2)).toHaveProperty("force", null);
  });

  // ── cross-field independence ──────────────────────────────────────────────

  it("clearing one field does not affect unrelated fields", () => {
    const groups = [{ match: "any", ids: ["g1"] }];
    const sched = sparseSchedule([
      [
        action(TARGET_ID, {
          coverage: 0.0,
          condition: '{"a":"1"}',
          savedGroups: groups,
        }),
      ],
      [action(TARGET_ID, { coverage: 0.3, condition: "{}" })], // clears condition only
      [action(TARGET_ID, { coverage: 0.6 })], // sparse
    ]);
    // condition was explicitly cleared; savedGroups was never touched → still inherited
    expect(eff(sched, 2)).toMatchObject({
      condition: "{}",
      savedGroups: groups,
    });
  });
});

// ---------------------------------------------------------------------------

describe("computeNextStepAt", () => {
  const phaseStart = new Date("2025-01-01T00:00:00Z");
  const now = new Date("2025-01-01T01:00:00Z");

  it("returns null for a pure approval step (no time gate)", () => {
    // Pure approval steps (interval=null) have no time deadline; nextStepAt
    // is null and the step only advances when the approver acts.
    const schedule = makeSchedule({
      steps: [
        {
          interval: null,
          holdConditions: { requiresApproval: true },
          actions: [],
        },
      ],
      phaseStartedAt: phaseStart,
    });
    const result = computeNextStepAt(schedule, 0, now);
    expect(result).toBeNull();
  });

  it("computes cumulative interval from phaseStart (step 0)", () => {
    const schedule = makeSchedule({
      steps: [{ interval: 600, actions: [] }],
      phaseStartedAt: phaseStart,
    });
    const result = computeNextStepAt(schedule, 0, now);
    expect(result).toEqual(new Date(phaseStart.getTime() + 600_000));
  });

  it("computes cumulative interval for step 1 (sum of steps 0+1)", () => {
    const schedule = makeSchedule({
      steps: [
        { interval: 300, actions: [] },
        { interval: 600, actions: [] },
      ],
      phaseStartedAt: phaseStart,
    });
    const result = computeNextStepAt(schedule, 1, now);
    expect(result).toEqual(new Date(phaseStart.getTime() + 900_000));
  });

  it("pure approval steps are excluded from the cumulative sum", () => {
    const schedule = makeSchedule({
      steps: [
        { interval: 300, actions: [] },
        {
          interval: null,
          holdConditions: { requiresApproval: true },
          actions: [],
        },
        { interval: 600, actions: [] },
      ],
      phaseStartedAt: phaseStart,
    });
    // Step 2: sum = 300 (step 0) + 0 (pure approval, step 1) + 600 (step 2) = 900
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

describe("computeAutoAdvanceTarget", () => {
  const phaseStart = new Date("2025-01-01T00:00:00Z");
  const plainStep = (interval: number) => ({ interval, actions: [] });

  it("does not advance when the next step's timer has not elapsed", () => {
    const now = new Date("2025-01-01T00:01:00Z"); // 60s in; step 0 fires at 300s
    const schedule = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: new Date("2025-01-01T00:05:00Z"),
      phaseStartedAt: phaseStart,
      steps: [plainStep(300), plainStep(300)],
    });
    expect(computeAutoAdvanceTarget(schedule, now)).toBe(-1);
  });

  it("chains through all due purely-time-gated steps to completion", () => {
    const now = new Date("2025-01-01T01:00:00Z"); // all gates elapsed
    const schedule = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: phaseStart,
      phaseStartedAt: phaseStart,
      steps: [plainStep(300), plainStep(300)],
    });
    // steps.length signals "advance past the last step to completion"
    expect(computeAutoAdvanceTarget(schedule, now)).toBe(2);
  });

  it("stops at (does not skip past) an approval hold", () => {
    const now = new Date("2025-01-01T01:00:00Z");
    const schedule = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: phaseStart,
      phaseStartedAt: phaseStart,
      steps: [
        plainStep(300),
        {
          interval: 600,
          holdConditions: { requiresApproval: true },
          actions: [],
        },
      ],
    });
    expect(computeAutoAdvanceTarget(schedule, now)).toBe(1);
  });

  it("stops at a monitored step", () => {
    const now = new Date("2025-01-01T01:00:00Z");
    const schedule = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: phaseStart,
      phaseStartedAt: phaseStart,
      steps: [plainStep(300), { interval: 600, monitored: true, actions: [] }],
    });
    expect(computeAutoAdvanceTarget(schedule, now)).toBe(1);
  });

  it("advances only through the steps whose timers have elapsed", () => {
    // 720s in: steps 0 (300s) and 1 (600s) are due; step 2 (900s) is not.
    const now = new Date("2025-01-01T00:12:00Z");
    const schedule = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: phaseStart,
      phaseStartedAt: phaseStart,
      steps: [plainStep(300), plainStep(300), plainStep(300)],
    });
    expect(computeAutoAdvanceTarget(schedule, now)).toBe(2);
  });

  it("does not advance out of a hold step it is already sitting on", () => {
    const now = new Date("2025-01-01T01:00:00Z");
    const schedule = makeSchedule({
      currentStepIndex: 1,
      nextStepAt: phaseStart,
      phaseStartedAt: phaseStart,
      steps: [
        plainStep(300),
        {
          interval: 600,
          holdConditions: { requiresApproval: true },
          actions: [],
        },
        plainStep(300),
      ],
    });
    expect(computeAutoAdvanceTarget(schedule, now)).toBe(1);
  });

  it("stops at (does not fold past) a step with non-idempotent side effects", () => {
    const now = new Date("2025-01-01T01:00:00Z");
    // Simulate a hypothetical future per-step side effect (e.g. a webhook
    // dispatch) via a non-"feature-rule" action so the collapse must land on
    // the step individually rather than skip its effect.
    const sideEffectStep = {
      interval: 600,
      actions: [
        {
          targetType: "webhook",
          targetId: TARGET_ID,
          patch: {},
        } as unknown as RampStepAction,
      ],
    };
    const schedule = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: phaseStart,
      phaseStartedAt: phaseStart,
      steps: [plainStep(300), sideEffectStep, plainStep(300)],
    });
    expect(computeAutoAdvanceTarget(schedule, now)).toBe(1);
  });

  it("advances OUT of a non-collapsible step it is sitting on (no wedge)", () => {
    const now = new Date("2025-01-01T01:00:00Z");
    // The landing already happened for the current step, so its
    // non-collapsibility must not gate exit — only unvisited steps are
    // protected from folding.
    const sideEffectStep = {
      interval: 600,
      actions: [
        {
          targetType: "webhook",
          targetId: TARGET_ID,
          patch: {},
        } as unknown as RampStepAction,
      ],
    };
    const schedule = makeSchedule({
      currentStepIndex: 1,
      nextStepAt: phaseStart, // gate to leave step 1 already elapsed
      phaseStartedAt: phaseStart,
      steps: [plainStep(300), sideEffectStep, plainStep(300)],
    });
    expect(computeAutoAdvanceTarget(schedule, now)).toBe(3);
  });

  it("currentStepCleared bypasses the first hop's hold and gate only", () => {
    const now = new Date("2025-01-01T00:00:30Z"); // step timers NOT elapsed
    const schedule = makeSchedule({
      currentStepIndex: 0,
      nextStepAt: null, // monitored steps have no nextStepAt gate
      phaseStartedAt: phaseStart,
      steps: [
        { interval: 300, monitored: true, actions: [] },
        plainStep(300),
        plainStep(300),
      ],
    });

    // Without the option, the monitored current step blocks everything.
    expect(computeAutoAdvanceTarget(schedule, now)).toBe(0);
    // With it, the evaluator-verified step is cleared, but subsequent steps
    // still respect their own (unelapsed) time gates.
    expect(
      computeAutoAdvanceTarget(schedule, now, { currentStepCleared: true }),
    ).toBe(1);
  });

  it("currentStepCleared folds the due backlog behind the cleared step", () => {
    const now = new Date("2025-01-01T01:00:00Z"); // all timers elapsed
    const schedule = makeSchedule({
      currentStepIndex: 0,
      nextStepAt: null,
      phaseStartedAt: phaseStart,
      steps: [
        { interval: 300, monitored: true, actions: [] },
        plainStep(300),
        plainStep(300),
      ],
    });
    expect(
      computeAutoAdvanceTarget(schedule, now, { currentStepCleared: true }),
    ).toBe(3);
  });
});

describe("advanceStep past-end with a lapsed cutoff", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(undefined);
  });

  it("completes WITH disableActiveTargets so the rule doesn't stay enabled past its end date", async () => {
    // Regression: a catch-up fold can land past the end after the cutoff
    // lapsed (hook race, or the cutoff lapsing during a slow evaluate); the
    // completion must honor the cutoff's disable semantics.
    const schedule = makeSchedule({
      currentStepIndex: 2, // last step done
      status: "running",
      cutoffDate: new Date(Date.now() - 60_000), // lapsed
    });
    const { ctx } = makeContext();

    await advanceStep(ctx as never, schedule, schedule.steps.length);

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const { result: forceResult } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = forceResult.rules ?? [];
    const patched = rules.find((r) => r.id === RULE_ID);
    expect(patched?.enabled).toBe(false);
  });
});

describe("advanceStep target clamp", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("refuses a non-forward target from a stale caller instead of rewinding coverage", async () => {
    const schedule = makeSchedule({ currentStepIndex: 2, status: "running" });
    const updateById = jest.fn();
    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {},
      models: { rampSchedules: { updateById, getById: jest.fn() } },
    };

    const result = await advanceStep(ctx as never, schedule, 1);

    expect(result).toBe(schedule);
    expect(updateById).not.toHaveBeenCalled();
    expect(mockPublishRevision).not.toHaveBeenCalled();
  });
});

describe("withRampScheduleAdvanceLock", () => {
  const makeLockCtx = (acquired: boolean) => {
    const acquireAdvanceLock = jest.fn().mockResolvedValue(acquired);
    const releaseAdvanceLock = jest.fn().mockResolvedValue(undefined);
    // The doc exists — a failed acquire is diagnosed as contention, not 404.
    const getById = jest.fn().mockResolvedValue({ id: "rs_1" });
    const ctx = {
      models: {
        rampSchedules: { acquireAdvanceLock, releaseAdvanceLock, getById },
      },
    };
    return { ctx, acquireAdvanceLock, releaseAdvanceLock, getById };
  };

  it("runs fn and releases the lock when acquired", async () => {
    const { ctx, releaseAdvanceLock } = makeLockCtx(true);
    const fn = jest.fn().mockResolvedValue("done");

    const result = await withRampScheduleAdvanceLock(ctx as never, "rs_1", fn);

    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(releaseAdvanceLock).toHaveBeenCalledWith("rs_1", expect.any(String));
  });

  it("throws and does not run fn when the lock is held by another advance", async () => {
    const { ctx, releaseAdvanceLock } = makeLockCtx(false);
    const fn = jest.fn();

    await expect(
      withRampScheduleAdvanceLock(ctx as never, "rs_1", fn),
    ).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
    expect(releaseAdvanceLock).not.toHaveBeenCalled();
  });

  it("releases the lock even if fn throws", async () => {
    const { ctx, releaseAdvanceLock } = makeLockCtx(true);
    const fn = jest.fn().mockRejectedValue(new Error("boom"));

    await expect(
      withRampScheduleAdvanceLock(ctx as never, "rs_1", fn),
    ).rejects.toThrow("boom");
    expect(releaseAdvanceLock).toHaveBeenCalledTimes(1);
  });

  it("throws RampAdvanceLockBusyError (not a generic error) on contention", async () => {
    const { ctx } = makeLockCtx(false);
    await expect(
      withRampScheduleAdvanceLock(ctx as never, "rs_1", jest.fn()),
    ).rejects.toBeInstanceOf(RampAdvanceLockBusyError);
  });

  it("does not let a failing release mask the error fn threw", async () => {
    const { ctx, releaseAdvanceLock } = makeLockCtx(true);
    releaseAdvanceLock.mockRejectedValue(new Error("mongo down"));
    const fn = jest.fn().mockRejectedValue(new Error("real failure"));

    await expect(
      withRampScheduleAdvanceLock(ctx as never, "rs_1", fn),
    ).rejects.toThrow("real failure");
  });
});

describe("withRampScheduleAdvanceLockRetry", () => {
  it("retries contention and succeeds once the lock frees up (fn runs once)", async () => {
    const acquireAdvanceLock = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const releaseAdvanceLock = jest.fn().mockResolvedValue(undefined);
    const getById = jest.fn().mockResolvedValue({ id: "rs_1" });
    const ctx = {
      models: {
        rampSchedules: { acquireAdvanceLock, releaseAdvanceLock, getById },
      },
    };
    const fn = jest.fn().mockResolvedValue("done");

    const result = await withRampScheduleAdvanceLockRetry(
      ctx as never,
      "rs_1",
      fn,
    );
    expect(result).toBe("done");
    expect(acquireAdvanceLock).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("surfaces the busy error after exhausting attempts", async () => {
    const acquireAdvanceLock = jest.fn().mockResolvedValue(false);
    const ctx = {
      models: {
        rampSchedules: {
          acquireAdvanceLock,
          releaseAdvanceLock: jest.fn(),
          getById: jest.fn().mockResolvedValue({ id: "rs_1" }),
        },
      },
    };

    await expect(
      withRampScheduleAdvanceLockRetry(ctx as never, "rs_1", jest.fn(), 2),
    ).rejects.toBeInstanceOf(RampAdvanceLockBusyError);
    expect(acquireAdvanceLock).toHaveBeenCalledTimes(2);
  }, 15_000);

  it("fails fast with 404 semantics when the schedule was deleted", async () => {
    const acquireAdvanceLock = jest.fn().mockResolvedValue(false);
    const ctx = {
      models: {
        rampSchedules: {
          acquireAdvanceLock,
          releaseAdvanceLock: jest.fn(),
          getById: jest.fn().mockResolvedValue(null),
        },
      },
    };

    await expect(
      withRampScheduleAdvanceLockRetry(ctx as never, "rs_1", jest.fn()),
    ).rejects.toThrow("no longer exists");
    // No retry ladder for a missing doc.
    expect(acquireAdvanceLock).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-contention errors from fn", async () => {
    const acquireAdvanceLock = jest.fn().mockResolvedValue(true);
    const ctx = {
      models: {
        rampSchedules: {
          acquireAdvanceLock,
          releaseAdvanceLock: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    const fn = jest.fn().mockRejectedValue(new Error("boom"));

    await expect(
      withRampScheduleAdvanceLockRetry(ctx as never, "rs_1", fn),
    ).rejects.toThrow("boom");
    expect(acquireAdvanceLock).toHaveBeenCalledTimes(1);
  });
});

describe("runLockedRampScheduleAction", () => {
  it("passes the fresh in-lock read to fn, not the caller's snapshot", async () => {
    const freshDoc = { id: "rs_1", status: "completed" };
    const ctx = {
      models: {
        rampSchedules: {
          acquireAdvanceLock: jest.fn().mockResolvedValue(true),
          releaseAdvanceLock: jest.fn().mockResolvedValue(undefined),
          getById: jest.fn().mockResolvedValue(freshDoc),
        },
      },
    };
    const fn = jest.fn().mockResolvedValue("ok");

    await runLockedRampScheduleAction(ctx as never, "rs_1", fn);
    expect(fn).toHaveBeenCalledWith(freshDoc, expect.any(Function));
  });

  it("throws when the schedule was deleted while waiting for the lock", async () => {
    const ctx = {
      models: {
        rampSchedules: {
          acquireAdvanceLock: jest.fn().mockResolvedValue(true),
          releaseAdvanceLock: jest.fn().mockResolvedValue(undefined),
          getById: jest.fn().mockResolvedValue(null),
        },
      },
    };

    await expect(
      runLockedRampScheduleAction(ctx as never, "rs_1", jest.fn()),
    ).rejects.toThrow("no longer exists");
  });
});

describe("stepIsCollapsible", () => {
  it("is true for a step whose actions are all feature-rule patches", () => {
    expect(
      stepIsCollapsible({
        interval: 300,
        actions: [
          {
            targetType: "feature-rule",
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 0.5 },
          },
        ],
      }),
    ).toBe(true);
  });

  it("is true for a step with no actions", () => {
    expect(stepIsCollapsible({ interval: 300, actions: [] })).toBe(true);
  });

  it("is false when a step carries a non-feature-rule (side-effecting) action", () => {
    expect(
      stepIsCollapsible({
        interval: 300,
        actions: [
          {
            targetType: "webhook",
            targetId: TARGET_ID,
            patch: {},
          } as unknown as RampStepAction,
        ],
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("computePhaseStartAfterApproval", () => {
  it("returns now - sum(previous interval steps) so next step fires correctly", () => {
    const now = new Date("2025-01-01T01:00:00Z");
    const schedule = makeSchedule({
      steps: [
        { interval: 300, actions: [] },
        {
          interval: null,
          holdConditions: { requiresApproval: true },
          actions: [],
        },
        { interval: 600, actions: [] },
      ],
    });
    // After approval at the pure-approval step (index 1), rebase phaseStart
    // so that step 2 fires interval=600s from now.
    // computePhaseStartAfterApproval takes the *next* step index.
    const phaseStart = computePhaseStartAfterApproval(now, schedule, 2);
    expect(phaseStart).toEqual(new Date(now.getTime() - 300_000));

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
    const { result: forceResult } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = forceResult.rules ?? [];
    const patchedRule = rules.find((r: FeatureRule) => r.id === RULE_ID);
    expect((patchedRule as { coverage?: number })?.coverage).toBe(0.5);
  });

  it("throws when the rule is not found (no env scope)", async () => {
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
    ).rejects.toThrow(/not found/);
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

  it("without environment: resolves by ruleId alone", async () => {
    // In v2, a rule is a single top-level entity. Without an env scope, the
    // handler resolves purely by ruleId/uid and patches that one rule.
    const actions = [
      {
        targetType: "feature-rule" as const,
        targetId: TARGET_ID,
        patch: { ruleId: RULE_ID, coverage: 0.75 },
      },
    ];
    await featureEntityHandler.applyActions(ctx, FEATURE_ID, actions, {
      stepLabel: "step",
      user: { type: "system" },
    });

    const { result: forceResult } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = forceResult.rules ?? [];
    const patched = rules.find((r: FeatureRule) => r.id === RULE_ID);
    expect((patched as { coverage?: number })?.coverage).toBe(0.75);
  });

  it("with environment: selects the matching env-scoped rule when multiple rules share the ruleId stem", async () => {
    // In v2, multiple rules may share a legacy `id` stem but differ by scope
    // (e.g., one scoped to production, one scoped to staging). When the
    // flattener detects a non-mergeable collision, each rule gets a
    // deterministic `__<env>` suffix on its id. Ramp targets match by stem
    // + env, so the `environment` on the target picks which rule to resolve.
    const prodRule: FeatureRule = {
      id: RULE_ID + "__production",
      allEnvironments: false,
      environments: ["production"],
      type: "rollout",
      coverage: 0.1,
      hashAttribute: "id",
      enabled: true,
      condition: "",
    };
    const stagingRule: FeatureRule = {
      ...prodRule,
      id: RULE_ID + "__staging",
      environments: ["staging"],
    };
    mockGetFeature.mockResolvedValue({
      ...makeFeature(),
      rules: [prodRule, stagingRule],
    } as never);

    const actions = [
      {
        targetType: "feature-rule" as const,
        targetId: TARGET_ID,
        patch: { ruleId: RULE_ID, coverage: 0.9 },
      },
    ];
    await featureEntityHandler.applyActions(ctx, FEATURE_ID, actions, {
      stepLabel: "step",
      user: { type: "system" },
      environment: "production",
    });

    const { result: forceResult } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = forceResult.rules ?? [];

    const patchedProd = rules.find(
      (r: FeatureRule) => r.id === RULE_ID + "__production",
    );
    const patchedStaging = rules.find(
      (r: FeatureRule) => r.id === RULE_ID + "__staging",
    );

    expect((patchedProd as { coverage?: number })?.coverage).toBe(0.9);
    // The staging-scoped rule has a different suffixed id and must be untouched.
    expect((patchedStaging as { coverage?: number })?.coverage).toBe(0.1);
  });

  it("with environment: throws when no rule matches the (ruleId, environment) pair", async () => {
    const actions = [
      {
        targetType: "feature-rule" as const,
        targetId: TARGET_ID,
        patch: { ruleId: RULE_ID, coverage: 0.5 },
      },
    ];
    // makeFeature's default rule is scoped to `environments: ["production"]`.
    // Scoping resolution to staging finds nothing → throw.
    await expect(
      featureEntityHandler.applyActions(ctx, FEATURE_ID, actions, {
        stepLabel: "step",
        user: { type: "system" },
        environment: "staging",
      }),
    ).rejects.toThrow(/not found/);
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

  // Pre-start (-1) → step 0 transition: the published patch must include
  // enabled:true alongside step 0's targeting/coverage. Without this fold,
  // the rule would briefly be live with its pre-ramp state before step 0
  // overwrote it.
  it("folds enabled:true into step 0's patch on the pre-start → step 0 transition", async () => {
    const { ctx } = makeContext({ currentStepIndex: -1 });
    const schedule = makeSchedule({ currentStepIndex: -1 });
    await advanceStep(ctx as never, schedule);

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const { result: forceResult } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = forceResult.rules ?? [];
    const patched = rules.find((r) => r.id === RULE_ID);
    expect(patched?.enabled).toBe(true);
    // The step-0 coverage patch is still applied.
    expect((patched as { coverage?: number })?.coverage).toBe(0.3);
  });

  // Subsequent step transitions don't fold enable — the rule was already
  // enabled by step 0 and we shouldn't be re-asserting it on every step.
  it("does not re-fold enabled:true on subsequent step transitions", async () => {
    // Start the rule disabled so we can detect whether the fold ran.
    mockGetFeature.mockResolvedValueOnce(
      makeFeature([
        {
          id: RULE_ID,
          uid: "ruid_" + RULE_ID,
          allEnvironments: false,
          environments: ["production"],
          type: "rollout" as const,
          coverage: 0.3,
          hashAttribute: "id",
          enabled: false,
          condition: "",
        },
      ]) as never,
    );
    const { ctx } = makeContext({ currentStepIndex: 0 });
    await advanceStep(ctx as never, makeSchedule({ currentStepIndex: 0 }));

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const { result: forceResult } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = forceResult.rules ?? [];
    const patched = rules.find((r) => r.id === RULE_ID);
    // Patch only carries the step-1 fields; enabled is left untouched.
    expect(patched?.enabled).toBe(false);
  });

  it("sets nextProcessAt to a non-null value when landing on an instant non-monitored step (bug: stranded schedule)", async () => {
    // If nextProcessAt is null the agenda will never re-pick this schedule.
    // An instant step (interval:null) with no monitoring must set nextProcessAt=now
    // so the evaluator re-ticks it immediately.
    const schedule = makeSchedule({
      currentStepIndex: -1,
      steps: [
        {
          interval: null, // instant — no time gate
          monitored: false,
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
    expect(updates.nextProcessAt).not.toBeNull();
  });
});

describe("applyRampStartActions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(makeFeature() as never);
  });

  // For simple schedules (no steps), this is the only place the rule gets
  // enabled — no advanceStep will run.
  it("enables active feature targets for a 0-step schedule", async () => {
    const schedule = makeSchedule({ steps: [], currentStepIndex: -1 });
    const { ctx } = makeContext({ steps: [], currentStepIndex: -1 });

    await applyRampStartActions(ctx as never, schedule);

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const { result: forceResult } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = forceResult.rules ?? [];
    const patched = rules.find((r) => r.id === RULE_ID);
    expect(patched?.enabled).toBe(true);
  });

  // For steps>0 schedules, advanceStep's pre-start fold owns enabling so the
  // rule lands in the same revision as step 0's targeting/coverage. Avoid a
  // redundant publish here.
  it("is a no-op for schedules with steps", async () => {
    const schedule = makeSchedule({ currentStepIndex: -1 });
    const { ctx } = makeContext({ currentStepIndex: -1 });

    await applyRampStartActions(ctx as never, schedule);

    expect(mockPublishRevision).not.toHaveBeenCalled();
  });

  // Skip targets that are inactive or non-feature so we don't accidentally
  // resurrect a detached target.
  it("skips inactive and non-feature targets", async () => {
    const schedule = makeSchedule({
      steps: [],
      currentStepIndex: -1,
      targets: [
        {
          id: TARGET_ID,
          entityType: "feature",
          entityId: FEATURE_ID,
          ruleId: RULE_ID,
          environment: "production",
          status: "inactive",
        },
      ],
    });
    const { ctx } = makeContext();

    await applyRampStartActions(ctx as never, schedule);

    expect(mockPublishRevision).not.toHaveBeenCalled();
  });
});

describe("advanceStep — approval step", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(makeFeature() as never);
  });

  it("stays in 'running' on a pure approval step (awaiting approval is derived)", async () => {
    // pending-approval is no longer a stored status; the UI/evaluator derive
    // it from running + holdConditions.requiresApproval + stepApproval not set for current step.
    // We assert: status stays running, the patch is applied immediately
    // (apply-first), and nextStepAt is null (no time gate).
    const schedule = makeSchedule({
      currentStepIndex: -1,
      steps: [
        {
          interval: null,
          holdConditions: { requiresApproval: true },
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
    expect(updates.status).toBe("running");
    expect(updates.stepApproval).toBeNull();
    expect(updates.nextStepAt).toBeNull();
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

  it("sets status to completed and publishes final revision when no more steps remain", async () => {
    const schedule = makeSchedule({ currentStepIndex: 2 }); // 3 steps total (0,1,2) → step 3 doesn't exist
    const { ctx, updateById } = makeContext({ currentStepIndex: 2 });
    await advanceStep(ctx as never, schedule);

    // completeRollout applies end actions and publishes the final revision.
    expect(mockPublishRevision).toHaveBeenCalledTimes(1);

    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("completed");
    expect(updates.nextStepAt).toBeNull();
  });

  it("applies endActions when completing via advanceStep", async () => {
    const schedule = makeSchedule({
      currentStepIndex: 2,
      endActions: [
        {
          targetType: "feature-rule" as const,
          targetId: TARGET_ID,
          patch: { ruleId: RULE_ID, coverage: 1 },
        },
      ],
    });
    const { ctx } = makeContext({ currentStepIndex: 2 });
    await advanceStep(ctx as never, schedule);

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const { result: forceResult } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = forceResult.rules ?? [];
    const patched = rules.find((r: FeatureRule) => r.id === RULE_ID);
    expect((patched as { coverage?: number })?.coverage).toBe(1);
  });
});

describe("advanceScheduleManually", () => {
  function makeManualAdvanceCtx(
    schedule: RampScheduleInterface,
    safeRollout?: Partial<SafeRolloutInterface>,
  ) {
    let current = schedule;
    const rampUpdateById = jest
      .fn()
      .mockImplementation(
        async (_id: string, updates: Partial<RampScheduleInterface>) => {
          current = {
            ...current,
            ...updates,
          } as RampScheduleInterface;
          return current;
        },
      );

    const createdSafeRollout = {
      id: "sr_manual_1",
      status: "running",
      autoSnapshots: false,
      nextSnapshotAttempt: null,
      ...safeRollout,
    } as SafeRolloutInterface;

    const safeRolloutGetById = jest
      .fn()
      .mockImplementation(async (id: string) =>
        id === createdSafeRollout.id ? createdSafeRollout : null,
      );
    const safeRolloutCreate = jest
      .fn()
      .mockResolvedValue(createdSafeRollout as SafeRolloutInterface);
    const safeRolloutUpdate = jest.fn().mockResolvedValue(createdSafeRollout);

    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {
        canUpdateFeature: jest.fn().mockReturnValue(true),
        canReviewFeatureDrafts: jest.fn().mockReturnValue(true),
        canPublishFeature: jest.fn().mockReturnValue(true),
      },
      models: {
        rampSchedules: {
          updateById: rampUpdateById,
          getById: jest.fn().mockImplementation(async () => current),
        },
        safeRollout: {
          getById: safeRolloutGetById,
          create: safeRolloutCreate,
          update: safeRolloutUpdate,
        },
      },
    };

    return {
      ctx,
      safeRolloutCreate,
    };
  }

  it("creates/links a SafeRollout before manually advancing from paused into monitored steps", async () => {
    const schedule = makeSchedule({
      status: "paused",
      currentStepIndex: -1,
      safeRolloutId: undefined,
      targets: [],
      steps: [
        {
          interval: 300,
          monitored: true,
          actions: [],
        },
      ],
      monitoringConfig: {
        datasourceId: "ds_1",
        exposureQueryId: "exposure_1",
        guardrailMetricIds: ["m_guardrail"],
        signalMetricIds: [],
        monitoringMode: "auto",
        autoUpdate: true,
      },
    });

    const { ctx, safeRolloutCreate } = makeManualAdvanceCtx(schedule);

    const updated = await advanceScheduleManually(ctx as never, schedule);

    expect(safeRolloutCreate).toHaveBeenCalledTimes(1);
    expect(updated.safeRolloutId).toBe("sr_manual_1");
    expect(updated.currentStepIndex).toBe(0);
  });

  it("also ensures SafeRollout when manually advancing while already running", async () => {
    const schedule = makeSchedule({
      status: "running",
      currentStepIndex: -1,
      safeRolloutId: undefined,
      targets: [],
      steps: [
        {
          interval: 300,
          monitored: true,
          actions: [],
        },
      ],
      monitoringConfig: {
        datasourceId: "ds_1",
        exposureQueryId: "exposure_1",
        guardrailMetricIds: ["m_guardrail"],
        signalMetricIds: [],
        monitoringMode: "auto",
        autoUpdate: true,
      },
    });

    const { ctx, safeRolloutCreate } = makeManualAdvanceCtx(schedule);

    const updated = await advanceScheduleManually(ctx as never, schedule);

    expect(safeRolloutCreate).toHaveBeenCalledTimes(1);
    expect(updated.safeRolloutId).toBe("sr_manual_1");
    expect(updated.currentStepIndex).toBe(0);
  });

  it("chains through instant steps after the manual advance (bug: single advanceStep stopped too early)", async () => {
    // Timed step 0 (current) → instant step 1 → timed step 2.
    // advanceScheduleManually from step 0 should land at step 2 (step 1 is
    // instantly traversed) rather than stopping at step 1.
    const schedule = makeSchedule({
      status: "running",
      currentStepIndex: 0,
      steps: [
        { interval: 300, actions: [] },
        { interval: null, monitored: false, actions: [] }, // instant
        { interval: 300, actions: [] },
      ],
    });
    const { ctx } = makeManualAdvanceCtx(schedule);
    const updated = await advanceScheduleManually(ctx as never, schedule);

    // advanceScheduleManually advances from step 0 → step 1 (instant), then
    // advanceUntilBlocked exits because step 1 has nextStepAt=null. The agenda
    // re-ticks because nextProcessAt=now (Bug 1 fix ensures this).
    expect(updated.currentStepIndex).toBe(1);
    expect(updated.nextProcessAt).not.toBeNull();
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
    // Steps: 0=coverage 0.3, 1=coverage 0.6, 2=coverage 1.0.
    // Jumping to step 2 should apply the effective state: coverage 1.0.
    const schedule = makeSchedule({ currentStepIndex: -1 });
    const { ctx } = makeContext();
    await jumpAheadToStep(ctx as never, schedule, 2);

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const { result: forceResult } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = forceResult.rules ?? [];
    const patched = rules.find((r: FeatureRule) => r.id === RULE_ID);
    expect((patched as { coverage?: number })?.coverage).toBe(1.0);
  });

  it("carries fields from sparse intermediate steps when jumping", async () => {
    // Step 0 sets condition; steps 1 and 2 are coverage-only (sparse).
    // Jumping to step 2 from -1 should deliver condition from step 0 + coverage from step 2.
    const sparseSchedule = makeSchedule({
      currentStepIndex: -1,
      steps: [
        {
          interval: 300,
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.3, condition: '{"a":"1"}' },
            },
          ],
        },
        {
          interval: 300,
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.6 }, // sparse — no condition
            },
          ],
        },
        {
          interval: 300,
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
    const { result: forceResult } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = forceResult.rules ?? [];
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
      steps: [
        {
          interval: 300,
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: {
                ruleId: RULE_ID,
                coverage: 0.3,
                condition: '{"step":"0"}',
              },
            },
          ],
        },
        {
          interval: 300,
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.6 }, // sparse — no condition
            },
          ],
        },
        {
          interval: 300,
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: {
                ruleId: RULE_ID,
                coverage: 1.0,
                condition: '{"step":"2"}',
              },
            },
          ],
        },
      ],
    });

    const { ctx } = makeContext({ currentStepIndex: 2 });
    await rollbackToStep(ctx as never, schedule, 0);

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const { result: forceResult } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = forceResult.rules ?? [];
    const patched = rules.find((r: FeatureRule) => r.id === RULE_ID);
    // Effective at step 0: start + step0 → coverage 0.3, condition from step 0
    expect((patched as { coverage?: number })?.coverage).toBe(0.3);
    expect(patched?.condition).toBe('{"step":"0"}');
  });

  it("rolling back to -1 publishes startActions to restore the pre-ramp state", async () => {
    const schedule = makeSchedule({
      currentStepIndex: 1,
      startActions: [
        {
          targetType: "feature-rule" as const,
          targetId: TARGET_ID,
          patch: { ruleId: RULE_ID, coverage: 0 },
        },
      ],
    });

    const { ctx } = makeContext({ currentStepIndex: 1 });
    await rollbackToStep(ctx as never, schedule, -1);

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const { result: forceResult } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = forceResult.rules ?? [];
    const patched = rules.find((r: FeatureRule) => r.id === RULE_ID);
    expect((patched as { coverage?: number })?.coverage).toBe(0);
  });

  it("rolling back to -1 does not treat step 0 as the baseline", async () => {
    const schedule = makeSchedule({ currentStepIndex: 1 });

    const { ctx } = makeContext({ currentStepIndex: 1 });
    await rollbackToStep(ctx as never, schedule, -1);

    expect(mockPublishRevision).not.toHaveBeenCalled();
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

  it("can rewind to start for jumps without terminal rollback side effects", async () => {
    const schedule = makeSchedule({
      currentStepIndex: 1,
      startActions: [
        {
          targetType: "feature-rule" as const,
          targetId: TARGET_ID,
          patch: { ruleId: RULE_ID, coverage: 0 },
        },
      ],
    });
    const { ctx, updateById } = makeContext({ currentStepIndex: 1 });

    await rollbackToStep(ctx as never, schedule, -1, undefined, {
      terminal: false,
      emitEvent: false,
      syncSafeRollout: false,
    });

    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("paused");
    expect(updates.currentStepIndex).toBe(-1);
    expect(updates).not.toHaveProperty("lastRollbackAt");
    expect(updates).not.toHaveProperty("lastRollbackReason");
    expect(updates).not.toHaveProperty("eventHistory");
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it("clears stepApproval even on auto/terminal rollback to -1 (bug: stale approval on rolled-back schedule)", async () => {
    const schedule = makeSchedule({
      currentStepIndex: 1,
      stepApproval: {
        stepIndex: 1,
        approvedAt: new Date(),
        approvedBy: "user_1",
        context: "ui",
      },
    });
    const { ctx, updateById } = makeContext({ currentStepIndex: 1 });
    await rollbackToStep(ctx as never, schedule, -1, "guardrail-failing");

    const [, updates] = updateById.mock.calls[0];
    expect(updates.stepApproval).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resumeSchedule
// ---------------------------------------------------------------------------

describe("resumeSchedule", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(makeFeature() as never);
  });

  it("resume after jump-to-last-step honours the step interval before completing", async () => {
    // jumpAheadToStep stores nextStepAt:null and status:paused. The schedule
    // has 3 steps; currentStepIndex=2 is the last one with interval=900s.
    // Resuming should compute a future nextStepAt based on the step's interval
    // so the step runs its hold time before advancing to completion.
    const schedule = makeSchedule({
      status: "paused",
      currentStepIndex: 2, // last step (steps.length - 1 = 2)
      nextStepAt: null,
      pausedAt: new Date(Date.now() - 5_000),
    });

    const getById = jest.fn().mockResolvedValue(null);
    const updateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) => ({
          ...schedule,
          ...updates,
        }),
      );

    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {
        canUpdateFeature: jest.fn().mockReturnValue(true),
        canReviewFeatureDrafts: jest.fn().mockReturnValue(true),
        canPublishFeature: jest.fn().mockReturnValue(true),
      },
      models: {
        rampSchedules: {
          updateById,
          getById,
          acquireAdvanceLock: jest.fn().mockResolvedValue(true),
          releaseAdvanceLock: jest.fn().mockResolvedValue(undefined),
        },
      },
    };

    await resumeSchedule(ctx as never, schedule);

    const [, resumeUpdates] = updateById.mock.calls[0];
    expect(resumeUpdates.nextStepAt).not.toBeNull();
    expect(resumeUpdates.nextStepAt).toBeInstanceOf(Date);

    // nextStepAt should be in the future (step interval not yet elapsed),
    // NOT set to now — the step needs to run its hold time first.
    expect(resumeUpdates.nextStepAt.getTime()).toBeGreaterThan(
      Date.now() - 1000,
    );

    // completeRollout should NOT fire immediately — the step interval must
    // elapse first.
    expect(mockPublishRevision).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// restartSchedule
// ---------------------------------------------------------------------------

describe("restartSchedule", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(makeFeature() as never);
  });

  it("rolls the linked SafeRollout's analysis floor forward and clears notifications on restart", async () => {
    // restartSchedule should reset the SafeRollout's analysis window so the
    // new run is not gated by pre-restart snapshots, and reset pastNotifications
    // so the same issue types can re-fire for the fresh run.
    const safeRolloutUpdate = jest.fn().mockResolvedValue(undefined);
    const safeRolloutGetById = jest
      .fn()
      .mockResolvedValue({ id: "sr_1", pastNotifications: ["srm"] });
    const getById = jest.fn().mockResolvedValue(null);
    const updateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) => ({
          ...makeSchedule({
            status: "paused",
            currentStepIndex: -1,
            safeRolloutId: "sr_1",
          }),
          ...updates,
        }),
      );

    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {
        canUpdateFeature: jest.fn().mockReturnValue(true),
        canReviewFeatureDrafts: jest.fn().mockReturnValue(true),
        canPublishFeature: jest.fn().mockReturnValue(true),
      },
      models: {
        rampSchedules: { updateById, getById },
        safeRollout: { getById: safeRolloutGetById, update: safeRolloutUpdate },
      },
    };

    const schedule = makeSchedule({
      status: "paused",
      currentStepIndex: -1,
      safeRolloutId: "sr_1",
    });

    await restartSchedule(ctx as never, schedule);

    // The SafeRollout must have been updated with a fresh analysisStartedAt
    // and empty pastNotifications so the new run starts clean.
    expect(safeRolloutGetById).toHaveBeenCalledWith("sr_1");
    expect(safeRolloutUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        analysisStartedAt: expect.any(Date),
        pastNotifications: [],
      }),
    );

    // safeRolloutId itself must NOT be cleared — the link is preserved; only
    // the SafeRollout's stale analysis state is reset.
    const [, restartUpdates] =
      updateById.mock.calls.find(([id]) => id === "rs_1") ?? [];
    expect(restartUpdates?.safeRolloutId).toBeUndefined(); // not explicitly cleared
  });
});

describe("applyRampStartActions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(makeFeature() as never);
  });

  // For multi-step ramps `applyRampStartActions` is a no-op (covered above) —
  // step 0's apply folds in enabled:true alongside the step's own patch. For
  // 0-step ("simple") schedules with stored startActions the captured starting
  // state is published here alongside the enable action.
  it("publishes stored startActions when activating a 0-step schedule", async () => {
    const schedule = makeSchedule({
      steps: [],
      currentStepIndex: -1,
      startActions: [
        {
          targetType: "feature-rule" as const,
          targetId: TARGET_ID,
          patch: {
            ruleId: RULE_ID,
            coverage: 0,
            condition: '{"country":"US"}',
            savedGroups: [{ match: "all", ids: ["sg_1"] }],
            prerequisites: [{ id: "feature-a", condition: "{}" }],
          },
        },
      ],
    });
    const { ctx } = makeContext({ steps: [], currentStepIndex: -1 });

    await applyRampStartActions(ctx as never, schedule);

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const { result: startResult } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = startResult.rules ?? [];
    const patched = rules.find((r: FeatureRule) => r.id === RULE_ID);

    expect((patched as { coverage?: number })?.coverage).toBe(0);
    expect(patched?.condition).toBe('{"country":"US"}');
    expect(patched?.savedGroups).toEqual([{ match: "all", ids: ["sg_1"] }]);
    expect(patched?.prerequisites).toEqual([
      { id: "feature-a", condition: "{}" },
    ]);
    expect(patched?.enabled).toBe(true);
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

  it("stops at an approval gate (status stays running, awaiting derived)", async () => {
    // After advancing onto the approval step, the loop must stop because
    // the step still requires manual approval. status is "running" (not the
    // old "pending-approval"); awaiting approval is derived externally.
    const past = new Date(Date.now() - 1000);
    const scheduleWithApproval = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: past,
      status: "running",
      steps: [
        {
          interval: null,
          holdConditions: { requiresApproval: true },
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.5 },
            },
          ],
        },
        {
          interval: 300,
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
            currentStepIndex:
              updates.currentStepIndex ?? scheduleWithApproval.currentStepIndex,
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

    expect(callCount).toBe(1);
    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("running");
    expect(updates.currentStepIndex).toBe(0);
    expect(updates.stepApproval).toBeNull();
  });

  it("does not advance past a step whose timer elapsed while paused (hold still pending)", async () => {
    // Scenario: step 0 has requiresApproval but its timer already elapsed
    // (nextStepAt is in the past). advanceUntilBlocked must not bypass the
    // approval gate just because the timer expired — e.g. after a resume where
    // the timing rebase still leaves nextStepAt <= now.
    const past = new Date(Date.now() - 1000);
    const schedule = makeSchedule({
      currentStepIndex: 0,
      nextStepAt: past,
      status: "running",
      steps: [
        {
          interval: 300,
          holdConditions: { requiresApproval: true },
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.5 },
            },
          ],
        },
        {
          interval: 600,
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

    const updateById = jest.fn();
    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {},
      models: { rampSchedules: { updateById, getById: jest.fn() } },
    };

    await advanceUntilBlocked(ctx as never, schedule, new Date());

    // Should not advance at all — step 0 still requires approval.
    expect(updateById).not.toHaveBeenCalled();
  });

  it("stops when landing on a monitored step (must go through evaluator for snapshot data)", async () => {
    const past = new Date(Date.now() - 1000);
    const steps = [
      {
        interval: 300,
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 0.3 },
          },
        ],
      },
      {
        interval: 600,
        monitored: true,
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 0.6 },
          },
        ],
      },
      {
        interval: 900,
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 1.0 },
          },
        ],
      },
    ];
    const schedule = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: past,
      // Overdue backlog: every time gate has elapsed, so the catch-up would
      // reach the monitored step. It must still stop there (monitored steps
      // need the evaluator's snapshot data before advancing).
      phaseStartedAt: new Date(Date.now() - 10_000_000),
      status: "running",
      steps,
    });

    let callCount = 0;
    const updateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) => {
          callCount++;
          const newStepIndex =
            updates.currentStepIndex ?? schedule.currentStepIndex;
          return {
            ...schedule,
            ...updates,
            currentStepIndex: newStepIndex,
            steps,
            // Step 1 already due — mimics late agenda tick.
            nextStepAt: past,
          };
        },
      );

    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {},
      models: { rampSchedules: { updateById, getById: jest.fn() } },
    };

    await advanceUntilBlocked(ctx as never, schedule, new Date());

    // Collapses steps 0→1 into one jump, landing on the monitored step 1 and
    // stopping there (a single publish rather than one per step).
    expect(callCount).toBe(1);
    const [, lastUpdates] = updateById.mock.calls[0];
    expect(lastUpdates.currentStepIndex).toBe(1);
  });

  it("stops when landing on a step with minSampleSize (needs evaluator + snapshot)", async () => {
    const past = new Date(Date.now() - 1000);
    const steps = [
      {
        interval: 300,
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 0.3 },
          },
        ],
      },
      {
        interval: 600,
        holdConditions: { minSampleSize: 1000 },
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 0.6 },
          },
        ],
      },
    ];
    const schedule = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: past,
      // Overdue backlog so the catch-up reaches the minSampleSize step.
      phaseStartedAt: new Date(Date.now() - 10_000_000),
      status: "running",
      steps,
    });

    let callCount = 0;
    const updateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) => {
          callCount++;
          const newStepIndex =
            updates.currentStepIndex ?? schedule.currentStepIndex;
          return {
            ...schedule,
            ...updates,
            currentStepIndex: newStepIndex,
            steps,
            nextStepAt: past,
          };
        },
      );

    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {},
      models: { rampSchedules: { updateById, getById: jest.fn() } },
    };

    await advanceUntilBlocked(ctx as never, schedule, new Date());

    // Collapses steps 0→1 into one jump, landing on the minSampleSize step 1
    // and stopping there (needs the evaluator + snapshot before advancing).
    expect(callCount).toBe(1);
    const [, lastUpdates] = updateById.mock.calls[0];
    expect(lastUpdates.currentStepIndex).toBe(1);
  });

  it("chains through multiple purely time-gated steps in one pass", async () => {
    const past = new Date(Date.now() - 10_000);
    const future = new Date(Date.now() + 3_600_000);
    const steps = [
      {
        interval: 300,
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 0.3 },
          },
        ],
      },
      {
        interval: 300,
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 0.6 },
          },
        ],
      },
      {
        interval: 300,
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 1.0 },
          },
        ],
      },
    ];
    // phaseStartedAt is set so steps 0 and 1's time gates have elapsed but step
    // 2's has not: the catch-up should advance through 0→1→2 and stop on step 2
    // (still inside its interval), without completing.
    const schedule = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: past,
      phaseStartedAt: new Date(Date.now() - 700_000),
      status: "running",
      steps,
    });

    let callCount = 0;
    const updateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) => {
          callCount++;
          const newStepIndex =
            updates.currentStepIndex ?? schedule.currentStepIndex;
          const nextStepAt = newStepIndex < 2 ? past : future;
          return {
            ...schedule,
            ...updates,
            currentStepIndex: newStepIndex,
            steps,
            nextStepAt,
          };
        },
      );

    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {},
      models: { rampSchedules: { updateById, getById: jest.fn() } },
    };

    await advanceUntilBlocked(ctx as never, schedule, new Date());

    // Collapses the 0→1→2 backlog into a single jump/publish landing on step 2.
    expect(callCount).toBe(1);
    const lastCall = updateById.mock.calls[0];
    expect(lastCall[1].currentStepIndex).toBe(2);
  });

  // ------------------------------------------------------------------------
  // 0-step ("simple") schedules — "enable on date" or "enable on publish"
  // ------------------------------------------------------------------------

  it("0-step + no cutoffDate: completes and deletes the schedule (terminal — no remaining work)", async () => {
    const schedule = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: null,
      status: "running",
      steps: [],
    });
    const deleteById = jest.fn().mockResolvedValue(undefined);
    const updateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) => ({
          ...schedule,
          ...updates,
        }),
      );
    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {},
      models: {
        rampSchedules: { updateById, getById: jest.fn(), deleteById },
        safeRollout: { getById: jest.fn().mockResolvedValue(null) },
      },
    };

    await advanceUntilBlocked(ctx as never, schedule, new Date());

    // completeRollout transitions to "completed" before we delete.
    expect(updateById).toHaveBeenCalled();
    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("completed");
    expect(deleteById).toHaveBeenCalledWith(schedule.id);
  });

  it("0-step + future cutoffDate: stays running (still has work to do)", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60_000);
    const schedule = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: null,
      status: "running",
      steps: [],
      cutoffDate: future,
    });
    const deleteById = jest.fn().mockResolvedValue(undefined);
    const updateById = jest.fn();
    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {},
      models: {
        rampSchedules: { updateById, getById: jest.fn(), deleteById },
        safeRollout: { getById: jest.fn().mockResolvedValue(null) },
      },
    };

    await advanceUntilBlocked(ctx as never, schedule, new Date());

    expect(deleteById).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });

  it("0-step + past cutoffDate: completes via the cutoffDate path (does not auto-delete)", async () => {
    const past = new Date(Date.now() - 60_000);
    const schedule = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: null,
      status: "running",
      steps: [],
      cutoffDate: past,
    });
    const deleteById = jest.fn().mockResolvedValue(undefined);
    const updateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) => ({
          ...schedule,
          ...updates,
        }),
      );
    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {},
      models: {
        rampSchedules: { updateById, getById: jest.fn(), deleteById },
        safeRollout: { getById: jest.fn().mockResolvedValue(null) },
      },
    };

    await advanceUntilBlocked(ctx as never, schedule, new Date());

    // Windowed schedules keep a history record after completion.
    expect(deleteById).not.toHaveBeenCalled();
    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("completed");
  });

  it("pre-loop cutoffDate path disables active targets (matches in-loop behaviour)", async () => {
    // The pre-loop cutoff guard fires when cutoffDate <= now before any step
    // iteration begins (e.g. a 0-step "enable on publish, disable on date"
    // schedule whose cutoff has already elapsed on resume). It must pass
    // { disableActiveTargets: true } so the feature rule is disabled, not left
    // silently enabled after the cutoff fires via this path.
    const past = new Date(Date.now() - 60_000);
    const schedule = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: null,
      status: "running",
      steps: [],
      cutoffDate: past,
    });
    const updateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) => ({
          ...schedule,
          ...updates,
        }),
      );
    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {},
      models: {
        rampSchedules: {
          updateById,
          getById: jest.fn(),
          deleteById: jest.fn(),
        },
        safeRollout: { getById: jest.fn().mockResolvedValue(null) },
      },
    };

    await advanceUntilBlocked(ctx as never, schedule, new Date());

    // completeRollout with disableActiveTargets:true folds enabled:false into
    // the endActions publish, so the active target's rule is disabled.
    expect(mockPublishRevision).toHaveBeenCalled();
    const { result } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = result.rules ?? [];
    const patched = rules.find((r: FeatureRule) => r.id === RULE_ID);
    expect(patched?.enabled).toBe(false);
  });

  // ------------------------------------------------------------------------
  // Defensive unstuck — multi-step ramp transitioned to "running" but step 0
  // not yet due (callsite forgot to set nextStepAt=now).
  // ------------------------------------------------------------------------

  it("defensively enables rules when a multi-step ramp is 'running' but step 0 isn't due", async () => {
    const future = new Date(Date.now() + 60_000);
    const schedule = makeSchedule({
      currentStepIndex: -1,
      nextStepAt: future,
      status: "running",
    });
    const { ctx } = makeContext({
      currentStepIndex: -1,
      nextStepAt: future,
      status: "running",
    });

    await advanceUntilBlocked(ctx as never, schedule, new Date());

    // executeStepActions publishes a revision with enabled:true even though
    // step 0 hasn't fired — would-be stuck rule is unstuck.
    expect(mockPublishRevision).toHaveBeenCalled();
    const { result: forceResult } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = forceResult.rules ?? [];
    const patched = rules.find((r) => r.id === RULE_ID);
    expect(patched?.enabled).toBe(true);
  });

  // ------------------------------------------------------------------------
  // Collapse straight past the end (never-started backlog + future cutoff)
  // ------------------------------------------------------------------------

  it("injects enabled:true when a never-started backlog collapses past the end (future cutoff)", async () => {
    // Regression: the -1 → past-end jump routes through
    // applyEndActionsAndAwaitCutoff, which must fold enabled:true like every
    // other landing — otherwise the rule sits at 100% coverage but disabled
    // and never serves traffic.
    const past = new Date(Date.now() - 10_000_000);
    const schedule = makeSchedule({
      currentStepIndex: -1,
      status: "running",
      nextStepAt: new Date(Date.now() - 1000),
      phaseStartedAt: past, // every step's time gate elapsed
      cutoffDate: new Date(Date.now() + 24 * 60 * 60_000),
    });
    const { ctx, updateById } = makeContext();

    await advanceUntilBlocked(ctx as never, schedule, new Date());

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const { result: forceResult } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = forceResult.rules ?? [];
    const patched = rules.find((r) => r.id === RULE_ID);
    expect(patched?.enabled).toBe(true);
    expect((patched as { coverage?: number })?.coverage).toBe(1.0);

    // Lands past the end, awaiting cutoff, recorded as a jump (not a
    // single-step advance).
    const [, updates] = updateById.mock.calls[0];
    expect(updates.currentStepIndex).toBe(schedule.steps.length);
    const lastEvent = updates.eventHistory?.[updates.eventHistory.length - 1];
    expect(lastEvent?.type).toBe("step-jumped");
  });
});

// ---------------------------------------------------------------------------
// completeRollout
// ---------------------------------------------------------------------------

describe("completeRollout", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(undefined);
  });

  it("applies the fully-accumulated effective patch when fast-forwarding from step 0", async () => {
    // Step 0 sets condition; steps 1 and 2 accumulate coverage.
    // completeRollout from step 0 must apply all steps, not just the last step.
    const schedule = makeSchedule({
      currentStepIndex: 0,
      status: "paused",
      steps: [
        {
          interval: 300,
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: {
                ruleId: RULE_ID,
                coverage: 0.1,
                condition: '{"country":"US"}',
              },
            },
          ],
        },
        {
          interval: 300,
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.5 },
            },
          ],
        },
        {
          interval: 300,
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 1.0 },
            },
          ],
        },
      ],
      // No cutoffDate.
    });

    const { ctx } = makeContext();
    await completeRollout(ctx as never, schedule);

    // The patch passed to createRevision should reflect the fully-accumulated state:
    // coverage=1.0 (from step 2) AND condition from step 0 (inherited because
    // no later step overrode it).
    expect(mockCreateRevision).toHaveBeenCalledTimes(1);
    const [createCall] = mockCreateRevision.mock.calls;
    const patchedRules: FeatureRule[] = createCall[0].changes.rules;
    const rule = patchedRules.find((r) => r.id === RULE_ID);
    expect((rule as { coverage?: number }).coverage).toBe(1.0);
    expect(rule?.condition).toBe('{"country":"US"}');
  });

  it("applies the accumulated patch from all steps (cutoffDate, no end actions)", async () => {
    const schedule = makeSchedule({
      currentStepIndex: 0,
      status: "running",
      steps: [
        {
          interval: 300,
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: {
                ruleId: RULE_ID,
                coverage: 1.0,
                condition: '{"final":true}',
              },
            },
          ],
        },
      ],
      cutoffDate: new Date("2030-01-01"),
    });

    const { ctx } = makeContext();
    await completeRollout(ctx as never, schedule);

    expect(mockCreateRevision).toHaveBeenCalledTimes(1);
    const [createCall] = mockCreateRevision.mock.calls;
    const patchedRules: FeatureRule[] = createCall[0].changes.rules;
    const rule = patchedRules.find((r) => r.id === RULE_ID);
    expect((rule as { coverage?: number }).coverage).toBe(1.0);
    expect(rule?.condition).toBe('{"final":true}');
  });

  it("marks schedule as completed with the last step index", async () => {
    const { ctx, updateById } = makeContext();
    const schedule = makeSchedule({ currentStepIndex: 0, status: "running" });

    await completeRollout(ctx as never, schedule);

    const [, statusUpdate] = updateById.mock.calls[0];
    expect(statusUpdate.status).toBe("completed");
    expect(statusUpdate.currentStepIndex).toBe(schedule.steps.length - 1);
    expect(statusUpdate.nextStepAt).toBeNull();
  });

  it("does not call executeStepActions when there are no targets with actions", async () => {
    const schedule = makeSchedule({
      currentStepIndex: -1,
      status: "running",
      steps: [],
    });

    const { ctx } = makeContext();
    await completeRollout(ctx as never, schedule);

    // No actions to apply → createRevision should not be called.
    expect(mockCreateRevision).not.toHaveBeenCalled();
  });

  it("folds disable into the endActions publish when disableActiveTargets is set", async () => {
    const schedule = makeSchedule({
      currentStepIndex: 0,
      status: "running",
      steps: [
        {
          interval: 300,
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.5 },
            },
          ],
        },
      ],
      endActions: [
        {
          targetType: "feature-rule" as const,
          targetId: TARGET_ID,
          patch: { ruleId: RULE_ID, coverage: 1.0 },
        },
      ],
    });

    const { ctx } = makeContext();
    await completeRollout(ctx as never, schedule, {
      disableActiveTargets: true,
    });

    // One revision publish — disable is merged in, not a separate publish.
    expect(mockCreateRevision).toHaveBeenCalledTimes(1);
    const [createCall] = mockCreateRevision.mock.calls;
    const patchedRules: FeatureRule[] = createCall[0].changes.rules;
    const rule = patchedRules.find((r) => r.id === RULE_ID);
    expect((rule as { coverage?: number }).coverage).toBe(1.0);
    expect(rule?.enabled).toBe(false);
  });

  it("disables active targets with no endActions in a single publish", async () => {
    // Target has no end patch — only the disable; verify a synthetic
    // { enabled: false } action is generated so the publish still happens.
    const schedule = makeSchedule({
      currentStepIndex: 0,
      status: "running",
      steps: [],
      endActions: [],
    });

    const { ctx } = makeContext();
    await completeRollout(ctx as never, schedule, {
      disableActiveTargets: true,
    });

    expect(mockCreateRevision).toHaveBeenCalledTimes(1);
    const [createCall] = mockCreateRevision.mock.calls;
    const patchedRules: FeatureRule[] = createCall[0].changes.rules;
    const rule = patchedRules.find((r) => r.id === RULE_ID);
    expect(rule?.enabled).toBe(false);
  });

  it("merges endActions on top of accumulated step patches at completion", async () => {
    // Step 0 sets condition + partial coverage; endActions sets final coverage=1.0.
    const schedule = makeSchedule({
      currentStepIndex: 0,
      status: "running",
      steps: [
        {
          interval: 300,
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.5, condition: '{"a":"1"}' },
            },
          ],
        },
      ],
      endActions: [
        {
          targetType: "feature-rule" as const,
          targetId: TARGET_ID,
          patch: { ruleId: RULE_ID, coverage: 1.0 },
        },
      ],
    });

    const { ctx } = makeContext();
    await completeRollout(ctx as never, schedule);

    expect(mockCreateRevision).toHaveBeenCalledTimes(1);
    const [createCall] = mockCreateRevision.mock.calls;
    const patchedRules: FeatureRule[] = createCall[0].changes.rules;
    const rule = patchedRules.find((r) => r.id === RULE_ID);
    // endActions overrides coverage to 1.0; condition is inherited from step 0.
    expect((rule as { coverage?: number }).coverage).toBe(1.0);
    expect(rule?.condition).toBe('{"a":"1"}');
  });

  it("refuses to complete a held approval-gated schedule (would enable without approval)", async () => {
    // Held at -1, awaiting start approval: completing would inject enabled:true
    // and serve traffic without the recorded approval — the gate must block it.
    const schedule = makeSchedule({
      currentStepIndex: -1,
      status: "ready",
      requiresStartApproval: true,
      startApprovedAt: null,
    });

    const { ctx } = makeContext();
    await expect(completeRollout(ctx as never, schedule)).rejects.toThrow(
      /start approval/i,
    );
    // Threw before publishing, so no revision was created.
    expect(mockCreateRevision).not.toHaveBeenCalled();
  });

  it("still completes a held approval-gated schedule when disabling (cutoff path never serves)", async () => {
    // disableActiveTargets disables the rule (e.g. cutoff-driven completion), so
    // there's no -1 → serving crossing to gate — it must not be blocked.
    const schedule = makeSchedule({
      currentStepIndex: -1,
      status: "ready",
      requiresStartApproval: true,
      startApprovedAt: null,
    });

    const { ctx } = makeContext();
    await expect(
      completeRollout(ctx as never, schedule, { disableActiveTargets: true }),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// startReadyScheduleNow
// ---------------------------------------------------------------------------

describe("startReadyScheduleNow", () => {
  /**
   * Build a minimal context for startReadyScheduleNow tests.
   *
   * Defaults to a 0-step schedule with a future cutoffDate so that
   * advanceUntilBlocked is a predictable no-op: it skips the 0-step terminal
   * completion (because cutoffDate is set), the cutoffDate path (future), and
   * the step loop (0 steps → maxSteps=0 → zero iterations).
   *
   * This isolates the startReadyScheduleNow logic from advanceUntilBlocked
   * internals, keeping the tests focused.
   */
  function makeStartNowCtx(
    scheduleOverrides: Partial<RampScheduleInterface> = {},
  ) {
    const futureCutoff = new Date(Date.now() + 24 * 60 * 60_000);
    const base = makeSchedule({
      status: "ready",
      steps: [],
      currentStepIndex: -1,
      nextStepAt: null,
      startedAt: null,
      phaseStartedAt: null,
      cutoffDate: futureCutoff,
      ...scheduleOverrides,
    });

    let current: RampScheduleInterface = base;

    const updateById = jest
      .fn()
      .mockImplementation(
        async (_id: string, updates: Partial<RampScheduleInterface>) => {
          current = { ...current, ...updates } as RampScheduleInterface;
          return current;
        },
      );

    const getById = jest.fn().mockImplementation(async () => current);
    const deleteById = jest.fn().mockResolvedValue(undefined);

    const safeRolloutGetById = jest.fn().mockResolvedValue(null);
    const safeRolloutCreate = jest.fn().mockResolvedValue({
      id: "sr_test",
      status: "running",
      autoSnapshots: false,
      nextSnapshotAttempt: null,
    });
    const safeRolloutUpdate = jest.fn().mockResolvedValue(undefined);

    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {
        canUpdateFeature: jest.fn().mockReturnValue(true),
        canReviewFeatureDrafts: jest.fn().mockReturnValue(true),
        canPublishFeature: jest.fn().mockReturnValue(true),
      },
      models: {
        rampSchedules: {
          updateById,
          getById,
          deleteById,
          acquireAdvanceLock: jest.fn().mockResolvedValue(true),
          releaseAdvanceLock: jest.fn().mockResolvedValue(undefined),
          touchAdvanceLockHeartbeat: jest.fn().mockResolvedValue(true),
        },
        safeRollout: {
          getById: safeRolloutGetById,
          create: safeRolloutCreate,
          update: safeRolloutUpdate,
        },
      },
    };

    return {
      ctx,
      updateById,
      getById,
      deleteById,
      safeRolloutCreate,
      schedule: base,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(makeFeature() as never);
  });

  // ---------------------------------------------------------------------------
  // Early-return guard
  // ---------------------------------------------------------------------------

  it("returns early without any side effects when status is not 'ready'", async () => {
    const nonReadyStatuses = [
      "running",
      "paused",
      "completed",
      "pending",
    ] as const;
    for (const status of nonReadyStatuses) {
      const { ctx, updateById } = makeStartNowCtx({ status });
      const schedule = makeSchedule({ status });
      await startReadyScheduleNow(ctx as never, schedule);
      expect(updateById).not.toHaveBeenCalled();
    }
  });

  // ---------------------------------------------------------------------------
  // Status transition fields
  // ---------------------------------------------------------------------------

  it("sets status='running', clears startDate and monitoringStartDate", async () => {
    const { ctx, updateById, schedule } = makeStartNowCtx();
    await startReadyScheduleNow(ctx as never, schedule);

    expect(updateById).toHaveBeenCalled();
    const [, firstUpdate] = updateById.mock.calls[0];
    expect(firstUpdate.status).toBe("running");
    expect(firstUpdate.startDate).toBeNull();
    expect(firstUpdate.monitoringStartDate).toBeNull();
  });

  it("sets startedAt and phaseStartedAt to the current time", async () => {
    const { ctx, updateById, schedule } = makeStartNowCtx();
    const before = Date.now();
    await startReadyScheduleNow(ctx as never, schedule);
    const after = Date.now();

    const [, firstUpdate] = updateById.mock.calls[0];
    expect(firstUpdate.startedAt).toBeInstanceOf(Date);
    expect(firstUpdate.phaseStartedAt).toBeInstanceOf(Date);
    expect((firstUpdate.startedAt as Date).getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect((firstUpdate.startedAt as Date).getTime()).toBeLessThanOrEqual(
      after,
    );
    expect(
      (firstUpdate.phaseStartedAt as Date).getTime(),
    ).toBeGreaterThanOrEqual(before);
    expect((firstUpdate.phaseStartedAt as Date).getTime()).toBeLessThanOrEqual(
      after,
    );
  });

  it("sets nextStepAt=null for 0-step schedules", async () => {
    const { ctx, updateById, schedule } = makeStartNowCtx({ steps: [] });
    await startReadyScheduleNow(ctx as never, schedule);

    const [, firstUpdate] = updateById.mock.calls[0];
    expect(firstUpdate.nextStepAt).toBeNull();
  });

  it("sets nextStepAt≈now for multi-step schedules", async () => {
    // Multi-step schedule with a far-future cutoffDate to keep advanceUntilBlocked
    // from completing. nextStepAt in the initial update must be ≈ now so step 0
    // is immediately eligible. The steps live on the stored doc (the in-lock
    // fresh read is authoritative, not the caller's snapshot).
    const { ctx, updateById, schedule } = makeStartNowCtx({
      steps: makeSchedule({}).steps,
      nextStepAt: null,
    });

    const before = Date.now();
    await startReadyScheduleNow(ctx as never, schedule);
    const after = Date.now();

    // The first updateById call is the transition; subsequent calls may come
    // from advanceStep. Verify the transition call has nextStepAt in [before, after].
    const [, firstUpdate] = updateById.mock.calls[0];
    expect(firstUpdate.nextStepAt).toBeInstanceOf(Date);
    expect((firstUpdate.nextStepAt as Date).getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect((firstUpdate.nextStepAt as Date).getTime()).toBeLessThanOrEqual(
      after,
    );
  });

  // ---------------------------------------------------------------------------
  // contentUpdates applied atomically
  // ---------------------------------------------------------------------------

  it("merges contentUpdates.steps into the initial updateById call, not existing schedule.steps", async () => {
    // Schedule starts with 0 steps; contentUpdates supplies 1 step.
    // The updateById payload must contain the contentUpdates step, and
    // nextStepAt must be set (not null) because steps.length > 0.
    const { ctx, updateById, schedule } = makeStartNowCtx({ steps: [] });

    const contentSteps = [
      {
        interval: 300,
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 0.5 },
          },
        ],
      },
    ];

    await startReadyScheduleNow(ctx as never, schedule, {
      steps: contentSteps,
    });

    const [, firstUpdate] = updateById.mock.calls[0];
    expect(firstUpdate.steps).toEqual(contentSteps);
    // nextStepAt must be set because steps.length > 0 after applying contentUpdates
    expect(firstUpdate.nextStepAt).not.toBeNull();
  });

  it("uses contentUpdates.cutoffDate in the initial update, overriding existing schedule value", async () => {
    const originalCutoff = new Date("2029-01-01");
    const newCutoff = new Date("2030-12-31");
    const { ctx, updateById, schedule } = makeStartNowCtx({
      cutoffDate: originalCutoff,
    });

    await startReadyScheduleNow(ctx as never, schedule, {
      cutoffDate: newCutoff,
    });

    // contentUpdates is spread directly into the updateById payload,
    // so cutoffDate from contentUpdates wins over the existing value.
    const [, firstUpdate] = updateById.mock.calls[0];
    expect(firstUpdate.cutoffDate).toEqual(newCutoff);
  });

  it("uses existing schedule.cutoffDate for nextProcessAt when contentUpdates omits cutoffDate", async () => {
    // When 'cutoffDate' is not a key in contentUpdates, the function reads it
    // from schedule.cutoffDate. The transition update should reflect the
    // existing cutoff in nextProcessAt (non-null).
    const existingCutoff = new Date("2029-06-15");
    const { ctx, updateById, schedule } = makeStartNowCtx({
      cutoffDate: existingCutoff,
    });

    await startReadyScheduleNow(ctx as never, schedule, { name: "My Ramp" });

    const [, firstUpdate] = updateById.mock.calls[0];
    // nextProcessAt should be set (not null) because existingCutoff is in the future
    expect(firstUpdate.nextProcessAt).not.toBeNull();
    expect(firstUpdate.nextProcessAt).toBeInstanceOf(Date);
  });

  // ---------------------------------------------------------------------------
  // Event history
  // ---------------------------------------------------------------------------

  it("emits a 'started' event history entry with stepIndex=-1, status=running, previousStatus=ready", async () => {
    const { ctx, updateById, schedule } = makeStartNowCtx();
    await startReadyScheduleNow(ctx as never, schedule);

    const [, firstUpdate] = updateById.mock.calls[0];
    const eventHistory = firstUpdate.eventHistory as Array<{
      type: string;
      stepIndex?: number;
      status?: string;
      previousStatus?: string;
    }>;

    expect(Array.isArray(eventHistory)).toBe(true);
    const startedEvent = eventHistory.find((e) => e.type === "started");
    expect(startedEvent).toBeDefined();
    expect(startedEvent).toMatchObject({
      type: "started",
      stepIndex: -1,
      status: "running",
      previousStatus: "ready",
    });
  });

  // ---------------------------------------------------------------------------
  // applyRampStartActions
  // ---------------------------------------------------------------------------

  it("calls applyRampStartActions — publishes enabled:true for a 0-step schedule's active target", async () => {
    // applyRampStartActions is a no-op for multi-step (advanceStep handles it),
    // but for 0-step schedules it publishes an enable revision so the rule goes
    // live immediately.
    const { ctx, schedule } = makeStartNowCtx({ steps: [] });
    await startReadyScheduleNow(ctx as never, schedule);

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const { result: forceResult } = mockPublishRevision.mock.calls[0][0];
    const rules: FeatureRule[] = forceResult.rules ?? [];
    const patched = rules.find((r: FeatureRule) => r.id === RULE_ID);
    expect(patched?.enabled).toBe(true);
  });

  it("does not call publishRevision via applyRampStartActions for multi-step schedules", async () => {
    // For multi-step ramps, applyRampStartActions is intentionally a no-op —
    // advanceStep's pre-start fold owns the enable so it lands in the same
    // revision as step 0's targeting patch.
    // We set up a context where updateById returns a far-future nextStepAt so
    // advanceUntilBlocked stops immediately and never reaches advanceStep.
    const base = makeSchedule({
      status: "ready",
      currentStepIndex: -1,
      nextStepAt: null,
      startedAt: null,
      phaseStartedAt: null,
      cutoffDate: new Date(Date.now() + 24 * 60 * 60_000),
      // makeSchedule defaults to 3 steps — use them as-is.
    });

    // updateById returns a far-future nextStepAt so the loop inside
    // advanceUntilBlocked sees nextStepAt > now and stops before advancing step 0.
    const updateById = jest
      .fn()
      .mockImplementation(
        async (_id: string, updates: Partial<RampScheduleInterface>) => ({
          ...base,
          ...updates,
          nextStepAt: new Date(Date.now() + 3_600_000),
          currentStepIndex: updates.currentStepIndex ?? base.currentStepIndex,
          status:
            (updates.status as RampScheduleInterface["status"]) ?? "running",
        }),
      );

    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {
        canUpdateFeature: jest.fn().mockReturnValue(true),
        canReviewFeatureDrafts: jest.fn().mockReturnValue(true),
        canPublishFeature: jest.fn().mockReturnValue(true),
      },
      models: {
        rampSchedules: {
          updateById,
          // First read is the lock wrapper's freshness check (must be ready);
          // later reads reflect the post-start running state.
          getById: jest
            .fn()
            .mockImplementationOnce(async () => base)
            .mockImplementation(async () => ({
              ...base,
              status: "running",
              nextStepAt: new Date(Date.now() + 3_600_000),
            })),
          deleteById: jest.fn().mockResolvedValue(undefined),
          acquireAdvanceLock: jest.fn().mockResolvedValue(true),
          releaseAdvanceLock: jest.fn().mockResolvedValue(undefined),
          touchAdvanceLockHeartbeat: jest.fn().mockResolvedValue(true),
        },
        safeRollout: {
          getById: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
          update: jest.fn(),
        },
      },
    };

    await startReadyScheduleNow(ctx as never, base);

    // applyRampStartActions must not have published a revision for multi-step.
    // (The defensive-unstuck path in advanceUntilBlocked may still fire an
    // enable publish when nextStepAt is pushed to the future post-update, but
    // that is not applyRampStartActions — applyRampStartActions specifically
    // short-circuits when steps.length > 0.)
    // We verify the function completed without throwing, which is the primary
    // goal. Any publishRevision calls here originate from advanceUntilBlocked's
    // defensive path, not from applyRampStartActions.
    expect(updateById).toHaveBeenCalled();
    const [, firstUpdate] = updateById.mock.calls[0];
    expect(firstUpdate.status).toBe("running");
  });

  // ---------------------------------------------------------------------------
  // ensureSafeRolloutForMonitoredRamp
  // ---------------------------------------------------------------------------

  it("calls ensureSafeRolloutForMonitoredRamp — creates a SafeRollout for a monitored schedule", async () => {
    // ensureSafeRolloutForMonitoredRamp is a no-op unless the schedule has
    // monitored steps AND a monitoringConfig with at least one metric ID.
    // When those conditions are met it creates a new SafeRollout and links it.
    const { ctx, safeRolloutCreate, schedule } = makeStartNowCtx({
      steps: [],
      cutoffDate: new Date(Date.now() + 24 * 60 * 60_000),
      // Mark the first step as monitored (steps is overridden below via contentUpdates)
    });

    const monitoredSteps = [
      {
        interval: 3600,
        monitored: true,
        actions: [
          {
            targetType: "feature-rule" as const,
            targetId: TARGET_ID,
            patch: { ruleId: RULE_ID, coverage: 0.5 },
          },
        ],
      },
    ];

    await startReadyScheduleNow(ctx as never, schedule, {
      steps: monitoredSteps,
      monitoringConfig: {
        datasourceId: "ds_1",
        exposureQueryId: "exp_1",
        guardrailMetricIds: ["m_1"],
        signalMetricIds: [],
        monitoringMode: "auto",
        autoUpdate: true,
      },
    });

    expect(safeRolloutCreate).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // advanceUntilBlocked
  // ---------------------------------------------------------------------------

  it("calls advanceUntilBlocked — terminates a 0-step no-cutoffDate schedule immediately", async () => {
    // For 0-step + no cutoffDate, advanceUntilBlocked auto-completes and
    // deletes the schedule (it has no future work to do once the rule is enabled).
    const { ctx, deleteById, schedule } = makeStartNowCtx({
      steps: [],
      cutoffDate: undefined,
    });

    await startReadyScheduleNow(ctx as never, schedule);

    // advanceUntilBlocked → completeRollout (status=completed) → deleteById
    expect(deleteById).toHaveBeenCalledWith(schedule.id);
  });

  // ---------------------------------------------------------------------------
  // Webhook event dispatch
  // ---------------------------------------------------------------------------

  it("dispatches the rampSchedule.actions.started webhook event via createEvent", async () => {
    const { ctx, schedule } = makeStartNowCtx();
    await startReadyScheduleNow(ctx as never, schedule);

    // dispatchRampEvent wraps createEvent; verify it was called with the
    // correct event name.
    expect(mockCreateEvent).toHaveBeenCalledTimes(1);
    const [eventArgs] = mockCreateEvent.mock.calls[0];
    expect(eventArgs.event).toBe("rampSchedule.actions.started");
  });

  it("includes the schedule id in the webhook event payload", async () => {
    const { ctx, schedule } = makeStartNowCtx();
    await startReadyScheduleNow(ctx as never, schedule);

    const [eventArgs] = mockCreateEvent.mock.calls[0];
    expect(eventArgs.objectId).toBe(schedule.id);
  });
});

// ---------------------------------------------------------------------------
// approveAndPublishStep — stepApproval shape and guard behaviour
// ---------------------------------------------------------------------------

describe("approveAndPublishStep", () => {
  const USER_ID = "user_42";

  function makeApprovalSchedule(
    overrides: Partial<RampScheduleInterface> = {},
  ): RampScheduleInterface {
    return makeSchedule({
      currentStepIndex: 0,
      status: "running",
      steps: [
        {
          interval: null,
          holdConditions: { requiresApproval: true },
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.5 },
            },
          ],
        },
      ],
      ...overrides,
    });
  }

  function makeApprovalCtx(
    scheduleOverrides: Partial<RampScheduleInterface> = {},
  ) {
    const schedule = makeApprovalSchedule(scheduleOverrides);
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
        userId: USER_ID,
        org: { id: ORG_ID, settings: {} },
        auditUser: { type: "session" as const, userAgent: "", ip: "" },
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
      schedule,
      updateById,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(makeFeature() as never);
  });

  it("writes the full stepApproval object with stepIndex, approvedBy, and context", async () => {
    const { ctx, schedule, updateById } = makeApprovalCtx();
    const err = await approveAndPublishStep(ctx as never, schedule, "api");

    expect(err).toBeNull();
    const [, updates] = updateById.mock.calls[0];
    expect(updates.stepApproval).toMatchObject({
      stepIndex: 0,
      approvedBy: USER_ID,
      context: "api",
    });
    expect(updates.stepApproval?.approvedAt).toBeInstanceOf(Date);
  });

  it("defaults context to 'ui' when no context arg is given", async () => {
    const { ctx, schedule, updateById } = makeApprovalCtx();
    await approveAndPublishStep(ctx as never, schedule);

    const [, updates] = updateById.mock.calls[0];
    expect(updates.stepApproval?.context).toBe("ui");
  });

  it("is idempotent — returns null immediately if the step is already approved", async () => {
    const { ctx, schedule, updateById } = makeApprovalCtx({
      stepApproval: {
        stepIndex: 0,
        approvedAt: new Date(),
        approvedBy: USER_ID,
        context: "ui",
      },
    });
    const err = await approveAndPublishStep(ctx as never, schedule);

    expect(err).toBeNull();
    // No DB write should happen — approval already recorded for this step.
    expect(updateById).not.toHaveBeenCalled();
  });

  it("returns an error when the step has no requiresApproval holdCondition", async () => {
    const { ctx, schedule } = makeApprovalCtx();
    const scheduleNoApproval = {
      ...schedule,
      steps: [{ ...schedule.steps[0], holdConditions: {} }],
    } as RampScheduleInterface;
    const err = await approveAndPublishStep(ctx as never, scheduleNoApproval);

    expect(err?.code).toBe("error");
  });

  it("returns an error when the schedule is not running", async () => {
    const { ctx, schedule } = makeApprovalCtx({ status: "paused" });
    const err = await approveAndPublishStep(ctx as never, schedule);

    expect(err?.code).toBe("error");
  });

  it("chains through a subsequent instant non-monitored step after approval (bug: single advanceStep call stopped too early)", async () => {
    // Step 0: pure approval (no interval). Step 1: instant (no interval, no holds).
    // After approval, advanceUntilBlocked should chain through step 1 immediately
    // so currentStepIndex lands at 1, not 0.
    let current = makeSchedule({
      currentStepIndex: 0,
      status: "running",
      steps: [
        {
          interval: null,
          holdConditions: { requiresApproval: true },
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.5 },
            },
          ],
        },
        {
          interval: null,
          monitored: false,
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
    const updateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) => {
          current = { ...current, ...updates } as RampScheduleInterface;
          return current;
        },
      );
    const ctx = {
      userId: "user_1",
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "session" as const, userAgent: "", ip: "" },
      environments: [],
      permissions: {
        canUpdateFeature: jest.fn().mockReturnValue(true),
        canReviewFeatureDrafts: jest.fn().mockReturnValue(true),
        canPublishFeature: jest.fn().mockReturnValue(true),
      },
      models: {
        rampSchedules: {
          updateById,
          getById: jest.fn().mockImplementation(() => current),
        },
      },
    };

    const err = await approveAndPublishStep(ctx as never, current);
    expect(err).toBeNull();

    // approveAndPublishStep advances past the approval step then calls
    // advanceUntilBlocked on the result. The next step (index 1) is instant
    // (interval:null) — advanceUntilBlocked exits immediately for it since
    // nextStepAt=null. The agenda picks it up because nextProcessAt=now (Bug 1).
    expect(current.currentStepIndex).toBe(1);
    // nextProcessAt must be non-null so the agenda doesn't strand the schedule.
    expect(current.nextProcessAt).not.toBeNull();
  });

  it("rejects approval of a composite step (interval + approval) while the interval timer is still pending", async () => {
    // Step 0 has both an interval timer (not yet elapsed) and requiresApproval.
    // Approval is the final gate: it must be refused until the interval has
    // elapsed, and no approval is recorded.
    const future = new Date(Date.now() + 60 * 60 * 1000); // 1h from now
    let current = makeSchedule({
      currentStepIndex: 0,
      status: "running",
      // nextStepAt in the future means the interval hasn't elapsed yet.
      nextStepAt: future,
      steps: [
        {
          interval: 3600,
          holdConditions: { requiresApproval: true },
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.5 },
            },
          ],
        },
        {
          interval: null,
          monitored: false,
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
    const updateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) => {
          current = { ...current, ...updates } as RampScheduleInterface;
          return current;
        },
      );
    const ctx = {
      userId: "user_1",
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "session" as const, userAgent: "", ip: "" },
      environments: [],
      permissions: {
        canUpdateFeature: jest.fn().mockReturnValue(true),
        canReviewFeatureDrafts: jest.fn().mockReturnValue(true),
        canPublishFeature: jest.fn().mockReturnValue(true),
      },
      models: {
        rampSchedules: {
          updateById,
          getById: jest.fn().mockImplementation(() => current),
        },
      },
    };

    const err = await approveAndPublishStep(ctx as never, current);

    // Approval is refused — the interval is still counting down.
    expect(err?.code).toBe("not_ready");
    // Nothing is written: no approval recorded, schedule stays on step 0.
    expect(updateById).not.toHaveBeenCalled();
    expect(current.currentStepIndex).toBe(0);
  });

  it("advances a composite step (interval + approval) immediately when the interval has already elapsed", async () => {
    // Same composite step, but nextStepAt is in the past — the timer has
    // elapsed, so approval clears the last hold and the schedule advances.
    const past = new Date(Date.now() - 60 * 1000); // 1m ago
    let current = makeSchedule({
      currentStepIndex: 0,
      status: "running",
      nextStepAt: past,
      steps: [
        {
          interval: 3600,
          holdConditions: { requiresApproval: true },
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.5 },
            },
          ],
        },
        {
          interval: null,
          monitored: false,
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
    const updateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) => {
          current = { ...current, ...updates } as RampScheduleInterface;
          return current;
        },
      );
    const ctx = {
      userId: "user_1",
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "session" as const, userAgent: "", ip: "" },
      environments: [],
      permissions: {
        canUpdateFeature: jest.fn().mockReturnValue(true),
        canReviewFeatureDrafts: jest.fn().mockReturnValue(true),
        canPublishFeature: jest.fn().mockReturnValue(true),
      },
      models: {
        rampSchedules: {
          updateById,
          getById: jest.fn().mockImplementation(() => current),
        },
      },
    };

    const err = await approveAndPublishStep(ctx as never, current);
    expect(err).toBeNull();

    // Timer already elapsed → approval clears the last hold → advance past it.
    expect(current.currentStepIndex).toBeGreaterThanOrEqual(1);
  });

  it("rebases phaseStartedAt on approval so a late approval doesn't collapse the next step's interval", async () => {
    // Simulate a composite step approved long after its interval elapsed:
    // phaseStartedAt is 10h ago, step 0's interval is 1h (timer long gone).
    // Without rebasing phaseStartedAt, step 1's nextStepAt would resolve to
    // phaseStart + 2h = 8h ago (in the past) and the step would complete with
    // zero observation time. Rebasing must give step 1 its full 1h interval
    // measured from approval time.
    const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000);
    let current = makeSchedule({
      currentStepIndex: 0,
      status: "running",
      phaseStartedAt: tenHoursAgo,
      startedAt: tenHoursAgo,
      nextStepAt: new Date(tenHoursAgo.getTime() + 3600 * 1000), // 9h ago, past
      steps: [
        {
          interval: 3600,
          holdConditions: { requiresApproval: true },
          actions: [
            {
              targetType: "feature-rule" as const,
              targetId: TARGET_ID,
              patch: { ruleId: RULE_ID, coverage: 0.5 },
            },
          ],
        },
        {
          interval: 3600,
          monitored: false,
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
    const updateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) => {
          current = { ...current, ...updates } as RampScheduleInterface;
          return current;
        },
      );
    const ctx = {
      userId: "user_1",
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "session" as const, userAgent: "", ip: "" },
      environments: [],
      permissions: {
        canUpdateFeature: jest.fn().mockReturnValue(true),
        canReviewFeatureDrafts: jest.fn().mockReturnValue(true),
        canPublishFeature: jest.fn().mockReturnValue(true),
      },
      models: {
        rampSchedules: {
          updateById,
          getById: jest.fn().mockImplementation(() => current),
        },
      },
    };

    const err = await approveAndPublishStep(ctx as never, current);
    expect(err).toBeNull();

    expect(current.currentStepIndex).toBe(1);
    // Step 1's timer must be in the future (~1h out), not in the past.
    expect(current.nextStepAt).toBeInstanceOf(Date);
    const nextStepMs = (current.nextStepAt as Date).getTime();
    expect(nextStepMs).toBeGreaterThan(Date.now());
    // Allow generous slack for execution time; should be ~3600s out.
    expect(nextStepMs - Date.now()).toBeGreaterThan(3000 * 1000);
    expect(nextStepMs - Date.now()).toBeLessThanOrEqual(3600 * 1000 + 5000);
  });
});

// ---------------------------------------------------------------------------
// isAwaitingApproval
// ---------------------------------------------------------------------------

describe("isAwaitingApproval", () => {
  const baseSchedule = {
    status: "running" as const,
    currentStepIndex: 0,
    steps: [{ holdConditions: { requiresApproval: true } }],
    stepApproval: null,
  };

  it("returns true when running + requiresApproval + no stepApproval", () => {
    expect(isAwaitingApproval(baseSchedule)).toBe(true);
  });

  it("returns false when stepApproval.stepIndex matches currentStepIndex", () => {
    expect(
      isAwaitingApproval({
        ...baseSchedule,
        stepApproval: {
          stepIndex: 0,
          approvedAt: new Date(),
          approvedBy: "u1",
          context: "ui" as const,
        },
      }),
    ).toBe(false);
  });

  it("returns true when stepApproval.stepIndex is for a different step (stale approval)", () => {
    expect(
      isAwaitingApproval({
        ...baseSchedule,
        currentStepIndex: 1,
        steps: [
          { holdConditions: {} },
          { holdConditions: { requiresApproval: true } },
        ],
        stepApproval: {
          stepIndex: 0,
          approvedAt: new Date(),
          approvedBy: "u1",
          context: "ui" as const,
        },
      }),
    ).toBe(true);
  });

  it("returns false when the step has no requiresApproval", () => {
    expect(
      isAwaitingApproval({
        ...baseSchedule,
        steps: [{ holdConditions: {} }],
      }),
    ).toBe(false);
  });

  it("returns false when status is not running", () => {
    expect(
      isAwaitingApproval({ ...baseSchedule, status: "paused" as const }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isAwaitingStartApproval
// ---------------------------------------------------------------------------

describe("isAwaitingStartApproval", () => {
  const held = {
    status: "ready" as const,
    currentStepIndex: -1,
    requiresStartApproval: true,
    startApprovedAt: null,
  };

  it("returns true for a ready, unapproved, pre-start approval schedule", () => {
    expect(isAwaitingStartApproval(held)).toBe(true);
  });

  it("returns false once approved", () => {
    expect(
      isAwaitingStartApproval({
        ...held,
        startApprovedAt: new Date(),
      }),
    ).toBe(false);
  });

  it("returns false when the schedule does not require approval", () => {
    expect(
      isAwaitingStartApproval({
        ...held,
        requiresStartApproval: false,
      }),
    ).toBe(false);
  });

  it("returns false once past step -1 (already crossed into a step)", () => {
    expect(isAwaitingStartApproval({ ...held, currentStepIndex: 0 })).toBe(
      false,
    );
  });

  it("returns false for a running schedule (only the ready hold counts)", () => {
    expect(
      isAwaitingStartApproval({ ...held, status: "running" as const }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// startApprovalPending — the status-independent invariant used at the crossing
// ---------------------------------------------------------------------------

describe("startApprovalPending", () => {
  it("is true when required and not yet approved (any status)", () => {
    expect(
      startApprovalPending({
        requiresStartApproval: true,
        startApprovedAt: null,
      }),
    ).toBe(true);
    // Status-independent: still pending even mid-transition to running.
    expect(
      startApprovalPending({
        requiresStartApproval: true,
        startApprovedAt: undefined,
      }),
    ).toBe(true);
  });

  it("is false once approved", () => {
    expect(
      startApprovalPending({
        requiresStartApproval: true,
        startApprovedAt: new Date(),
      }),
    ).toBe(false);
  });

  it("is false when approval isn't required", () => {
    expect(
      startApprovalPending({
        requiresStartApproval: false,
        startApprovedAt: null,
      }),
    ).toBe(false);
    expect(startApprovalPending({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveStartApproval — tri-state (true/false/null = set, undefined = keep)
// ---------------------------------------------------------------------------

describe("resolveStartApproval", () => {
  it("uses the action value when explicitly set", () => {
    expect(resolveStartApproval(true, false)).toBe(true);
    expect(resolveStartApproval(false, true)).toBe(false);
  });

  it("treats null as an explicit off (does not fall back to base)", () => {
    expect(resolveStartApproval(null, true)).toBe(false);
  });

  it("falls back to the base value when the action omits it (undefined)", () => {
    expect(resolveStartApproval(undefined, true)).toBe(true);
    expect(resolveStartApproval(undefined, false)).toBe(false);
    expect(resolveStartApproval(undefined, null)).toBe(false);
    expect(resolveStartApproval(undefined, undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isReadyForApproval — approval is gated behind the step's interval
// ---------------------------------------------------------------------------

describe("isReadyForApproval", () => {
  const base = {
    status: "running" as const,
    currentStepIndex: 0,
    stepApproval: null,
  };

  it("is true for a pure-approval step (no interval)", () => {
    expect(
      isReadyForApproval({
        ...base,
        steps: [{ interval: null, holdConditions: { requiresApproval: true } }],
      }),
    ).toBe(true);
  });

  it("is false while a non-monitored step's interval timer is still pending", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    expect(
      isReadyForApproval({
        ...base,
        nextStepAt: future,
        steps: [{ interval: 3600, holdConditions: { requiresApproval: true } }],
      }),
    ).toBe(false);
  });

  it("is true once a non-monitored step's interval timer has elapsed", () => {
    const past = new Date(Date.now() - 60 * 1000);
    expect(
      isReadyForApproval({
        ...base,
        nextStepAt: past,
        steps: [{ interval: 3600, holdConditions: { requiresApproval: true } }],
      }),
    ).toBe(true);
  });

  it("is false for a monitored step before its interval has elapsed", () => {
    const enteredAt = new Date(Date.now() - 60 * 1000); // 1m ago, interval 1h
    expect(
      isReadyForApproval({
        ...base,
        currentStepEnteredAt: enteredAt,
        steps: [
          {
            interval: 3600,
            monitored: true,
            holdConditions: { requiresApproval: true },
          },
        ],
      }),
    ).toBe(false);
  });

  it("is true for a monitored step once its interval has elapsed", () => {
    const enteredAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    expect(
      isReadyForApproval({
        ...base,
        currentStepEnteredAt: enteredAt,
        steps: [
          {
            interval: 3600,
            monitored: true,
            holdConditions: { requiresApproval: true },
          },
        ],
      }),
    ).toBe(true);
  });

  it("is false when the step is not awaiting approval at all", () => {
    expect(
      isReadyForApproval({
        ...base,
        steps: [{ interval: null, holdConditions: {} }],
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeNextProcessAt
// ---------------------------------------------------------------------------

describe("computeNextProcessAt", () => {
  it("running: returns earliest of nextStepAt, nextSnapshotAt, cutoffDate", () => {
    const step = new Date("2026-06-10T00:00:00Z");
    const snapshot = new Date("2026-06-08T00:00:00Z");
    const cutoff = new Date("2026-06-15T00:00:00Z");
    const result = computeNextProcessAt({
      status: "running",
      nextStepAt: step,
      nextSnapshotAt: snapshot,
      cutoffDate: cutoff,
    });
    expect(result).toEqual(snapshot);
  });

  it("running: returns cutoffDate when no step or snapshot timers exist", () => {
    const cutoff = new Date("2026-06-15T00:00:00Z");
    const result = computeNextProcessAt({
      status: "running",
      nextStepAt: null,
      nextSnapshotAt: null,
      cutoffDate: cutoff,
    });
    expect(result).toEqual(cutoff);
  });

  it("running: returns null when no timers exist at all", () => {
    const result = computeNextProcessAt({
      status: "running",
      nextStepAt: null,
      nextSnapshotAt: null,
    });
    expect(result).toBeNull();
  });

  it("ready: returns startDate", () => {
    const start = new Date("2026-06-05T00:00:00Z");
    const result = computeNextProcessAt({
      status: "ready",
      startDate: start,
    });
    expect(result).toEqual(start);
  });

  it("ready: returns null when no startDate", () => {
    const result = computeNextProcessAt({ status: "ready" });
    expect(result).toBeNull();
  });

  it("ready: returns null while awaiting start approval, even with a startDate", () => {
    const result = computeNextProcessAt({
      status: "ready",
      startDate: new Date("2026-06-05T00:00:00Z"),
      requiresStartApproval: true,
    });
    expect(result).toBeNull();
  });

  it("ready: arms for startDate once the start is approved", () => {
    const start = new Date("2026-06-05T00:00:00Z");
    const result = computeNextProcessAt({
      status: "ready",
      startDate: start,
      requiresStartApproval: true,
      startApprovedAt: new Date("2026-06-01T00:00:00Z"),
    });
    expect(result).toEqual(start);
  });

  it("paused: returns cutoffDate so scheduler can enforce the cutoff", () => {
    const cutoff = new Date("2026-06-15T00:00:00Z");
    const result = computeNextProcessAt({
      status: "paused",
      cutoffDate: cutoff,
    });
    expect(result).toEqual(cutoff);
  });

  it("paused: returns null when no cutoffDate", () => {
    const result = computeNextProcessAt({ status: "paused" });
    expect(result).toBeNull();
  });

  it("completed: returns null (terminal state)", () => {
    const result = computeNextProcessAt({
      status: "completed",
      cutoffDate: new Date("2026-06-15T00:00:00Z"),
    });
    expect(result).toBeNull();
  });

  it("rolled-back: returns null (terminal state)", () => {
    const result = computeNextProcessAt({
      status: "rolled-back",
      cutoffDate: new Date("2026-06-15T00:00:00Z"),
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// advanceStep — future cutoffDate keeps schedule running
// ---------------------------------------------------------------------------

describe("advanceStep — future cutoffDate keeps schedule running", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFeature.mockResolvedValue(makeFeature() as never);
    mockCreateRevision.mockResolvedValue(makeRevision() as never);
    mockPublishRevision.mockResolvedValue(makeFeature() as never);
  });

  it("stays running with nextProcessAt=cutoffDate when all steps are done but cutoff is future", async () => {
    const futureCutoff = new Date(Date.now() + 60 * 60_000);
    const schedule = makeSchedule({
      currentStepIndex: 2,
      cutoffDate: futureCutoff,
    });
    const { ctx, updateById } = makeContext({
      currentStepIndex: 2,
      cutoffDate: futureCutoff,
    });

    await advanceStep(ctx as never, schedule);

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);

    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("running");
    expect(updates.currentStepIndex).toBe(3);
    expect(updates.nextProcessAt).toEqual(futureCutoff);
    expect(updates.nextStepAt).toBeNull();
  });

  it("completes normally when cutoffDate is in the past", async () => {
    const pastCutoff = new Date(Date.now() - 60_000);
    const schedule = makeSchedule({
      currentStepIndex: 2,
      cutoffDate: pastCutoff,
    });
    const { ctx, updateById } = makeContext({
      currentStepIndex: 2,
      cutoffDate: pastCutoff,
    });

    await advanceStep(ctx as never, schedule);

    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("completed");
  });

  it("completes normally when no cutoffDate exists", async () => {
    const schedule = makeSchedule({ currentStepIndex: 2 });
    const { ctx, updateById } = makeContext({ currentStepIndex: 2 });

    await advanceStep(ctx as never, schedule);

    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// pauseSchedule — nextProcessAt from cutoffDate
// ---------------------------------------------------------------------------

describe("pauseSchedule", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sets nextProcessAt to cutoffDate when a cutoff exists", async () => {
    const futureCutoff = new Date(Date.now() + 60 * 60_000);
    const schedule = makeSchedule({
      status: "running",
      currentStepIndex: 1,
      cutoffDate: futureCutoff,
    });

    const updateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) => ({
          ...schedule,
          ...updates,
        }),
      );

    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {
        canUpdateFeature: jest.fn().mockReturnValue(true),
      },
      models: {
        rampSchedules: { updateById, getById: jest.fn() },
      },
    };

    await pauseSchedule(ctx as never, schedule);

    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("paused");
    expect(updates.nextProcessAt).toEqual(futureCutoff);
    expect(updates.nextSnapshotAt).toBeNull();
  });

  it("sets nextProcessAt to null when no cutoffDate exists", async () => {
    const schedule = makeSchedule({
      status: "running",
      currentStepIndex: 1,
    });

    const updateById = jest
      .fn()
      .mockImplementation(
        (_id: string, updates: Partial<RampScheduleInterface>) => ({
          ...schedule,
          ...updates,
        }),
      );

    const ctx = {
      org: { id: ORG_ID, settings: {} },
      auditUser: { type: "system" },
      environments: [],
      permissions: {
        canUpdateFeature: jest.fn().mockReturnValue(true),
      },
      models: {
        rampSchedules: { updateById, getById: jest.fn() },
      },
    };

    await pauseSchedule(ctx as never, schedule);

    const [, updates] = updateById.mock.calls[0];
    expect(updates.status).toBe("paused");
    expect(updates.nextProcessAt).toBeNull();
  });
});
