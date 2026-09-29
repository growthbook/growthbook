import type { ExperimentInterface, FeatureInterface } from "shared/validators";
import { updateManagedVariationValues } from "back-end/src/services/managedFeatures";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  discardRevision,
  getActiveDraft,
  getRevision,
  markRevisionAsReviewRequested,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import {
  linkFeatureToExperiment,
  mergeDraftForAutoPublish,
  updateExperimentRefVariations,
  validateExperimentFeatureUpdates,
} from "back-end/src/services/experiment-feature";
import {
  getDraftRevision,
  getLiveAndBaseRevisionsForFeature,
} from "back-end/src/services/features";
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
  discardRevision: jest.fn(),
  getActiveDraft: jest.fn(),
  getRevision: jest.fn(),
  markRevisionAsReviewRequested: jest.fn(),
  updateRevision: jest.fn(),
}));
jest.mock("back-end/src/services/experiment-feature", () => ({
  linkFeatureToExperiment: jest.fn(),
  mergeDraftForAutoPublish: jest.fn(),
  updateExperimentRefVariations: jest.fn(),
  validateExperimentFeatureUpdates: jest.fn(),
}));
jest.mock("back-end/src/services/features", () => ({
  getDraftRevision: jest.fn(),
  getLiveAndBaseRevisionsForFeature: jest.fn(),
}));
jest.mock("back-end/src/services/experiments", () => ({
  getLinkedFeatureInfo: jest.fn(),
}));
jest.mock("back-end/src/services/organizations", () => ({
  getContextFromReq: jest.fn(() => ({})),
  getEnvironments: jest.fn(() => []),
}));

const mockGetFeature = getFeature as jest.Mock;
const mockActiveDraft = getActiveDraft as jest.Mock;
const mockValidate = validateExperimentFeatureUpdates as jest.Mock;
const mockUpdateRefs = updateExperimentRefVariations as jest.Mock;
const mockDraftRevision = getDraftRevision as jest.Mock;
const mockUpdateRevision = updateRevision as jest.Mock;
const mockLiveAndBase = getLiveAndBaseRevisionsForFeature as jest.Mock;
const mockMerge = mergeDraftForAutoPublish as jest.Mock;
const mockDiscard = discardRevision as jest.Mock;
const mockRequestReview = markRevisionAsReviewRequested as jest.Mock;
const mockLinkedInfo = getLinkedFeatureInfo as jest.Mock;
const mockLink = linkFeatureToExperiment as jest.Mock;

const context = {
  org: { id: "org_1", settings: {} },
  permissions: {
    canEditFeatureDrafts: () => true,
    throwPermissionError: () => {
      throw new Error("permission error");
    },
  },
} as never;

const experiment = {
  id: "exp_1",
  variations: [{ id: "v0" }, { id: "v1" }],
  linkedFeatures: ["checkout-test"],
} as unknown as ExperimentInterface;

const managedFeature = (valueType = "string") =>
  ({
    id: "checkout-test",
    organization: "org_1",
    valueType,
    version: 7,
    managedBy: { type: "experiment", experimentId: "exp_1" },
  }) as unknown as FeatureInterface;

const values = [
  { variationId: "v0", value: "a" },
  { variationId: "v1", value: "b" },
];

/** The `features` entry the planner was given. */
const plannedUpdate = () =>
  mockValidate.mock.calls[0][0].features["checkout-test"];

/** An open draft the planner resolves the update onto. */
const withOpenDraft = (draft: Record<string, unknown>) => {
  mockActiveDraft.mockResolvedValue(draft);
  mockValidate.mockResolvedValue([
    { feature: managedFeature(), existingRevision: draft, matchingRules: [] },
  ]);
};

