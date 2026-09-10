import { MockedFunction, Mock, vi } from "vitest";
import type { OrganizationInterface } from "shared/types/organization";
import type { EventUser } from "shared/types/events/event-types";

vi.mock("back-end/src/models/FeatureModel", () => ({
  getFeature: vi.fn(),
  createAndPublishRevision: vi.fn(),
}));

vi.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: vi.fn(),
}));

vi.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentMapForFeature: vi.fn(),
}));

vi.mock("back-end/src/services/features", () => ({
  getApiFeatureObj: vi.fn(),
  getSavedGroupMap: vi.fn(),
}));

vi.mock("back-end/src/services/audit", () => ({
  auditDetailsUpdate: vi.fn(() => ({})),
}));

vi.mock("back-end/src/models/EventModel", () => ({
  createEvent: vi.fn(),
}));

vi.mock("back-end/src/util/logger", () => ({
  logger: { error: vi.fn() },
}));

// Keep the real getPublishedRevisionForEvents (it drives the re-read/fallback
// behavior under test, via the mocked getRevision) and stub only the dispatch.
vi.mock("back-end/src/services/featureRevisionEvents", async () => ({
  ...(await vi.importActual<
    typeof import("back-end/src/services/featureRevisionEvents")
  >("back-end/src/services/featureRevisionEvents")),
  dispatchFeatureRevisionEvent: vi.fn(),
}));

vi.mock("back-end/src/services/organizations", () => ({
  getEnvironments: vi.fn(() => [
    { id: "production", description: "" },
    { id: "dev", description: "" },
  ]),
}));

vi.mock("back-end/src/util/features", () => ({
  getEnabledEnvironments: vi.fn(() => new Set(["production", "dev"])),
}));

vi.mock("back-end/src/util/organization.util", async () => ({
  ...(await vi.importActual<
    typeof import("back-end/src/util/organization.util")
  >("back-end/src/util/organization.util")),
  getEnvironmentIdsFromOrg: vi.fn(() => ["production", "dev"]),
}));

import { revertFeatureCore } from "back-end/src/api/features/revertFeature";
import {
  createAndPublishRevision,
  getFeature,
} from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getExperimentMapForFeature } from "back-end/src/models/ExperimentModel";
import { dispatchFeatureRevisionEvent } from "back-end/src/services/featureRevisionEvents";

const mockGetFeature = getFeature as MockedFunction<typeof getFeature>;
const mockGetRevision = getRevision as MockedFunction<typeof getRevision>;
const mockCreateAndPublish = createAndPublishRevision as MockedFunction<
  typeof createAndPublishRevision
>;
const mockGetExperimentMap = getExperimentMapForFeature as MockedFunction<
  typeof getExperimentMapForFeature
>;
const mockDispatchEvent = dispatchFeatureRevisionEvent as MockedFunction<
  typeof dispatchFeatureRevisionEvent
>;

const ctx = {
  org: { id: "org_1", settings: {} },
  permissions: {
    canPublishFeature: vi.fn(() => true),
    canRevertFeature: vi.fn(() => true),
    canBypassFlagApprovalChecks: vi.fn(() => true),
    throwPermissionError: vi.fn(() => {
      throw new Error("forbidden");
    }),
  },
  hasPremiumFeature: vi.fn(() => true),
  models: {
    safeRollout: {
      getAllPayloadSafeRollouts: vi.fn().mockResolvedValue(new Map()),
    },
  },
} as never;

const org = { id: "org_1", settings: {} } as unknown as OrganizationInterface;
const eventAudit = { type: "api_key" } as unknown as EventUser;

function makeFeature(overrides: Record<string, unknown> = {}) {
  return {
    id: "feat_1",
    organization: "org_1",
    version: 5,
    defaultValue: "live-default",
    rules: [],
    environmentSettings: {
      production: { enabled: true },
      dev: { enabled: true },
    },
    prerequisites: [],
    description: "live description",
    owner: "live owner",
    project: "",
    tags: [],
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetExperimentMap.mockResolvedValue(new Map() as never);
});

