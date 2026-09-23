jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: jest.fn(),
}));

import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import {
  assertRevertRampStopsAcknowledged,
  assertUnattendedRevertRampStopsPredateDraft,
  resolveRevertRampStopsForRevision,
  revertRampStopGate,
} from "back-end/src/revisions/revertRampGuard";
import { SoftWarningError } from "back-end/src/util/errors";
import { assertRevertHasChanges } from "back-end/src/services/revertGuards";

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

function contextWith({
  isApiRequest = false,
  ignoreWarnings = false,
  req = {},
}: {
  isApiRequest?: boolean;
  ignoreWarnings?: boolean;
  req?: object | null;
} = {}) {
  return {
    isApiRequest,
    ignoreWarnings,
    req: req ?? undefined,
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
    // An edited or forked revert draft keeps only the provenance marker.
    await expect(
      resolveRevertRampStopsForRevision(context, feature, {
        revertedFromVersion: 2,
      } as never),
    ).resolves.toEqual({ detaches: [], warning: null, schedules: [] });
    expect(mockGetRevision).not.toHaveBeenCalled();
  });

  it("resolves a revert draft's target by revertedFrom", async () => {
    const stops = await resolveRevertRampStopsForRevision(
      contextWith(),
      feature,
      { revertedFrom: 2 },
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

  it("counts removing a predated ramp as the diff of an otherwise empty revert", async () => {
    const target = {
      version: 2,
      datePublished: new Date("2026-09-11T00:00:00Z"),
    } as never;
    await expect(
      assertRevertHasChanges(contextWith(), feature, {}, {
        ...(target as object),
        rampAttachments: [{ rampScheduleId: "rs_1", ruleId: "fr_1" }],
      } as never),
    ).rejects.toThrow(/Nothing to revert: .* revision #2/);
    await expect(
      assertRevertHasChanges(contextWith(), feature, {}, {
        ...(target as object),
        rampAttachments: [],
      } as never),
    ).resolves.toBeUndefined();
    await expect(
      assertRevertHasChanges(
        contextWith(),
        feature,
        { defaultValue: "x" },
        target,
      ),
    ).resolves.toBeUndefined();
  });

  it("fails an unattended publish that would delete a ramp attached after the draft", async () => {
    const stops = await resolveRevertRampStopsForRevision(
      contextWith(),
      feature,
      { revertedFrom: 2 },
    );
    const background = contextWith({ req: null, ignoreWarnings: true });
    const draftBefore = { dateCreated: new Date("2026-09-09T00:00:00Z") };
    const draftAfter = { dateCreated: new Date("2026-09-12T00:00:00Z") };
    expect(() =>
      assertUnattendedRevertRampStopsPredateDraft(
        background,
        draftBefore,
        stops,
      ),
    ).toThrow(/"Gradual rollout" \(rs_1\), attached after the revert draft/);
    expect(() =>
      assertUnattendedRevertRampStopsPredateDraft(
        background,
        draftAfter,
        stops,
      ),
    ).not.toThrow();
    expect(() =>
      assertUnattendedRevertRampStopsPredateDraft(
        contextWith(),
        draftBefore,
        stops,
      ),
    ).not.toThrow();
  });
});
