import {
  rampScheduleValidator,
  rampStep,
  rampStepAction,
} from "../src/validators/ramp-schedule";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_INTERVAL_STEP = {
  interval: 300,
  actions: [],
};

const VALID_APPROVAL_STEP = {
  interval: null,
  holdConditions: { requiresApproval: true },
  actions: [],
};

function makeSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rs_test",
    name: "Test Ramp",
    organization: "org_1",
    dateCreated: new Date("2025-01-01T00:00:00Z"),
    dateUpdated: new Date("2025-01-01T00:00:00Z"),
    entityType: "feature",
    entityId: "feat_1",
    targets: [],
    steps: [VALID_INTERVAL_STEP],
    status: "pending",
    currentStepIndex: -1,
    nextStepAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// rampStepAction
// ---------------------------------------------------------------------------

describe("rampStepAction", () => {
  it("accepts a coverage patch", () => {
    const result = rampStepAction.safeParse({
      targetType: "feature-rule",
      targetId: "t1",
      patch: { ruleId: "rule_1", coverage: 0.5 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects coverage outside 0–1", () => {
    const result = rampStepAction.safeParse({
      targetType: "feature-rule",
      targetId: "t1",
      patch: { ruleId: "rule_1", coverage: 1.5 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a boolean enabled patch", () => {
    const result = rampStepAction.safeParse({
      targetType: "feature-rule",
      targetId: "t1",
      patch: { ruleId: "rule_1", enabled: false },
    });
    expect(result.success).toBe(true);
  });

  it("requires ruleId in patch", () => {
    const result = rampStepAction.safeParse({
      targetType: "feature-rule",
      targetId: "t1",
      patch: { coverage: 0.5 },
    });
    expect(result.success).toBe(false);
  });

  it("requires type field", () => {
    const result = rampStepAction.safeParse({
      targetId: "t1",
      patch: { ruleId: "rule_1", coverage: 0.5 },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rampStep
// ---------------------------------------------------------------------------

describe("rampStep", () => {
  it("accepts a valid interval step", () => {
    const result = rampStep.safeParse(VALID_INTERVAL_STEP);
    expect(result.success).toBe(true);
  });

  it("accepts a valid approval step", () => {
    const result = rampStep.safeParse(VALID_APPROVAL_STEP);
    expect(result.success).toBe(true);
  });

  it("accepts approvalNotes on an approval step", () => {
    const result = rampStep.safeParse({
      ...VALID_APPROVAL_STEP,
      approvalNotes: "Please review carefully",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-numeric interval", () => {
    const result = rampStep.safeParse({
      interval: "not-a-number",
      actions: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a zero-or-negative interval (positive nullable)", () => {
    const zero = rampStep.safeParse({ interval: 0, actions: [] });
    expect(zero.success).toBe(false);
    const negative = rampStep.safeParse({ interval: -1, actions: [] });
    expect(negative.success).toBe(false);
  });

  it("no longer accepts defaultEffects (removed field is silently ignored)", () => {
    // Zod ignores extra fields in nested objects by default — old docs parse fine.
    const result = rampStep.safeParse({
      ...VALID_INTERVAL_STEP,
      defaultEffects: { coverage: 0.5 },
    });
    expect(result.success).toBe(true);
    // But the parsed output should NOT contain defaultEffects.
    if (result.success) {
      expect(
        (result.data as Record<string, unknown>).defaultEffects,
      ).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// rampScheduleValidator — valid documents
// ---------------------------------------------------------------------------

describe("rampScheduleValidator — valid documents", () => {
  it("accepts a minimal valid schedule with one step", () => {
    const result = rampScheduleValidator.safeParse(makeSchedule());
    expect(result.success).toBe(true);
  });

  it("accepts a schedule with zero steps when startDate is set", () => {
    const at = new Date(Date.now() + 86400_000);
    const result = rampScheduleValidator.safeParse(
      makeSchedule({ steps: [], startDate: at }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a startDate", () => {
    const at = new Date(Date.now() + 86400_000);
    const result = rampScheduleValidator.safeParse(
      makeSchedule({ startDate: at }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a cutoffDate", () => {
    const at = new Date(Date.now() + 86400_000 * 7);
    const result = rampScheduleValidator.safeParse(
      makeSchedule({ cutoffDate: at }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a schedule with multiple steps including an approval gate", () => {
    const result = rampScheduleValidator.safeParse(
      makeSchedule({
        steps: [VALID_INTERVAL_STEP, VALID_APPROVAL_STEP, VALID_INTERVAL_STEP],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts all valid status values", () => {
    // `pending-approval` is no longer a stored status; awaiting-approval is
    // derived from `running` + `holdConditions.requiresApproval`.
    const statuses = [
      "pending",
      "ready",
      "running",
      "paused",
      "completed",
      "rolled-back",
    ];
    for (const status of statuses) {
      const result = rampScheduleValidator.safeParse(makeSchedule({ status }));
      expect(result.success).toBe(true);
    }
  });

  it("rejects the legacy 'pending-approval' status", () => {
    const result = rampScheduleValidator.safeParse(
      makeSchedule({ status: "pending-approval" }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rampScheduleValidator — invalid documents
// ---------------------------------------------------------------------------

describe("rampScheduleValidator — invalid documents", () => {
  it("rejects a schedule missing required fields", () => {
    const result = rampScheduleValidator.safeParse({ name: "Missing fields" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid status", () => {
    const result = rampScheduleValidator.safeParse(
      makeSchedule({ status: "unknown-status" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a step with a negative interval", () => {
    const result = rampScheduleValidator.safeParse(
      makeSchedule({
        steps: [{ interval: -1, actions: [] }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a zero-step schedule with no startDate and no cutoffDate", () => {
    const result = rampScheduleValidator.safeParse(makeSchedule({ steps: [] }));
    expect(result.success).toBe(false);
  });

  it("rejects a coverage action with value outside [0,1]", () => {
    const result = rampScheduleValidator.safeParse(
      makeSchedule({
        steps: [
          {
            interval: 60,
            actions: [
              {
                targetType: "feature-rule",
                targetId: "t1",
                patch: { ruleId: "r1", coverage: 2.0 },
              },
            ],
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a monitored step with coverage > 0.5", () => {
    const result = rampScheduleValidator.safeParse(
      makeSchedule({
        steps: [
          {
            interval: 60,
            monitored: true,
            actions: [
              {
                targetType: "feature-rule",
                targetId: "t1",
                patch: { ruleId: "r1", coverage: 0.6 },
              },
            ],
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a monitored step with coverage = 0.51", () => {
    const result = rampScheduleValidator.safeParse(
      makeSchedule({
        steps: [
          {
            interval: 60,
            monitored: true,
            actions: [
              {
                targetType: "feature-rule",
                targetId: "t1",
                patch: { ruleId: "r1", coverage: 0.51 },
              },
            ],
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts a monitored step with coverage exactly 0.5", () => {
    const result = rampScheduleValidator.safeParse(
      makeSchedule({
        steps: [
          {
            interval: 60,
            monitored: true,
            actions: [
              {
                targetType: "feature-rule",
                targetId: "t1",
                patch: { ruleId: "r1", coverage: 0.5 },
              },
            ],
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts an unmonitored step with coverage > 0.5", () => {
    // The cap only applies to monitored steps
    const result = rampScheduleValidator.safeParse(
      makeSchedule({
        steps: [
          {
            interval: 60,
            monitored: false,
            actions: [
              {
                targetType: "feature-rule",
                targetId: "t1",
                patch: { ruleId: "r1", coverage: 0.8 },
              },
            ],
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });
});
