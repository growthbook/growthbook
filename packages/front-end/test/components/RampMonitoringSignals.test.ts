/**
 * Tests for pure utility functions exported from RampMonitoringSignals.tsx.
 *
 * Covers:
 *   1. isHoldingNow        — true only once the step interval has fully elapsed
 *   2. isNearingStepEnd    — true once past the 75% threshold
 *   3. conservativeActionForSignals — worst-case action across a signal set
 *   4. getRampHealthOverview — full label/severity/summary decision matrix
 *   5. isOnMonitoredStep   — predicate for the current step
 *
 * These are pure functions (or close to it); vi.setSystemTime controls Date.now().
 */

vi.mock("@/hooks/useApi", () => ({ default: vi.fn() }));
vi.mock("@/services/auth", () => ({ useAuth: vi.fn() }));
vi.mock("@/services/UserContext", () => ({ useUser: vi.fn() }));
vi.mock("@/services/DefinitionsContext", () => ({ useDefinitions: vi.fn() }));
vi.mock("@/components/SafeRollout/SnapshotProvider", () => ({
  useSafeRolloutSnapshot: vi.fn(),
}));
vi.mock("next/router", () => ({ useRouter: vi.fn(() => ({ query: {} })) }));
vi.mock("@/components/RampSchedule/rollbackReason", () => ({
  formatRollbackReason: (r: string | null | undefined) => r ?? null,
}));

import type { RampScheduleInterface } from "shared/validators";
import type { SignalResult } from "@/components/RampSchedule/RampMonitoringSignals";
import {
  isHoldingNow,
  isNearingStepEnd,
  conservativeActionForSignals,
  getRampHealthOverview,
  isOnMonitoredStep,
} from "@/components/RampSchedule/RampMonitoringSignals";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date("2026-06-01T12:00:00Z");

const MONITORED_STEP = {
  interval: 3600, // 1 hour
  monitored: true,
  actions: [],
  holdConditions: undefined,
  approvalNotes: undefined,
};

const UNMONITORED_STEP = {
  interval: 3600,
  monitored: false,
  actions: [],
};

const APPROVAL_STEP = {
  interval: null,
  monitored: true,
  actions: [],
  holdConditions: { requiresApproval: true },
};

function makeSchedule(
  overrides: Partial<RampScheduleInterface> = {},
): RampScheduleInterface {
  return {
    id: "rs_test",
    organization: "org_1",
    name: "Test Ramp",
    entityId: "feat_1",
    targets: [],
    steps: [MONITORED_STEP],
    status: "running",
    currentStepIndex: 0,
    currentStepEnteredAt: new Date(NOW.getTime() - 1800 * 1000), // 30 min ago
    nextStepAt: null,
    dateCreated: NOW,
    dateUpdated: NOW,
    ...overrides,
  } as unknown as RampScheduleInterface;
}

const NO_SIGNALS: SignalResult = { signals: [], actions: {}, details: {} };

function sig(
  signals: SignalResult["signals"],
  actions: SignalResult["actions"] = {},
  details: SignalResult["details"] = {},
): SignalResult {
  return { signals, actions, details };
}

// ---------------------------------------------------------------------------
// 1. isHoldingNow
// ---------------------------------------------------------------------------

