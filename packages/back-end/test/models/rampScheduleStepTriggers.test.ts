// Mocked only to sever the heavy services/rampSchedule import chain — no test
// here exercises the monitoringStatus branch that calls these.
jest.mock("back-end/src/services/rampSchedule", () => ({
  getEffectiveRampAutoUpdateState: jest.fn(),
  getRampMonitoringMode: jest.fn(),
  getRampAutoUpdatePreference: jest.fn(),
}));

import {
  migrateRampStepTriggers,
  normalizeApiStepShapes,
} from "back-end/src/models/RampScheduleModel";
import { BadRequestError } from "back-end/src/util/errors";

const START = new Date("2024-01-01T00:00:00Z");
const DAY = 24 * 60 * 60;

function isoDaysAfterStart(days: number): string {
  return new Date(START.getTime() + days * DAY * 1000).toISOString();
}

describe("migrateRampStepTriggers", () => {
  it("converts scheduled trigger dates to relative intervals", () => {
    // A dated multi-day plan: each step scheduled one day after the previous.
    const doc = {
      startDate: START,
      dateCreated: START,
      steps: [1, 2, 3, 4, 5].map((day) => ({
        trigger: { type: "scheduled" as const, at: isoDaysAfterStart(day) },
        actions: [],
      })),
    };
    const migrated = migrateRampStepTriggers(doc);
    expect(migrated.steps?.map((s) => s.interval)).toEqual([
      DAY,
      DAY,
      DAY,
      DAY,
      DAY,
    ]);
    expect(migrated.steps?.every((s) => !("trigger" in s))).toBe(true);
    expect(migrated.steps?.every((s) => !s.holdConditions)).toBe(true);
  });

  it("prefers the phase start over startDate as the anchor, matching the evaluator", () => {
    // A schedule that started 2 days late: steps fire at phaseStartedAt +
    // cumulative interval, so deltas must be measured from phaseStartedAt to
    // reproduce the plan's absolute dates.
    const phaseStart = new Date(START.getTime() + 2 * DAY * 1000);
    const doc = {
      startDate: START,
      phaseStartedAt: phaseStart,
      steps: [
        {
          trigger: { type: "scheduled" as const, at: isoDaysAfterStart(5) },
          actions: [],
        },
      ],
    };
    expect(migrateRampStepTriggers(doc).steps?.[0].interval).toBe(3 * DAY);
  });

  it("anchors at the first scheduled date when the doc has no date fields", () => {
    // Revision ramp actions and templates carry no dateCreated (and may have
    // no startDate): the first step fires ~instantly and later steps keep the
    // plan's relative pacing.
    const doc = {
      steps: [
        {
          trigger: { type: "scheduled" as const, at: isoDaysAfterStart(10) },
          actions: [],
        },
        {
          trigger: { type: "scheduled" as const, at: isoDaysAfterStart(12) },
          actions: [],
        },
      ],
    };
    const migrated = migrateRampStepTriggers(doc);
    // Step 0 clamps to 1s (its date IS the anchor); step 1 keeps the plan's
    // 2-day spacing, less the 1s the clamp already consumed.
    expect(migrated.steps?.map((s) => s.interval)).toEqual([1, 2 * DAY - 1]);
    expect(migrated.steps?.every((s) => !s.holdConditions)).toBe(true);
  });

  it("anchors the first scheduled step at startDate, falling back to dateCreated", () => {
    const noStartDate = {
      dateCreated: START,
      steps: [
        {
          trigger: { type: "scheduled" as const, at: isoDaysAfterStart(2) },
          actions: [],
        },
      ],
    };
    expect(migrateRampStepTriggers(noStartDate).steps?.[0].interval).toBe(
      2 * DAY,
    );
  });

  it("clamps past or out-of-order dates to a 1s interval instead of removing the gate", () => {
    const doc = {
      startDate: START,
      steps: [
        {
          trigger: { type: "scheduled" as const, at: isoDaysAfterStart(3) },
          actions: [],
        },
        // Earlier than the previous step — already due per the plan.
        {
          trigger: { type: "scheduled" as const, at: isoDaysAfterStart(1) },
          actions: [],
        },
      ],
    };
    const migrated = migrateRampStepTriggers(doc);
    expect(migrated.steps?.[0].interval).toBe(3 * DAY);
    expect(migrated.steps?.[1].interval).toBe(1);
  });

  it("advances the date cursor across interval triggers and already-migrated steps", () => {
    const doc = {
      startDate: START,
      steps: [
        // Already-migrated step: one day.
        { interval: DAY, actions: [] },
        // Legacy interval trigger: one more day.
        { trigger: { type: "interval" as const, seconds: DAY }, actions: [] },
        // Scheduled at day 3 — only one day after the two above.
        {
          trigger: { type: "scheduled" as const, at: isoDaysAfterStart(3) },
          actions: [],
        },
      ],
    };
    const migrated = migrateRampStepTriggers(doc);
    expect(migrated.steps?.map((s) => s.interval)).toEqual([DAY, DAY, DAY]);
  });

  it("fails safe to an approval hold when a scheduled date is unparseable", () => {
    const doc = {
      startDate: START,
      steps: [
        {
          trigger: { type: "scheduled" as const, at: "not-a-date" },
          actions: [],
        },
      ],
    };
    const migrated = migrateRampStepTriggers(doc);
    expect(migrated.steps?.[0].interval).toBeNull();
    expect(migrated.steps?.[0].holdConditions?.requiresApproval).toBe(true);
  });

  it("is idempotent and preserves approval and interval trigger conversion", () => {
    const doc = {
      startDate: START,
      steps: [
        { trigger: { type: "interval" as const, seconds: 300 }, actions: [] },
        { trigger: { type: "approval" as const }, actions: [] },
      ],
    };
    const once = migrateRampStepTriggers(doc);
    expect(once.steps?.[0].interval).toBe(300);
    expect(once.steps?.[1].interval).toBeNull();
    expect(once.steps?.[1].holdConditions?.requiresApproval).toBe(true);
    const twice = migrateRampStepTriggers(once);
    expect(twice).toBe(once);
  });
});

