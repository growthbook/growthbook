import { ContextualBanditInterface } from "shared/validators";
import {
  computeContextualBanditStageAndSchedule,
  determineNextContextualBanditSchedule,
} from "back-end/src/services/contextualBanditSchedule";

const NOW = new Date("2025-03-10T00:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function makeCb(
  overrides: Partial<ContextualBanditInterface> = {},
): ContextualBanditInterface {
  return {
    id: "cb_1",
    organization: "org_1",
    dateStarted: NOW,
    stage: "explore",
    stageDateStarted: NOW,
    scheduleValue: 1,
    scheduleUnit: "days",
    burnInValue: 6,
    burnInUnit: "hours",
    ...overrides,
  } as unknown as ContextualBanditInterface;
}

describe("determineNextContextualBanditSchedule", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns the burn-in end during explore when it lands before the next cadence boundary", () => {
    const next = determineNextContextualBanditSchedule(makeCb());
    expect(next.getTime()).toBe(NOW.getTime() + 6 * HOUR);
  });

  it("returns the next standard cadence boundary during exploit", () => {
    const next = determineNextContextualBanditSchedule(
      makeCb({ stage: "exploit" }),
    );
    expect(next.getTime()).toBe(NOW.getTime() + DAY);
  });

  it("ignores the burn-in branch in explore when burn-in is at/after the cadence boundary", () => {
    const next = determineNextContextualBanditSchedule(
      makeCb({
        burnInValue: 2,
        burnInUnit: "days",
      }),
    );
    expect(next.getTime()).toBe(NOW.getTime() + DAY);
  });

  it("throws when a schedule/burn-in field is unset", () => {
    expect(() =>
      determineNextContextualBanditSchedule(
        makeCb({ scheduleValue: undefined }),
      ),
    ).toThrow(/scheduleValue is unset/);
  });
});

describe("computeContextualBanditStageAndSchedule", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("reschedules without a stage change while still inside the explore (burn-in) window", () => {
    // Started 1h ago with a 6h burn-in: still exploring, but the next attempt
    // must advance (to the burn-in end) so the cron doesn't re-queue the CB
    // on every tick.
    const cb = makeCb({
      stageDateStarted: new Date(NOW.getTime() - 1 * HOUR),
    });
    const changes = computeContextualBanditStageAndSchedule(cb);
    expect(changes.stage).toBeUndefined();
    expect(changes.stageDateStarted).toBeUndefined();
    expect(changes.nextSnapshotAttempt?.getTime()).toBe(
      NOW.getTime() + 5 * HOUR,
    );
  });

  it("transitions explore -> exploit once burn-in elapses and schedules the next run", () => {
    const cb = makeCb({
      stageDateStarted: new Date(NOW.getTime() - 7 * HOUR),
    });
    const changes = computeContextualBanditStageAndSchedule(cb);
    expect(changes.stage).toBe("exploit");
    expect(changes.stageDateStarted).toEqual(NOW);
    expect(changes.nextSnapshotAttempt?.getTime()).toBe(NOW.getTime() + DAY);
  });

  it("reschedules without a stage change when already in exploit", () => {
    const cb = makeCb({
      stage: "exploit",
      stageDateStarted: NOW,
    });
    const changes = computeContextualBanditStageAndSchedule(cb);
    expect(changes.stage).toBeUndefined();
    expect(changes.nextSnapshotAttempt?.getTime()).toBe(NOW.getTime() + DAY);
  });
});