describe("isHoldingNow", () => {
  beforeEach(() => vi.setSystemTime(NOW));
  afterEach(() => vi.useRealTimers());

  it("returns false when status is not running", () => {
    expect(isHoldingNow(makeSchedule({ status: "paused" }))).toBe(false);
  });

  it("returns false for a non-monitored step", () => {
    expect(isHoldingNow(makeSchedule({ steps: [UNMONITORED_STEP] }))).toBe(
      false,
    );
  });

  it("returns false when interval is null (approval-only step)", () => {
    expect(isHoldingNow(makeSchedule({ steps: [APPROVAL_STEP] }))).toBe(false);
  });

  it("returns false when currentStepEnteredAt is null", () => {
    expect(isHoldingNow(makeSchedule({ currentStepEnteredAt: null }))).toBe(
      false,
    );
  });

  it("returns false when interval has NOT elapsed (30 min into a 1-hour step)", () => {
    // enteredAt 30 min ago, interval 1 hour → not done yet
    expect(isHoldingNow(makeSchedule())).toBe(false);
  });

  it("returns true when interval has EXACTLY elapsed", () => {
    const s = makeSchedule({
      currentStepEnteredAt: new Date(NOW.getTime() - 3600 * 1000),
    });
    expect(isHoldingNow(s)).toBe(true);
  });

  it("returns true when interval has elapsed with extra time (late tick)", () => {
    const s = makeSchedule({
      currentStepEnteredAt: new Date(NOW.getTime() - 7200 * 1000), // 2 hours ago, 1-hour step
    });
    expect(isHoldingNow(s)).toBe(true);
  });

  it("returns false when currentStepIndex is -1 (pre-start state)", () => {
    const s = makeSchedule({ currentStepIndex: -1 });
    expect(isHoldingNow(s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. isNearingStepEnd
// ---------------------------------------------------------------------------

describe("isNearingStepEnd", () => {
  afterEach(() => vi.useRealTimers());

  it("returns false when status is not running", () => {
    vi.setSystemTime(NOW);
    expect(isNearingStepEnd(makeSchedule({ status: "paused" }))).toBe(false);
  });

  it("returns false for a non-monitored step", () => {
    vi.setSystemTime(NOW);
    expect(isNearingStepEnd(makeSchedule({ steps: [UNMONITORED_STEP] }))).toBe(
      false,
    );
  });

  it("returns false when interval is null", () => {
    vi.setSystemTime(NOW);
    expect(isNearingStepEnd(makeSchedule({ steps: [APPROVAL_STEP] }))).toBe(
      false,
    );
  });

  it("returns false before 75% threshold (30 min into 1-hour step = 50%)", () => {
    vi.setSystemTime(NOW);
    // currentStepEnteredAt default is 30 min ago
    expect(isNearingStepEnd(makeSchedule())).toBe(false);
  });

  it("returns true at exactly 75% (2700s into 3600s step)", () => {
    vi.setSystemTime(new Date(NOW.getTime() + 0));
    const s = makeSchedule({
      currentStepEnteredAt: new Date(NOW.getTime() - 2700 * 1000),
    });
    expect(isNearingStepEnd(s)).toBe(true);
  });

  it("returns true past 75% (3000s into 3600s step = 83%)", () => {
    const s = makeSchedule({
      currentStepEnteredAt: new Date(NOW.getTime() - 3000 * 1000),
    });
    vi.setSystemTime(NOW);
    expect(isNearingStepEnd(s)).toBe(true);
  });

  it("returns true once interval has fully elapsed", () => {
    const s = makeSchedule({
      currentStepEnteredAt: new Date(NOW.getTime() - 3600 * 1000),
    });
    vi.setSystemTime(NOW);
    expect(isNearingStepEnd(s)).toBe(true);
  });

  it("respects a custom threshold of 0.9", () => {
    // 83% elapsed — below 90% custom threshold
    const s = makeSchedule({
      currentStepEnteredAt: new Date(NOW.getTime() - 3000 * 1000),
    });
    vi.setSystemTime(NOW);
    expect(isNearingStepEnd(s, 0.9)).toBe(false);
  });

  it("returns false when currentStepEnteredAt is null", () => {
    vi.setSystemTime(NOW);
    expect(isNearingStepEnd(makeSchedule({ currentStepEnteredAt: null }))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. conservativeActionForSignals
// ---------------------------------------------------------------------------

describe("conservativeActionForSignals", () => {
  it("returns undefined with no signals", () => {
    expect(conservativeActionForSignals([], {})).toBeUndefined();
  });

  it("guardrail-failing always resolves to rollback, regardless of action map", () => {
    expect(conservativeActionForSignals(["guardrail-failing"], {})).toBe(
      "rollback",
    );
  });

  it("signal-regression resolves to hold", () => {
    expect(conservativeActionForSignals(["signal-regression"], {})).toBe(
      "hold",
    );
  });

  it("below-min-sample resolves to hold", () => {
    expect(conservativeActionForSignals(["below-min-sample"], {})).toBe("hold");
  });

  it("srm with hold action → hold", () => {
    expect(conservativeActionForSignals(["srm"], { srm: "hold" })).toBe("hold");
  });

  it("srm with warn action → warn", () => {
    expect(conservativeActionForSignals(["srm"], { srm: "warn" })).toBe("warn");
  });

  it("srm with rollback action → rollback", () => {
    expect(conservativeActionForSignals(["srm"], { srm: "rollback" })).toBe(
      "rollback",
    );
  });

  it("multiple-exposures with hold → hold", () => {
    expect(
      conservativeActionForSignals(["multiple-exposures"], {
        "multiple-exposures": "hold",
      }),
    ).toBe("hold");
  });

  it("no-traffic with warn → warn", () => {
    expect(
      conservativeActionForSignals(["no-traffic"], { "no-traffic": "warn" }),
    ).toBe("warn");
  });

  it("guardrail-failing + signal-regression → rollback (most severe wins)", () => {
    expect(
      conservativeActionForSignals(
        ["signal-regression", "guardrail-failing"],
        {},
      ),
    ).toBe("rollback");
  });

  it("signal-regression + srm-hold → hold", () => {
    expect(
      conservativeActionForSignals(["signal-regression", "srm"], {
        srm: "hold",
      }),
    ).toBe("hold");
  });

  it("srm-warn + no-traffic-warn → warn when no hold/rollback signals present", () => {
    expect(
      conservativeActionForSignals(["srm", "no-traffic"], {
        srm: "warn",
        "no-traffic": "warn",
      }),
    ).toBe("warn");
  });

  it("hold beats warn when both are present", () => {
    expect(
      conservativeActionForSignals(["srm", "no-traffic"], {
        srm: "hold",
        "no-traffic": "warn",
      }),
    ).toBe("hold");
  });

  it("rollback beats hold beats warn", () => {
    expect(
      conservativeActionForSignals(
        ["srm", "no-traffic", "multiple-exposures"],
        {
          srm: "warn",
          "no-traffic": "hold",
          "multiple-exposures": "rollback",
        },
      ),
    ).toBe("rollback");
  });
});

// ---------------------------------------------------------------------------
// 4. isOnMonitoredStep
// ---------------------------------------------------------------------------

describe("isOnMonitoredStep", () => {
  it("returns true for a running schedule on a monitored step", () => {
    expect(isOnMonitoredStep(makeSchedule())).toBe(true);
  });

  it("returns true for a paused schedule on a monitored step", () => {
    expect(isOnMonitoredStep(makeSchedule({ status: "paused" }))).toBe(true);
  });

  it("returns false for terminal statuses", () => {
    for (const status of [
      "pending",
      "ready",
      "completed",
      "rolled-back",
    ] as const) {
      expect(isOnMonitoredStep(makeSchedule({ status }))).toBe(false);
    }
  });

  it("returns false when the current step is not monitored", () => {
    expect(isOnMonitoredStep(makeSchedule({ steps: [UNMONITORED_STEP] }))).toBe(
      false,
    );
  });

  it("returns false when currentStepIndex is -1", () => {
    expect(isOnMonitoredStep(makeSchedule({ currentStepIndex: -1 }))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. getRampHealthOverview — terminal / inactive states
// ---------------------------------------------------------------------------

describe("getRampHealthOverview — terminal/inactive", () => {
  it("rolled-back → critical severity with reason", () => {
    const r = getRampHealthOverview(
      makeSchedule({
        status: "rolled-back",
        lastRollbackReason: "guardrail failing",
      }),
      NO_SIGNALS,
    );
    expect(r.severity).toBe("critical");
    expect(r.label).toBe("Rolled back");
    expect(r.summary).toContain("guardrail failing");
  });

  it("rolled-back without reason → generic summary", () => {
    const r = getRampHealthOverview(
      makeSchedule({ status: "rolled-back", lastRollbackReason: null }),
      NO_SIGNALS,
    );
    expect(r.severity).toBe("critical");
    expect(r.summary).toBeTruthy();
  });

  it("completed → inactive", () => {
    const r = getRampHealthOverview(
      makeSchedule({ status: "completed" }),
      NO_SIGNALS,
    );
    expect(r.severity).toBe("inactive");
    expect(r.label).toBe("Complete");
  });

  it("pending → inactive, mentions which step monitoring begins", () => {
    const r = getRampHealthOverview(
      makeSchedule({ status: "pending", currentStepIndex: -1 }),
      NO_SIGNALS,
    );
    expect(r.severity).toBe("inactive");
    expect(r.label).toBe("Not started");
    expect(r.summary).toMatch(/Step 1/);
  });

  it("ready → inactive", () => {
    const r = getRampHealthOverview(
      makeSchedule({ status: "ready", currentStepIndex: -1 }),
      NO_SIGNALS,
    );
    expect(r.severity).toBe("inactive");
  });

  it("paused on a monitored step → inactive (not an error)", () => {
    const r = getRampHealthOverview(
      makeSchedule({ status: "paused" }),
      NO_SIGNALS,
    );
    expect(r.severity).toBe("inactive");
    expect(r.label).toBe("Paused");
  });

  it("awaiting approval → inactive, approval-specific label", () => {
    const s = makeSchedule({
      steps: [APPROVAL_STEP],
      stepApproval: null,
    });
    const r = getRampHealthOverview(s, NO_SIGNALS);
    expect(r.severity).toBe("inactive");
    expect(r.label).toBe("Awaiting approval");
  });

  it("awaiting approval with notes → uses the approval notes as summary", () => {
    const s = makeSchedule({
      steps: [{ ...APPROVAL_STEP, approvalNotes: "Needs VP sign-off" }],
      stepApproval: null,
    });
    const r = getRampHealthOverview(s, NO_SIGNALS);
    expect(r.summary).toBe("Needs VP sign-off");
  });

  it("running on an unmonitored step → inactive, points to next monitored step", () => {
    const s = makeSchedule({
      steps: [UNMONITORED_STEP, MONITORED_STEP],
      currentStepIndex: 0,
    });
    const r = getRampHealthOverview(s, NO_SIGNALS);
    expect(r.severity).toBe("inactive");
    expect(r.label).toBe("Unmonitored step");
    expect(r.summary).toMatch(/Step 2/);
  });

  it("running on an unmonitored step after all monitored steps → 'Monitoring was active on earlier steps'", () => {
    const s = makeSchedule({
      steps: [MONITORED_STEP, UNMONITORED_STEP],
      currentStepIndex: 1,
      currentStepEnteredAt: new Date(),
    });
    const r = getRampHealthOverview(s, NO_SIGNALS);
    expect(r.summary).toMatch(/earlier steps/);
  });
});

// ---------------------------------------------------------------------------
// 6. getRampHealthOverview — active monitoring (healthy & no-issue states)
// ---------------------------------------------------------------------------

describe("getRampHealthOverview — healthy monitoring", () => {
  beforeEach(() => vi.setSystemTime(NOW));
  afterEach(() => vi.useRealTimers());

  it("running on monitored step with no signals → healthy", () => {
    const r = getRampHealthOverview(makeSchedule(), NO_SIGNALS);
    expect(r.severity).toBe("healthy");
  });

  it("autoExpand is false when healthy", () => {
    const r = getRampHealthOverview(makeSchedule(), NO_SIGNALS);
    expect(r.autoExpand).toBe(false);
  });

  it("awaiting-data signal → info severity", () => {
    const r = getRampHealthOverview(makeSchedule(), sig(["awaiting-data"]));
    expect(r.severity).toBe("info");
    expect(r.label).toMatch(/no data/i);
  });
});

// ---------------------------------------------------------------------------
// 7. getRampHealthOverview — single signal scenarios
// ---------------------------------------------------------------------------

describe("getRampHealthOverview — single signals", () => {
  beforeEach(() => vi.setSystemTime(NOW));
  afterEach(() => vi.useRealTimers());

  it("guardrail-failing → critical, autoExpand", () => {
    const r = getRampHealthOverview(
      makeSchedule(),
      sig(["guardrail-failing"], { "guardrail-failing": "rollback" }),
    );
    expect(r.severity).toBe("critical");
    expect(r.label).toBe("Guardrail failing");
    expect(r.autoExpand).toBe(true);
  });

  it("signal-regression on active hold → 'Holding' prefix", () => {
    const s = makeSchedule({
      currentStepEnteredAt: new Date(NOW.getTime() - 3600 * 1000), // interval elapsed
    });
    const r = getRampHealthOverview(s, sig(["signal-regression"]));
    expect(r.severity).toBe("warning");
    expect(r.summary).toMatch(/Holding/);
  });

  it("signal-regression before interval elapsed → 'Step may hold when complete' prefix", () => {
    // 30 min into 1-hour step → not holding yet
    const r = getRampHealthOverview(makeSchedule(), sig(["signal-regression"]));
    expect(r.severity).toBe("warning");
    expect(r.summary).toMatch(/may hold/);
  });

  it("srm with hold action → warning severity", () => {
    const r = getRampHealthOverview(
      makeSchedule(),
      sig(["srm"], { srm: "hold" }),
    );
    expect(r.severity).toBe("warning");
    expect(r.label).toBe("SRM detected");
  });

  it("srm with rollback action → critical severity", () => {
    const r = getRampHealthOverview(
      makeSchedule(),
      sig(["srm"], { srm: "rollback" }),
    );
    expect(r.severity).toBe("critical");
  });

  it("srm with warn action → warning severity, not critical", () => {
    const r = getRampHealthOverview(
      makeSchedule(),
      sig(["srm"], { srm: "warn" }),
    );
    expect(r.severity).toBe("warning");
  });

  it("multiple-exposures with hold → warning", () => {
    const r = getRampHealthOverview(
      makeSchedule(),
      sig(["multiple-exposures"], { "multiple-exposures": "hold" }),
    );
    expect(r.severity).toBe("warning");
    expect(r.label).toBe("Multiple exposures");
  });

  it("no-traffic with hold → warning", () => {
    const r = getRampHealthOverview(
      makeSchedule(),
      sig(["no-traffic"], { "no-traffic": "hold" }),
    );
    expect(r.severity).toBe("warning");
    expect(r.label).toBe("No traffic");
    expect(r.summary).toMatch(/Holding|may hold/);
  });

  it("no-traffic with rollback → critical", () => {
    const r = getRampHealthOverview(
      makeSchedule(),
      sig(["no-traffic"], { "no-traffic": "rollback" }),
    );
    expect(r.severity).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// 8. getRampHealthOverview — below-min-sample timing gate
// ---------------------------------------------------------------------------

describe("getRampHealthOverview — below-min-sample timing gate", () => {
  afterEach(() => vi.useRealTimers());

  it("below-min-sample is suppressed before interval elapses (holdingNow = false)", () => {
    // 30 min into a 1-hour step (not holding)
    vi.setSystemTime(NOW);
    const r = getRampHealthOverview(
      makeSchedule(),
      sig(["below-min-sample"], {}, { "below-min-sample": "50 of 200 users" }),
    );
    // Should not show as an active issue — falls through to healthy
    expect(r.severity).toBe("healthy");
    expect(r.label).not.toMatch(/sample/i);
  });

  it("below-min-sample shows as info once the interval has fully elapsed", () => {
    const s = makeSchedule({
      currentStepEnteredAt: new Date(NOW.getTime() - 3600 * 1000),
    });
    vi.setSystemTime(NOW);
    const r = getRampHealthOverview(
      s,
      sig(["below-min-sample"], {}, { "below-min-sample": "50 of 200 users" }),
    );
    expect(r.severity).toBe("info");
    expect(r.label).toMatch(/sample/i);
    expect(r.summary).toContain("50 of 200");
  });

  it("below-min-sample combined with another hold signal — both visible when holding", () => {
    const s = makeSchedule({
      currentStepEnteredAt: new Date(NOW.getTime() - 3600 * 1000),
    });
    vi.setSystemTime(NOW);
    const r = getRampHealthOverview(
      s,
      sig(
        ["signal-regression", "below-min-sample"],
        {},
        { "below-min-sample": "50 of 200 users" },
      ),
    );
    // Multiple signals → "Multiple issues" label
    expect(r.label).toMatch(/multiple/i);
    expect(r.severity).toBe("warning");
    expect(r.autoExpand).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. getRampHealthOverview — multiple-signal combinations
// ---------------------------------------------------------------------------

describe("getRampHealthOverview — multiple signals", () => {
  beforeEach(() => vi.setSystemTime(NOW));
  afterEach(() => vi.useRealTimers());

  it("two hold signals → 'Multiple issues' label, warning severity", () => {
    const r = getRampHealthOverview(
      makeSchedule(),
      sig(["signal-regression", "srm"], { srm: "hold" }),
    );
    expect(r.label).toMatch(/multiple/i);
    expect(r.severity).toBe("warning");
    expect(r.autoExpand).toBe(true);
  });

  it("guardrail + signal-regression → critical (rollback dominates)", () => {
    const r = getRampHealthOverview(
      makeSchedule(),
      sig(["guardrail-failing", "signal-regression"], {
        "guardrail-failing": "rollback",
      }),
    );
    expect(r.severity).toBe("critical");
    expect(r.summary).toMatch(/Rolling back/);
  });

  it("warn + hold signals → warning (hold wins over warn)", () => {
    const r = getRampHealthOverview(
      makeSchedule(),
      sig(["srm", "no-traffic"], { srm: "hold", "no-traffic": "warn" }),
    );
    expect(r.severity).toBe("warning");
  });

  it("all warn signals → warning severity, multiple issues label", () => {
    const r = getRampHealthOverview(
      makeSchedule(),
      sig(["srm", "no-traffic"], { srm: "warn", "no-traffic": "warn" }),
    );
    expect(r.label).toMatch(/multiple/i);
    expect(r.severity).toBe("warning");
  });

  it("summary includes descriptions of each active signal", () => {
    const r = getRampHealthOverview(
      makeSchedule(),
      sig(["signal-regression", "srm"], { srm: "hold" }, { srm: "p=0.02" }),
    );
    // summary should contain at least one of the signal descriptions
    expect(r.summary.length).toBeGreaterThan(0);
  });

  it("three signals including rollback → critical, autoExpand", () => {
    const r = getRampHealthOverview(
      makeSchedule(),
      sig(["srm", "no-traffic", "guardrail-failing"], {
        srm: "warn",
        "no-traffic": "hold",
        "guardrail-failing": "rollback",
      }),
    );
    expect(r.severity).toBe("critical");
    expect(r.autoExpand).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Edge / boundary cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  afterEach(() => vi.useRealTimers());

  it("schedule with no steps at all — isOnMonitoredStep false", () => {
    const s = makeSchedule({ steps: [], currentStepIndex: -1 });
    expect(isOnMonitoredStep(s)).toBe(false);
  });

  it("isHoldingNow with a zero-second interval step (instant, should be true immediately)", () => {
    vi.setSystemTime(NOW);
    const s = makeSchedule({
      steps: [{ ...MONITORED_STEP, interval: 0 }],
      currentStepEnteredAt: new Date(NOW.getTime() - 1), // 1ms ago
    });
    expect(isHoldingNow(s)).toBe(true);
  });

  it("getRampHealthOverview for a multi-step schedule where first step is unmonitored and second is monitored — on step 1", () => {
    vi.setSystemTime(NOW);
    const s = makeSchedule({
      steps: [UNMONITORED_STEP, MONITORED_STEP],
      currentStepIndex: 0,
    });
    const r = getRampHealthOverview(s, NO_SIGNALS);
    expect(r.severity).toBe("inactive");
    expect(r.summary).toMatch(/Step 2/);
  });

  it("getRampHealthOverview for completed schedule ignores any passed signals", () => {
    vi.setSystemTime(NOW);
    const r = getRampHealthOverview(
      makeSchedule({ status: "completed" }),
      sig(["guardrail-failing"], { "guardrail-failing": "rollback" }),
    );
    // Completed status short-circuits before signals are evaluated
    expect(r.severity).toBe("inactive");
    expect(r.label).toBe("Complete");
  });

  it("approval already granted for the current step — not awaiting-approval", () => {
    const s = makeSchedule({
      steps: [APPROVAL_STEP],
      stepApproval: {
        stepIndex: 0,
        approvedAt: new Date(),
        approvedBy: "user_1",
        context: "ui",
      },
    });
    vi.setSystemTime(NOW);
    // stepApproval.stepIndex === currentStepIndex → approval satisfied
    const r = getRampHealthOverview(s, NO_SIGNALS);
    // Should NOT show "Awaiting approval"
    expect(r.label).not.toBe("Awaiting approval");
  });

  it("signal-regression on a paused schedule — paused state takes priority", () => {
    const r = getRampHealthOverview(
      makeSchedule({ status: "paused" }),
      sig(["signal-regression"]),
    );
    expect(r.label).toBe("Paused");
  });
});