describe("normalizeApiStepShapes", () => {
  it("converts scheduled trigger dates to relative intervals from the anchor", () => {
    const normalized = normalizeApiStepShapes(
      [
        { trigger: { type: "scheduled", at: isoDaysAfterStart(1) } },
        { trigger: { type: "scheduled", at: isoDaysAfterStart(2) } },
      ],
      START,
    );
    expect(normalized).toEqual([{ interval: DAY }, { interval: DAY }]);
  });

  it("passes through the unified shape and legacy interval/approval triggers", () => {
    const normalized = normalizeApiStepShapes(
      [
        { interval: 600, holdConditions: { minSampleSize: 100 } },
        { trigger: { type: "interval", seconds: 300 } },
        { trigger: { type: "approval" } },
      ],
      START,
    );
    expect(normalized).toEqual([
      { interval: 600, holdConditions: { minSampleSize: 100 } },
      { interval: 300 },
      { interval: null, holdConditions: { requiresApproval: true } },
    ]);
  });

  it("measures a scheduled date against preceding interval steps", () => {
    const normalized = normalizeApiStepShapes(
      [
        { interval: DAY },
        { trigger: { type: "scheduled", at: isoDaysAfterStart(3) } },
      ],
      START,
    );
    expect(normalized[1].interval).toBe(2 * DAY);
  });

  it("rejects an unparseable scheduled date", () => {
    expect(() =>
      normalizeApiStepShapes(
        [{ trigger: { type: "scheduled", at: "not-a-date" } }],
        START,
      ),
    ).toThrow(BadRequestError);
  });

  it("rejects scheduled dates that do not increase", () => {
    expect(() =>
      normalizeApiStepShapes(
        [
          { trigger: { type: "scheduled", at: isoDaysAfterStart(2) } },
          { trigger: { type: "scheduled", at: isoDaysAfterStart(1) } },
        ],
        START,
      ),
    ).toThrow(BadRequestError);
    expect(() =>
      normalizeApiStepShapes(
        [{ trigger: { type: "scheduled", at: START.toISOString() } }],
        START,
      ),
    ).toThrow(BadRequestError);
  });
});
