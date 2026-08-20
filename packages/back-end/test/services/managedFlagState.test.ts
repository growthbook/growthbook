import type { ExperimentInterface, FeatureInterface } from "shared/validators";
import { getManagedFlagState } from "back-end/src/services/managedFeatures";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getRevision } from "back-end/src/models/FeatureRevisionModel";
import { getLinkedFeatureInfo } from "back-end/src/services/experiments";

jest.mock("back-end/src/models/FeatureModel", () => ({
  createFeature: jest.fn(),
  deleteFeature: jest.fn(),
  featureIdExists: jest.fn(),
  getFeature: jest.fn(),
  getManagedFlagIdsUnfiltered: jest.fn(),
  publishRevision: jest.fn(),
  updateFeature: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getActiveDraft: jest.fn(),
  getRevision: jest.fn(),
  markRevisionAsReviewRequested: jest.fn(),
}));
jest.mock("back-end/src/services/experiments", () => ({
  getLinkedFeatureInfo: jest.fn(),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getContextFromReq: jest.fn(() => ({})),
  getEnvironments: jest.fn(() => []),
}));

const mockGetFeature = getFeature as jest.Mock;
const mockGetRevision = getRevision as jest.Mock;
const mockLinkedInfo = getLinkedFeatureInfo as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const context = { org: { id: "org_1", settings: {} } } as any;

