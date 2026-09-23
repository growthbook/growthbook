jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: jest.fn(),
}));

import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import {
  assertRevertRampStopsAcknowledged,
  resolveRevertRampStopsForRevision,
  revertRampStopGate,
} from "back-end/src/revisions/revertRampGuard";
import { SoftWarningError } from "back-end/src/util/errors";

const mockGetRevision = getRevision as jest.MockedFunction<typeof getRevision>;

const feature = { id: "feat", organization: "org_1" } as never;
const ramp = {
  id: "rs_1",
  name: "Gradual rollout",
  status: "running",
  dateCreated: new Date("2026-09-10T00:00:00Z"),
  targets: [
    {
      id: "t_1",
      entityType: "feature",
      entityId: "feat",
      ruleId: "fr_1",
      status: "active",
    },
  ],
};

function contextWith({ isApiRequest = false, ignoreWarnings = false } = {}) {
  return {
    isApiRequest,
    ignoreWarnings,
    models: {
      rampSchedules: { getAllByFeatureId: jest.fn().mockResolvedValue([ramp]) },
    },
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetRevision.mockResolvedValue({
    version: 2,
    datePublished: new Date("2026-09-11T00:00:00Z"),
    rampAttachments: [],
  } as never);
});

describe("revertRampGuard", () => {
  it("skips non-revert revisions without reading anything", async () => {
    const context = contextWith();
    await expect(
      resolveRevertRampStopsForRevision(context, feature, {}),
    ).resolves.toEqual({ detaches: [], warning: null });
    expect(mockGetRevision).not.toHaveBeenCalled();
  });

  it("resolves a revert draft's target by revertedFromVersion", async () => {
    const stops = await resolveRevertRampStopsForRevision(
      contextWith(),
      feature,
      { revertedFromVersion: 2 },
    );
    expect(mockGetRevision.mock.calls[0][0].version).toBe(2);
    expect(stops.detaches).toEqual([
      {
        mode: "detach",
        rampScheduleId: "rs_1",
        ruleId: "fr_1",
        deleteScheduleWhenEmpty: true,
      },
    ]);
    expect(stops.warning).toBe(
      'This revert will delete the ramp-up on Rule "fr_1".',
    );
  });

  it("warns until acknowledged", async () => {
    const stops = await resolveRevertRampStopsForRevision(
      contextWith(),
      feature,
      { revertedFrom: 2 },
    );
    expect(() =>
      assertRevertRampStopsAcknowledged(contextWith(), stops),
    ).toThrow(SoftWarningError);
    expect(() =>
      assertRevertRampStopsAcknowledged(
        contextWith({ ignoreWarnings: true }),
        stops,
      ),
    ).not.toThrow();
  });

  it("names the schedule in the REST gate", async () => {
    await expect(
      revertRampStopGate(contextWith({ isApiRequest: true }), feature, {
        revertedFrom: 2,
      }),
    ).resolves.toMatchObject({
      type: "revert-stops-ramp",
      severity: "warning",
      override: "ignoreWarnings",
      messages: [
        'This revert will delete the ramp schedule "Gradual rollout" (rs_1) on Rule "fr_1".',
      ],
    });
  });
});