const update = (over: Record<string, unknown> = {}) =>
  updateManagedVariationValues({
    context,
    experiment,
    variations: values,
    eventAudit: null,
    audit: async () => undefined,
    ...over,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFeature.mockResolvedValue(managedFeature());
  mockActiveDraft.mockResolvedValue(null);
  // The live flag carries the experiment rule unless a test says otherwise.
  mockLinkedInfo.mockResolvedValue([
    { feature: managedFeature(), liveHasMatchingRule: true },
  ]);
  mockValidate.mockResolvedValue([
    {
      feature: managedFeature(),
      existingRevision: undefined,
      matchingRules: [],
    },
  ]);
  mockUpdateRefs.mockResolvedValue({ version: 8 });
  mockDraftRevision.mockResolvedValue({ version: 8 });
  mockUpdateRevision.mockResolvedValue({ version: 8 });
  mockLiveAndBase.mockResolvedValue({
    live: { version: 1 },
    base: { version: 1 },
  });
  // The draft still differs from live unless a test says otherwise.
  mockMerge.mockReturnValue({
    mergeResult: { success: true, result: { rules: [] } },
    rebaseRequired: false,
    staleApproval: false,
  });
});

describe("updateManagedVariationValues after a discarded first draft", () => {
  it("recreates the experiment rule instead of refusing the edit", async () => {
    mockLinkedInfo.mockResolvedValue([
      { feature: managedFeature(), liveHasMatchingRule: false },
    ]);
    mockLink.mockResolvedValue({ version: 9, published: false, ruleId: "r1" });
    (getRevision as jest.Mock).mockResolvedValue({ version: 9, rules: [] });

    const result = await update();

    expect(mockLink).toHaveBeenCalledTimes(1);
    expect(mockLink.mock.calls[0][0]).toMatchObject({
      feature: expect.objectContaining({ id: "checkout-test" }),
      rule: expect.objectContaining({
        type: "experiment-ref",
        experimentId: "exp_1",
        variations: values,
      }),
      forceNewDraft: true,
      autoPublish: false,
    });
    expect(mockValidate).not.toHaveBeenCalled();
    expect(result.version).toBe(9);
  });
});

describe("updateManagedVariationValues no-op drafts", () => {
  it("discards a draft edited back to what live serves", async () => {
    mockMerge.mockReturnValue({
      mergeResult: { success: true, result: {} },
      rebaseRequired: false,
      staleApproval: false,
    });

    const result = await update();

    expect(mockDiscard).toHaveBeenCalledTimes(1);
    expect(mockRequestReview).not.toHaveBeenCalled();
    expect(result.version).toBe(managedFeature().version);
  });

  it("keeps a draft that still changes something", async () => {
    await update();

    expect(mockDiscard).not.toHaveBeenCalled();
  });
});

describe("updateManagedVariationValues revision choice", () => {
  it("appends to the open draft when there is one", async () => {
    withOpenDraft({ version: 8 });

    const result = await update();

    expect(plannedUpdate().revisionOptions).toEqual({ targetVersion: 8 });
    // The open draft is reused, not replaced by a fresh one off live.
    expect(mockDraftRevision).not.toHaveBeenCalled();
    expect(mockUpdateRefs).toHaveBeenCalledWith(
      expect.objectContaining({ revision: { version: 8 } }),
    );
    expect(result.version).toBe(8);
  });

  it("starts a draft when nothing is pending", async () => {
    const result = await update();

    expect(plannedUpdate().revisionOptions).toEqual({ forceNewDraft: true });
    expect(mockDraftRevision).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ id: "checkout-test" }),
      7,
    );
    expect(result.version).toBe(8);
  });

  it("writes nothing when the values already match", async () => {
    mockActiveDraft.mockResolvedValue({ version: 8 });
    mockValidate.mockResolvedValue([]);

    const result = await update();

    expect(mockUpdateRefs).not.toHaveBeenCalled();
    expect(mockDraftRevision).not.toHaveBeenCalled();
    expect(result.version).toBe(8);
  });

  it("reports the live version when nothing matches and nothing is pending", async () => {
    mockValidate.mockResolvedValue([]);

    expect((await update()).version).toBe(7);
  });

  it("refuses when the experiment manages no flag", async () => {
    mockGetFeature.mockResolvedValue({
      ...managedFeature(),
      managedBy: undefined,
    });

    await expect(update()).rejects.toThrow("does not manage a Feature Flag");
  });
});

