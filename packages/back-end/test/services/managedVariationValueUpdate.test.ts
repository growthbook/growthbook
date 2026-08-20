import type { ExperimentInterface, FeatureInterface } from "shared/validators";
import { updateManagedVariationValues } from "back-end/src/services/managedFeatures";
import { getFeature } from "back-end/src/models/FeatureModel";
import { getActiveDraft } from "back-end/src/models/FeatureRevisionModel";
import {
  updateExperimentRefVariations,
  validateExperimentFeatureUpdates,
} from "back-end/src/services/experiment-feature";
import { getDraftRevision } from "back-end/src/services/features";

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

const context = {
  org: { id: "org_1", settings: {} },
  permissions: {
    canEditFeatureDrafts: () => true,
    throwPermissionError: () => {
      throw new Error("permission error");
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const experiment = {
  id: "exp_1",
  variations: [{ id: "v0" }, { id: "v1" }],
  linkedFeatures: ["checkout-test"],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any as ExperimentInterface;

const managedFeature = (valueType = "string") =>
  ({
    id: "checkout-test",
    organization: "org_1",
    valueType,
    version: 7,
    managedBy: { type: "experiment", experimentId: "exp_1" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any as FeatureInterface;

const values = [
  { variationId: "v0", value: "a" },
  { variationId: "v1", value: "b" },
];

/** The revision the update landed on, per the `features` entry we were given. */
const revisionOptionsUsed = () =>
  mockValidate.mock.calls[0][0].features["checkout-test"].revisionOptions;

const update = (over: Record<string, unknown> = {}) =>
  updateManagedVariationValues({
    context,
    experiment,
    variations: values,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventAudit: {} as any,
    ...over,
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFeature.mockResolvedValue(managedFeature());
  mockActiveDraft.mockResolvedValue(null);
  mockValidate.mockResolvedValue([
    {
      feature: managedFeature(),
      existingRevision: undefined,
      matchingRules: [],
    },
  ]);
  mockUpdateRefs.mockResolvedValue({ version: 8 });
  mockDraftRevision.mockResolvedValue({ version: 8 });
});

describe("updateManagedVariationValues revision choice", () => {
  it("appends to the open draft when there is one", async () => {
    mockActiveDraft.mockResolvedValue({ version: 8 });
    mockValidate.mockResolvedValue([
      {
        feature: managedFeature(),
        existingRevision: { version: 8 },
        matchingRules: [],
      },
    ]);

    const result = await update();

    expect(revisionOptionsUsed()).toEqual({ targetVersion: 8 });
    // The open draft is reused, not replaced by a fresh one off live.
    expect(mockDraftRevision).not.toHaveBeenCalled();
    expect(mockUpdateRefs).toHaveBeenCalledWith(
      expect.objectContaining({ revision: { version: 8 } }),
    );
    expect(result.version).toBe(8);
  });

  it("starts a draft when nothing is pending", async () => {
    const result = await update();

    expect(revisionOptionsUsed()).toEqual({ forceNewDraft: true });
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
    mockGetFeature.mockResolvedValue(managedFeature("boolean"));

    await update({
      variations: [
        { variationId: "v0", value: "not-a-bool" },
        { variationId: "v1", value: "false" },
      ],
    });

    // validateFeatureValue REPAIRS booleans rather than rejecting them, so the
    // repaired value is what must reach the rule.
    expect(staged()).toEqual([
      { variationId: "v0", value: "true" },
      { variationId: "v1", value: "false" },
    ]);
  });

  it("refuses a value that cannot be repaired into the flag's type", async () => {
    mockGetFeature.mockResolvedValue(managedFeature("number"));

    await expect(
      update({
        variations: [
          { variationId: "v0", value: "abc" },
          { variationId: "v1", value: "2" },
        ],
      }),
    ).rejects.toThrow(/valid number/i);
    expect(mockUpdateRefs).not.toHaveBeenCalled();
  });

  it("refuses a set that misses a variation", async () => {
    await expect(
      update({ variations: [{ variationId: "v0", value: "a" }] }),
    ).rejects.toThrow(/one value per experiment variation/i);
  });

  it("refuses an empty set", async () => {
    await expect(update({ variations: [] })).rejects.toThrow(
      /value for every variation/i,
    );
  });

  it("refuses a set that names a variation the experiment does not have", async () => {
    await expect(
      update({
        variations: [
          { variationId: "v0", value: "a" },
          { variationId: "v_nope", value: "b" },
        ],
      }),
    ).rejects.toThrow(/one value per experiment variation/i);
  });
});