describe("revertFeatureCore empty-diff guard", () => {
  it("throws 'Nothing to revert' when target revision matches the live feature", async () => {
    mockGetFeature.mockResolvedValue(makeFeature());
    // Sparse legacy revision with no envelope fields and the same defaultValue
    // and rules as the live feature — diff comes back empty.
    mockGetRevision.mockResolvedValue({
      version: 3,
      status: "published",
      defaultValue: "live-default",
      rules: [],
    } as never);

    await expect(
      revertFeatureCore(
        ctx,
        org,
        eventAudit,
        { id: "feat_1" },
        { revision: 3 },
        vi.fn(),
        false,
      ),
    ).rejects.toThrow(/Nothing to revert/);

    expect(mockCreateAndPublish).not.toHaveBeenCalled();
  });

  it("proceeds to createAndPublishRevision when defaultValue differs", async () => {
    mockGetFeature.mockResolvedValue(makeFeature());
    mockGetRevision.mockResolvedValue({
      version: 3,
      status: "published",
      defaultValue: "old-default",
      rules: [],
    } as never);
    const updatedFeature = makeFeature({
      version: 6,
      defaultValue: "old-default",
    });
    mockCreateAndPublish.mockResolvedValue({
      revision: { version: 6 } as never,
      updatedFeature,
    });

    await revertFeatureCore(
      ctx,
      org,
      eventAudit,
      { id: "feat_1" },
      { revision: 3 },
      vi.fn(),
      false,
    );

    expect(mockCreateAndPublish).toHaveBeenCalledTimes(1);
    expect(mockCreateAndPublish.mock.calls[0][0].changes).toEqual({
      defaultValue: "old-default",
    });
  });
});

describe("revertFeatureCore revision events", () => {
  function setupSuccessfulRevert() {
    mockGetFeature.mockResolvedValue(makeFeature());
    const targetRevision = {
      version: 3,
      status: "published",
      defaultValue: "old-default",
      rules: [],
    } as never;
    const updatedFeature = makeFeature({
      version: 6,
      defaultValue: "old-default",
    });
    mockCreateAndPublish.mockResolvedValue({
      revision: { version: 6, status: "draft" } as never,
      updatedFeature,
    });
    // The live revision the approval check reads; identical in shape to the
    // target so `checkIfRevisionNeedsReview` sees a real base either way.
    const liveRevision = {
      version: 5,
      status: "published",
      defaultValue: "current-default",
      rules: [],
    } as never;
    return { targetRevision, updatedFeature, liveRevision };
  }

  it("dispatches revision.reverted and revision.published with the re-read published revision", async () => {
    const { targetRevision, liveRevision } = setupSuccessfulRevert();
    const publishedRevision = { version: 6, status: "published" } as never;
    // Three reads, in order: the target revision, the LIVE revision the approval
    // check reads, then the post-publish re-read. The approval read happens even
    // for a caller who can bypass — the answer is what the response reports as a
    // bypassed gate — so a two-value queue would hand the re-read's value to the
    // approval check and leave the dispatch reading `undefined`.
    mockGetRevision
      .mockResolvedValueOnce(targetRevision)
      .mockResolvedValueOnce(liveRevision)
      .mockResolvedValueOnce(publishedRevision);

    await revertFeatureCore(
      ctx,
      org,
      eventAudit,
      { id: "feat_1" },
      { revision: 3 },
      vi.fn(),
      false,
    );

    expect(mockDispatchEvent).toHaveBeenCalledTimes(2);
    const [revertedCall, publishedCall] = mockDispatchEvent.mock.calls;
    expect(revertedCall[2]).toBe(publishedRevision);
    expect(revertedCall[3]).toBe("revision.reverted");
    expect(revertedCall[4]).toEqual({ revertedToVersion: 3 });
    expect(publishedCall[2]).toBe(publishedRevision);
    expect(publishedCall[3]).toBe("revision.published");
  });

  it("falls back to the in-memory revision with a corrected published status when the post-publish read returns nothing", async () => {
    const { targetRevision, liveRevision } = setupSuccessfulRevert();
    mockGetRevision
      .mockResolvedValueOnce(targetRevision)
      .mockResolvedValueOnce(liveRevision)
      .mockResolvedValueOnce(null);

    await revertFeatureCore(
      ctx,
      org,
      eventAudit,
      { id: "feat_1" },
      { revision: 3 },
      vi.fn(),
      false,
    );

    // Publication succeeded, so the fallback reports published — a
    // revision.published event that said "draft" would misinform consumers.
    expect(mockDispatchEvent).toHaveBeenCalledTimes(2);
    expect(mockDispatchEvent.mock.calls[0][2]).toEqual({
      version: 6,
      status: "published",
    });
    expect(mockDispatchEvent.mock.calls[1][2]).toEqual({
      version: 6,
      status: "published",
    });
  });

  it("falls back and still succeeds when the post-publish read fails", async () => {
    const { targetRevision, liveRevision } = setupSuccessfulRevert();
    mockGetRevision
      .mockResolvedValueOnce(targetRevision)
      .mockResolvedValueOnce(liveRevision)
      .mockRejectedValueOnce(new Error("mongo unavailable"));

    // Must not throw — the revert already committed by the time the re-read runs.
    await revertFeatureCore(
      ctx,
      org,
      eventAudit,
      { id: "feat_1" },
      { revision: 3 },
      vi.fn(),
      false,
    );

    expect(mockDispatchEvent).toHaveBeenCalledTimes(2);
    expect(mockDispatchEvent.mock.calls[0][2]).toEqual({
      version: 6,
      status: "published",
    });
  });

  it("dispatches no events when there is nothing to revert", async () => {
    mockGetFeature.mockResolvedValue(makeFeature());
    mockGetRevision.mockResolvedValue({
      version: 3,
      status: "published",
      defaultValue: "live-default",
      rules: [],
    } as never);

    await expect(
      revertFeatureCore(
        ctx,
        org,
        eventAudit,
        { id: "feat_1" },
        { revision: 3 },
        vi.fn(),
        false,
      ),
    ).rejects.toThrow(/Nothing to revert/);

    expect(mockDispatchEvent).not.toHaveBeenCalled();
  });
});

