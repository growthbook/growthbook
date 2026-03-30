/**
 * Tests for rampSchedule.ts
 *
 * Structure:
 *   1. Pure functions (no mocking): computeNextStepAt, computePhaseStartAfterApproval,
 *      applyPatchToRule
 *   2. featureEntityHandler: applyActions (mocked FeatureModel / FeatureRevisionModel)
 *   3. Orchestration: advanceStep, jumpAheadToStep, advanceUntilBlocked (mocked context)
 */

import type { RampScheduleInterface } from "shared/validators";
import type { FeatureRule } from "shared/types/feature";
import {
  computeNextStepAt,
  computePhaseStartAfterApproval,
  applyPatchToRule,
  featureEntityHandler,
  advanceStep,
  jumpAheadToStep,
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

  it("ignores null coverage (null means 'no change')", () => {
    const result = applyPatchToRule(base, {
      coverage: null as unknown as number,
    });
    expect((result as { coverage?: number }).coverage).toBe(
      base.coverage ?? undefined,
    );
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

  it("publishes a single merged revision with last-write-wins patch", async () => {
    // Steps 0=coverage 0.3, 1=coverage 0.6, 2=coverage 1.0
    const schedule = makeSchedule({ currentStepIndex: -1 });
    const { ctx } = makeContext();
    await jumpAheadToStep(ctx as never, schedule, 2);

    expect(mockPublishRevision).toHaveBeenCalledTimes(1);
    const [, , , forceResult] = mockPublishRevision.mock.calls[0];
    const rules: FeatureRule[] = forceResult.rules?.production ?? [];
    const patched = rules.find((r: FeatureRule) => r.id === RULE_ID);
    // Last-write-wins: step 2 sets coverage 1.0
    expect((patched as { coverage?: number })?.coverage).toBe(1.0);
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
