import type { ExperimentInterface, FeatureInterface } from "shared/validators";
import { updateManagedVariationValues } from "back-end/src/services/managedFeatures";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  getActiveDraft,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
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
  mockUpdateRevision.mockResolvedValue({ version: 8 });
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

    // validateFeatureValue repairs booleans, so the repaired value must land.
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

describe("updateManagedVariationValues value type", () => {
  /** The changes staged on the revision by the type change. */
  const staged = () => mockUpdateRevision.mock.calls[0][3];

  it("stages the default value when control moves", async () => {
    // Control is the baseline, so the default must not lag behind it.
    await update({ valueType: "string" });
    expect(staged()).toEqual({ defaultValue: "a" });
  });

  it("leaves the default alone when control has not moved", async () => {
    mockActiveDraft.mockResolvedValue({ version: 8, defaultValue: "a" });
    mockValidate.mockResolvedValue([
      {
        feature: managedFeature(),
        existingRevision: { version: 8, defaultValue: "a" },
        matchingRules: [],
      },
    ]);

    await update({ valueType: "string" });
    expect(mockUpdateRevision).not.toHaveBeenCalled();
  });

  it("compares the default against the draft, not the live feature", async () => {
    // An earlier edit on this same draft may already have staged it.
    mockActiveDraft.mockResolvedValue({ version: 8, defaultValue: "stale" });
    mockValidate.mockResolvedValue([
      {
        feature: managedFeature(),
        existingRevision: { version: 8, defaultValue: "stale" },
        matchingRules: [],
      },
    ]);

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

  it("resets the review, because the type governs every value", async () => {
    await update({
      valueType: "number",
      variations: [
        { variationId: "v0", value: "1" },
        { variationId: "v1", value: "2" },
      ],
    });

    expect(mockUpdateRevision.mock.calls[0][5]).toBe(true);
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

    expect(
      mockValidate.mock.calls[0][0].features["checkout-test"].valueType,
    ).toBe("number");
  });

  it("does not mention a type that is not changing", async () => {
    await update({ valueType: "string" });
    expect(
      mockValidate.mock.calls[0][0].features["checkout-test"],
    ).not.toHaveProperty("valueType");
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
