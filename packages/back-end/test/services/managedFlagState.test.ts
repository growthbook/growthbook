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
  getFeaturesByIds: jest.fn(async () => []),
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

const canBypass = jest.fn(() => false);
const context = {
  org: { id: "org_1", settings: {} },
  permissions: { canBypassFlagApprovalChecks: canBypass },
} as never;

const experiment = (over: Partial<ExperimentInterface> = {}) =>
  ({
    id: "exp_1",
    trackingKey: "checkout-test",
    status: "running",
    archived: false,
    linkedFeatures: ["checkout-test"],
    ...over,
  }) as unknown as ExperimentInterface;

const managedFeature = (over: Partial<FeatureInterface> = {}) =>
  ({
    id: "checkout-test",
    organization: "org_1",
    valueType: "string",
    managedBy: { type: "experiment", experimentId: "exp_1" },
    ...over,
  }) as unknown as FeatureInterface;

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
  canBypass.mockReturnValue(false);
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
      sparse: null,
      liveValues: [],
      environments: [],
      allEnvironments: false,
      pending: null,
      adoption: {
        blocker:
          "Only a draft experiment can start managing a Feature Flag. Set the experiment's status back to Draft first.",
        derivedKey: "checkout-test",
        derivedKeyAvailable: true,
        suggestedTrackingKey: null,
        suggestedFeatureKey: null,
        keyRegexError: null,
      },
    });
  });

  it("reports unmanaged when another experiment owns the linked feature", async () => {
    mockGetFeature.mockResolvedValue(
      managedFeature({
        managedBy: { type: "experiment", experimentId: "exp_other" },
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
      sparse: null,
      liveValues: controlAndTreatment,
      environments: [],
      allEnvironments: false,
      pending: null,
      adoption: null,
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
      valueType: "string",
      status: "draft",
      approvalRequired: false,
      canPublish: true,
      reviews: [],
    });
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
      {
        userId: "u_1",
        status: "approved",
        timestamp: "2026-08-19T12:00:00.000Z",
      },
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
      sparse: null,
      liveValues: [],
      environments: [],
      allEnvironments: false,
      pending: null,
      adoption: null,
    });
  });

  it("reports bypass authority separately from a plain publish", async () => {
    mockLinkedInfo.mockResolvedValue([
      {
        feature: managedFeature(),
        pendingDraft: pendingDraft({
          pendingApproval: true,
          status: "pending-review",
        }),
      },
    ]);
    canBypass.mockReturnValue(true);

    const state = await getManagedFlagState(context, experiment());
    expect(state.pending?.approvalRequired).toBe(true);
    expect(state.pending?.canPublish).toBe(false);
    expect(state.pending?.canBypassApproval).toBe(true);
  });

  it("names every reason a publish would fail", async () => {
    mockLinkedInfo.mockResolvedValue([
      {
        feature: managedFeature(),
        pendingDraft: pendingDraft({
          pendingApproval: true,
          status: "changes-requested",
          hasMergeConflict: true,
          hasUnrelatedDraftChanges: true,
          rebaseRequired: true,
        }),
      },
    ]);

    const state = await getManagedFlagState(
      context,
      experiment({ status: "draft" }),
    );
    expect(state.pending?.publishBlockers).toEqual([
      "experiment-not-started",
      "merge-conflict",
      "unrelated-draft-changes",
      "stale-base",
      "approval-required",
    ]);
    expect(state.pending?.canPublish).toBe(false);
    expect(state.pending?.version).toBe(3);
  });

  it("reports the type a re-typing draft lands as, not the live one", async () => {
    mockLinkedInfo.mockResolvedValue([
      { feature: managedFeature(), pendingDraft: pendingDraft() },
    ]);
    mockGetRevision.mockResolvedValue({ metadata: { valueType: "number" } });

    const state = await getManagedFlagState(context, experiment());
    expect(state.valueType).toBe("string");
    expect(state.pending?.valueType).toBe("number");
  });

  it("reports the live type when the draft does not re-type", async () => {
    mockLinkedInfo.mockResolvedValue([
      { feature: managedFeature(), pendingDraft: pendingDraft() },
    ]);
    mockGetFeature.mockResolvedValue(managedFeature({ valueType: "boolean" }));
    mockGetRevision.mockResolvedValue({ metadata: {} });

    const state = await getManagedFlagState(context, experiment());
    expect(state.valueType).toBe("boolean");
    expect(state.pending?.valueType).toBe("boolean");
  });
});
