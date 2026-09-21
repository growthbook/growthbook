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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const experiment = (over: Partial<ExperimentInterface> = {}) =>
  ({
    id: "exp_1",
    trackingKey: "checkout-test",
    status: "running",
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
        blocker: "Only a draft experiment can start managing a Feature Flag.",
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

  it("carries the flag's value type through", async () => {
    mockGetFeature.mockResolvedValue(managedFeature({ valueType: "boolean" }));
    mockLinkedInfo.mockResolvedValue([]);

    expect((await getManagedFlagState(context, experiment())).valueType).toBe(
      "boolean",
    );
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
          status: "pending-review",
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
      "stale-base",
      "approval-required",
    ]);
    expect(state.pending?.version).toBe(3);
  });

  it("withholds publish while the draft needs a fresh base", async () => {
    mockLinkedInfo.mockResolvedValue([
      {
        feature: managedFeature(),
        pendingDraft: pendingDraft({ rebaseRequired: true }),
      },
    ]);

    expect(
      (await getManagedFlagState(context, experiment())).pending?.canPublish,
    ).toBe(false);
  });

  it("withholds publish while the experiment is a draft", async () => {
    mockLinkedInfo.mockResolvedValue([
      { feature: managedFeature(), pendingDraft: pendingDraft() },
    ]);

    expect(
      (await getManagedFlagState(context, experiment({ status: "draft" })))
        .pending?.canPublish,
    ).toBe(false);
  });

  it("does not let a bypass override a merge conflict", async () => {
    mockLinkedInfo.mockResolvedValue([
      {
        feature: managedFeature(),
        pendingDraft: pendingDraft({ hasMergeConflict: true }),
      },
    ]);
    canBypass.mockReturnValue(true);

    expect(
      (await getManagedFlagState(context, experiment())).pending?.canPublish,
    ).toBe(false);
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
      {
        feature: managedFeature({ valueType: "boolean" }),
        pendingDraft: pendingDraft(),
      },
    ]);
    mockGetFeature.mockResolvedValue(managedFeature({ valueType: "boolean" }));
    mockGetRevision.mockResolvedValue({ metadata: {} });

    expect(
      (await getManagedFlagState(context, experiment())).pending?.valueType,
    ).toBe("boolean");
  });
});
