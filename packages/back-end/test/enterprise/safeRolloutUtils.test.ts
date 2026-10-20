import { SafeRolloutInterface } from "shared/types/safe-rollout";
import { OrganizationInterface } from "shared/types/organization";
import { determineNextSafeRolloutSnapshotAttempt } from "back-end/src/enterprise/saferollouts/safeRolloutUtils";

const ORG_SCHEDULE_NEXT = new Date("2026-07-14T20:45:55.000Z");
const NOW = new Date("2026-07-14T15:00:00.000Z");

jest.mock("back-end/src/services/experiments", () => ({
  determineNextDate: jest.fn(() => new Date("2026-07-14T20:45:55.000Z")),
}));

jest.mock("back-end/src/models/FeatureModel", () => ({
  editFeatureRule: jest.fn(),
  publishRevision: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  createRevision: jest.fn(),
  getRevision: jest.fn(),
}));

jest.mock("back-end/src/enterprise/licenseUtil", () => ({
  orgHasPremiumFeature: jest.fn(),
}));

function makeSafeRollout(
  overrides: Partial<SafeRolloutInterface> = {},
): SafeRolloutInterface {
  return {
    id: "sr_1",
    organization: "org_1",
    featureId: "feat_1",
    status: "running",
    ...overrides,
  } as SafeRolloutInterface;
}

const org = {
  id: "org_1",
  settings: { updateSchedule: { type: "stale", hours: 24 } },
} as OrganizationInterface;

describe("determineNextSafeRolloutSnapshotAttempt", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("honors the ramp's updateScheduleMinutes cadence over the org schedule", () => {
    const safeRollout = makeSafeRollout({ updateScheduleMinutes: 360 });

    const { nextSnapshot, nextRampUp } =
      determineNextSafeRolloutSnapshotAttempt(safeRollout, org);

    expect(nextSnapshot.getTime()).toBe(NOW.getTime() + 360 * 60 * 1000);
    expect(nextSnapshot.getTime()).not.toBe(ORG_SCHEDULE_NEXT.getTime());
    expect(nextRampUp.getTime()).toBe(NOW.getTime() + 360 * 60 * 1000);
  });

  it("respects a sub-hour cadence", () => {
    const safeRollout = makeSafeRollout({ updateScheduleMinutes: 10 });

    const { nextSnapshot } = determineNextSafeRolloutSnapshotAttempt(
      safeRollout,
      org,
    );

    expect(nextSnapshot.getTime()).toBe(NOW.getTime() + 10 * 60 * 1000);
  });

  it("falls back to the org update schedule when updateScheduleMinutes is unset", () => {
    const safeRollout = makeSafeRollout();

    const { nextSnapshot } = determineNextSafeRolloutSnapshotAttempt(
      safeRollout,
      org,
    );

    expect(nextSnapshot.getTime()).toBe(ORG_SCHEDULE_NEXT.getTime());
  });
});