const experiment = (over: Partial<ExperimentInterface> = {}) =>
  ({
    id: "exp_1",
    trackingKey: "checkout-test",
    status: "draft",
    archived: false,
    linkedFeatures: ["checkout-test"],
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any as ExperimentInterface;

const managedFeature = (over: Partial<FeatureInterface> = {}) =>
  ({
    id: "checkout-test",
    organization: "org_1",
    valueType: "string",
    managedBy: { type: "experiment", experimentId: "exp_1" },
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any as FeatureInterface;

const controlAndTreatment = [
  { variationId: "v0", value: "control" },
  { variationId: "v1", value: "treatment" },
];

/** A pendingDraft as `getRefLinkedFeatureInfo` builds it. */
const pendingDraft = (over: Record<string, unknown> = {}) => ({
  version: 3,
  status: "draft",
  values: controlAndTreatment,
  sparse: false,
  pendingApproval: false,
  hasMergeConflict: false,
  hasUnrelatedDraftChanges: false,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFeature.mockResolvedValue(managedFeature());
  mockGetRevision.mockResolvedValue(null);
  mockLinkedInfo.mockResolvedValue([]);
});

describe("getManagedFlagState", () => {
  it("reports unmanaged when no linked feature is owned by the experiment", async () => {
    mockGetFeature.mockResolvedValue(
      managedFeature({ managedBy: undefined, id: "unmanaged" }),
    );

    expect(await getManagedFlagState(context, experiment())).toEqual({
      managed: false,
      featureKey: null,
      valueType: null,
      liveValues: [],
      pending: null,
    });
  });

  it("reports unmanaged when another experiment owns the linked feature", async () => {
    mockGetFeature.mockResolvedValue(
      managedFeature({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        managedBy: { type: "experiment", experimentId: "exp_other" } as any,
      }),
    );

    expect((await getManagedFlagState(context, experiment())).managed).toBe(
      false,
    );
  });

  it("reports live values with no pending change", async () => {
    mockLinkedInfo.mockResolvedValue([
      { feature: managedFeature(), liveValues: controlAndTreatment },
    ]);

    expect(await getManagedFlagState(context, experiment())).toEqual({
      managed: true,
      featureKey: "checkout-test",
      valueType: "string",
      liveValues: controlAndTreatment,
      pending: null,
    });
    expect(mockGetRevision).not.toHaveBeenCalled();
  });

  it("publishes freely when the org requires no approval", async () => {
    mockLinkedInfo.mockResolvedValue([
      {
        feature: managedFeature(),
        liveValues: [],
        pendingDraft: pendingDraft(),
      },
    ]);

    const state = await getManagedFlagState(context, experiment());
    expect(state.pending).toMatchObject({
      values: controlAndTreatment,
      status: "draft",
      approvalRequired: false,
      canPublish: true,
      reviews: [],
    });
  });

  it("withholds publish while an approval is outstanding", async () => {
    mockLinkedInfo.mockResolvedValue([
      {
        feature: managedFeature(),
        pendingDraft: pendingDraft({
          pendingApproval: true,
          status: "pending-review",
        }),
      },
    ]);

    const state = await getManagedFlagState(context, experiment());
    expect(state.pending?.approvalRequired).toBe(true);
    expect(state.pending?.canPublish).toBe(false);
  });

  it("allows publish once an approval-gated draft is approved", async () => {
    mockLinkedInfo.mockResolvedValue([
      {
        feature: managedFeature(),
        pendingDraft: pendingDraft({
          pendingApproval: true,
          status: "approved",
        }),
      },
    ]);

    expect(
      (await getManagedFlagState(context, experiment())).pending,
    ).toMatchObject({ approvalRequired: true, canPublish: true });
  });

  it("still withholds publish when changes were requested", async () => {
    mockLinkedInfo.mockResolvedValue([
      {
        feature: managedFeature(),
        pendingDraft: pendingDraft({
          pendingApproval: true,
          status: "changes-requested",
        }),
      },
    ]);

    expect(
      (await getManagedFlagState(context, experiment())).pending?.canPublish,
    ).toBe(false);
  });

  it("withholds publish on a merge conflict, approvals aside", async () => {
    mockLinkedInfo.mockResolvedValue([
      {
        feature: managedFeature(),
        pendingDraft: pendingDraft({ hasMergeConflict: true }),
      },
    ]);

    const state = await getManagedFlagState(context, experiment());
    expect(state.pending?.approvalRequired).toBe(false);
    expect(state.pending?.canPublish).toBe(false);
  });

  it("withholds publish when the draft carries unrelated changes", async () => {
    mockLinkedInfo.mockResolvedValue([
      {
        feature: managedFeature(),
        pendingDraft: pendingDraft({ hasUnrelatedDraftChanges: true }),
      },
    ]);

    expect(
      (await getManagedFlagState(context, experiment())).pending?.canPublish,
    ).toBe(false);
  });

  it("surfaces the reviews recorded against the pending draft", async () => {
    mockLinkedInfo.mockResolvedValue([
      { feature: managedFeature(), pendingDraft: pendingDraft() },
    ]);
    mockGetRevision.mockResolvedValue({
      reviews: [
        {
          userId: "u_1",
          status: "approved",
          timestamp: new Date("2026-08-19T12:00:00.000Z"),
          comment: "not exposed here",
        },
      ],
    });

    const state = await getManagedFlagState(context, experiment());
    expect(state.pending?.reviews).toEqual([
      { userId: "u_1", status: "approved", date: "2026-08-19T12:00:00.000Z" },
    ]);
    expect(mockGetRevision).toHaveBeenCalledWith(
      expect.objectContaining({ featureId: "checkout-test", version: 3 }),
    );
  });

  it("reports an empty review list when the revision read comes back empty", async () => {
    mockLinkedInfo.mockResolvedValue([
      { feature: managedFeature(), pendingDraft: pendingDraft() },
    ]);
    mockGetRevision.mockResolvedValue(null);

    expect(
      (await getManagedFlagState(context, experiment())).pending?.reviews,
    ).toEqual([]);
  });

  it("ignores linked-feature info for a different feature", async () => {
    mockLinkedInfo.mockResolvedValue([
      {
        feature: managedFeature({ id: "some-other-flag" }),
        liveValues: controlAndTreatment,
        pendingDraft: pendingDraft(),
      },
    ]);

    expect(await getManagedFlagState(context, experiment())).toEqual({
      managed: true,
      featureKey: "checkout-test",
      valueType: "string",
      liveValues: [],
      pending: null,
    });
  });

  it("carries the flag's value type through", async () => {
    mockGetFeature.mockResolvedValue(managedFeature({ valueType: "boolean" }));
    mockLinkedInfo.mockResolvedValue([]);

    expect((await getManagedFlagState(context, experiment())).valueType).toBe(
      "boolean",
    );
  });
});