describe("updateManagedVariationValues value handling", () => {
  /** What actually got staged on the rule. */
  const staged = () => mockUpdateRefs.mock.calls[0][0].updatedVariationValues;

  it("stages the normalized value, not the raw one", async () => {
    mockGetFeature.mockResolvedValue(managedFeature("json"));

    await update({
      variations: [
        { variationId: "v0", value: "{a: 1}" },
        { variationId: "v1", value: '{"b": 2}' },
      ],
    });

    // validateFeatureValue repairs loose JSON, so the repaired value must land.
    expect(staged()).toEqual([
      { variationId: "v0", value: '{"a": 1}' },
      { variationId: "v1", value: '{"b": 2}' },
    ]);
  });

  it.each([
    ["misses a variation", [{ variationId: "v0", value: "a" }]],
    [
      "names a variation the experiment does not have",
      [
        { variationId: "v0", value: "a" },
        { variationId: "v_nope", value: "b" },
      ],
    ],
  ])("refuses a set that %s", async (_label, variations) => {
    await expect(update({ variations })).rejects.toThrow(
      /one value per experiment variation/i,
    );
  });

  it("refuses an empty set", async () => {
    await expect(update({ variations: [] })).rejects.toThrow(
      /value for every variation/i,
    );
  });
});

describe("updateManagedVariationValues value type", () => {
  /** The changes staged on the revision by the type change. */
  const staged = () => mockUpdateRevision.mock.calls[0][3];

  it("leaves the default alone when control has not moved", async () => {
    withOpenDraft({ version: 8, defaultValue: "a" });

    await update({ valueType: "string" });
    expect(mockUpdateRevision).not.toHaveBeenCalled();
  });

  it("stages control as the default, compared against the draft", async () => {
    // An earlier edit on this same draft may already have staged it.
    withOpenDraft({ version: 8, defaultValue: "stale" });

    await update({ valueType: "string" });
    expect(staged()).toEqual({ defaultValue: "a" });
  });

  it("stages the type and the default value together", async () => {
    await update({
      valueType: "number",
      variations: [
        { variationId: "v0", value: "10" },
        { variationId: "v1", value: "20" },
      ],
    });

    expect(staged()).toEqual({
      metadata: { valueType: "number" },
      // The flag's fallback would otherwise be left reading as the old type.
      defaultValue: "10",
    });
  });

  it("keeps metadata already staged on the draft", async () => {
    mockActiveDraft.mockResolvedValue({
      version: 8,
      metadata: { description: "staged earlier", owner: "u_1" },
    });
    mockValidate.mockResolvedValue([
      {
        feature: managedFeature(),
        existingRevision: {
          version: 8,
          metadata: { description: "staged earlier" },
        },
        matchingRules: [],
      },
    ]);

    await update({
      valueType: "number",
      variations: [
        { variationId: "v0", value: "1" },
        { variationId: "v1", value: "2" },
      ],
    });

    expect(staged().metadata).toEqual({
      description: "staged earlier",
      valueType: "number",
    });
  });

  it("validates the values against the new type, not the old one", async () => {
    // "true" is a fine string but not a number.
    await expect(
      update({
        valueType: "number",
        variations: [
          { variationId: "v0", value: "true" },
          { variationId: "v1", value: "2" },
        ],
      }),
    ).rejects.toThrow(/valid number/i);
    expect(mockUpdateRevision).not.toHaveBeenCalled();
  });

  it("tells the planner about the type so a type-only change is not skipped", async () => {
    // "0"/"1" are byte-identical as strings and as numbers, so without this the
    // planner sees no value delta and drops the whole update.
    await update({
      valueType: "number",
      variations: [
        { variationId: "v0", value: "0" },
        { variationId: "v1", value: "1" },
      ],
    });

    expect(plannedUpdate().valueType).toBe("number");
  });

  it("does not mention a type that is not changing", async () => {
    await update({ valueType: "string" });
    expect(plannedUpdate()).not.toHaveProperty("valueType");
  });

  it("stages the type before the values, on the revision it returned", async () => {
    mockUpdateRevision.mockResolvedValue({ version: 8, retyped: true });

    await update({
      valueType: "number",
      variations: [
        { variationId: "v0", value: "1" },
        { variationId: "v1", value: "2" },
      ],
    });

    // Passing the pre-type-change copy would fail updateRevision's CAS on the
    // status the type change just moved.
    expect(mockUpdateRefs).toHaveBeenCalledWith(
      expect.objectContaining({ revision: { version: 8, retyped: true } }),
    );
  });
});