describe("revertFeatureCore metadata-only revert authority floor", () => {
  // A revert whose only change is inert metadata (description/owner/tags/…) takes
  // the `metadataTouchesPayload` short-circuit, so every per-field revert check
  // below the coarse floor is skipped. Without the floor this path publishes with
  // no authority check at all. The deny/allow pair pins both directions: removing
  // the floor makes the deny case publish (green→red), and a floor that demanded
  // more than the weakest env-unbound atom would fail the allow case.
  const inertMetadataRevision = {
    version: 3,
    status: "published",
    defaultValue: "live-default",
    rules: [],
    metadata: { description: "old description" },
  } as never;

  it("denies a zero-revert caller and publishes nothing", async () => {
    mockGetFeature.mockResolvedValue(
      makeFeature({ description: "live description" }),
    );
    mockGetRevision.mockResolvedValue(inertMetadataRevision);
    (ctx.permissions.canRevertFeature as Mock).mockReturnValue(false);

    try {
      await expect(
        revertFeatureCore(
          ctx,
          org,
          eventAudit,
          { id: "feat_1" },
          { revision: 3 },
          vi.fn(),
          false,
        ),
      ).rejects.toThrow(/forbidden/);
    } finally {
      (ctx.permissions.canRevertFeature as Mock).mockReturnValue(true);
    }

    // The floor asks the weakest question — the revert atom, env-unbound (`[]`) —
    // so an environment-limited reverter still passes and only a caller holding
    // no revert authority at all is refused.
    expect(ctx.permissions.canRevertFeature).toHaveBeenCalledWith(
      expect.anything(),
      [],
    );
    expect(mockCreateAndPublish).not.toHaveBeenCalled();
  });

  it("allows a reverter and publishes the restored metadata", async () => {
    mockGetFeature.mockResolvedValue(
      makeFeature({ description: "live description" }),
    );
    mockGetRevision.mockResolvedValue(inertMetadataRevision);
    mockCreateAndPublish.mockResolvedValue({
      revision: { version: 6, status: "draft" } as never,
      updatedFeature: makeFeature({
        version: 6,
        description: "old description",
      }),
    });

    // canRevertFeature defaults to true on ctx, so the floor passes.
    await revertFeatureCore(
      ctx,
      org,
      eventAudit,
      { id: "feat_1" },
      { revision: 3 },
      vi.fn(),
      false,
    );

    expect(mockCreateAndPublish).toHaveBeenCalledTimes(1);
    expect(mockCreateAndPublish.mock.calls[0][0].changes).toEqual({
      metadata: { description: "old description" },
    });
  });
});
