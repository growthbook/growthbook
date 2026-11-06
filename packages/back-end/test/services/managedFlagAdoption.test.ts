import type { ExperimentInterface } from "shared/validators";
import type { ReqContext } from "back-end/types/request";
import {
  adoptManagedFlagForExperiment,
  clearManagedMarkersForExperiment,
  createManagedFeatureForExperiment,
  managedFlagAdoptionBlocker,
  planManagedFlagKey,
  staleLinkedFeatureIds,
} from "back-end/src/services/managedFeatures";
import {
  featureIdExists,
  getFeature,
  getManagedFlagIdsUnfiltered,
  updateFeature,
} from "back-end/src/models/FeatureModel";
import {
  getExperimentByTrackingKey,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";

jest.mock("back-end/src/models/FeatureModel", () => ({
  featureIdExists: jest.fn(),
  getManagedFlagIdsUnfiltered: jest.fn(),
  createFeature: jest.fn(),
  deleteFeature: jest.fn(),
  getFeature: jest.fn(),
  publishRevision: jest.fn(),
  updateFeature: jest.fn(),
}));
jest.mock("back-end/src/models/FeatureRevisionModel");
jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
  getExperimentByTrackingKey: jest.fn(),
  unlinkFeatureFromExperiment: jest.fn(),
  updateExperiment: jest.fn(),
}));

const mockExists = featureIdExists as jest.Mock;
const mockManagedIds = getManagedFlagIdsUnfiltered as jest.Mock;
const mockGetFeature = getFeature as jest.Mock;
const mockUpdateFeature = updateFeature as jest.Mock;
const mockByTrackingKey = getExperimentByTrackingKey as jest.Mock;
const mockUpdateExperiment = updateExperiment as jest.Mock;

const experiment = (over: Partial<ExperimentInterface> = {}) =>
  ({
    id: "exp_1",
    trackingKey: "checkout-test",
    status: "draft",
    archived: false,
    linkedFeatures: [],
    hasVisualChangesets: false,
    hasURLRedirects: false,
    ...over,
  }) as unknown as ExperimentInterface;

const context = {
  org: { id: "org_1", settings: {} },
  // Denies creation, so a create that passes validation stops there.
  permissions: {
    canCreateFeature: () => false,
    throwPermissionError: () => {
      throw new Error("permission error");
    },
  },
} as unknown as ReqContext;

/** Only these ids are already taken. */
const taken = (...ids: string[]) => {
  mockExists.mockImplementation(async (_ctx, id: string) => ids.includes(id));
};

beforeEach(() => {
  jest.clearAllMocks();
  context.org.settings = {};
  taken();
  mockByTrackingKey.mockResolvedValue(null);
});

describe("managedFlagAdoptionBlocker", () => {
  it("allows a draft experiment with nothing wired up", async () => {
    expect(await managedFlagAdoptionBlocker(context, experiment())).toBeNull();
  });

  it("refuses a running experiment", async () => {
    expect(
      await managedFlagAdoptionBlocker(
        context,
        experiment({ status: "running" }),
      ),
    ).toMatch(/draft/i);
  });

  it("refuses when Visual Editor changes or redirects already exist", async () => {
    expect(
      await managedFlagAdoptionBlocker(
        context,
        experiment({ hasVisualChangesets: true }),
      ),
    ).toMatch(/Visual Editor/);
    expect(
      await managedFlagAdoptionBlocker(
        context,
        experiment({ hasURLRedirects: true }),
      ),
    ).toMatch(/URL Redirects/);
  });

  it("allows adoption again after the linked flag was deleted out of band", async () => {
    // Treating a dangling id as "already linked" would bar the experiment from ever recovering.
    expect(
      await managedFlagAdoptionBlocker(
        context,
        experiment({ linkedFeatures: ["deleted-flag"] }),
      ),
    ).toBeNull();
  });

  it("still refuses when only SOME linked flags were deleted", async () => {
    taken("live-flag");
    expect(
      await managedFlagAdoptionBlocker(
        context,
        experiment({ linkedFeatures: ["deleted-flag", "live-flag"] }),
      ),
    ).toMatch(/already has a linked Feature Flag/);
  });
});

describe("createManagedFeatureForExperiment variation validation", () => {
  const base = {
    context,
    experiment: experiment({
      variations: [{ id: "var_0" }, { id: "var_1" }],
    } as Partial<ExperimentInterface>),
    eventAudit: null,
    audit: jest.fn(),
  };

  it.each([
    // "false" is a valid value, not a falsy failure.
    [
      "boolean",
      [
        { variationId: "var_0", value: "false" },
        { variationId: "var_1", value: "true" },
      ],
      /permission error/,
    ],
    [
      "number",
      [
        { variationId: "var_0", value: "abc" },
        { variationId: "var_1", value: "2" },
      ],
      /valid number/i,
    ],
    [
      "string",
      [{ variationId: "var_0", value: "a" }],
      /one value per experiment variation/i,
    ],
  ] as const)(
    "validates %s values %j",
    async (valueType, variations, error) => {
      await expect(
        createManagedFeatureForExperiment({
          ...base,
          valueType,
          variations: [...variations],
        }),
      ).rejects.toThrow(error);
    },
  );
});

describe("clearManagedMarkersForExperiment", () => {
  it("releases every flag the experiment owns", async () => {
    mockManagedIds.mockResolvedValue(["flag-a", "flag-b"]);
    const dateUpdated = new Date("2026-01-01");
    mockGetFeature.mockImplementation(async (_c, id: string) => ({
      id,
      dateUpdated,
      managedBy: { type: "experiment" },
    }));
    // Returns the written document, as the real one does.
    mockUpdateFeature.mockImplementation(async (_c, f, updates) => ({
      ...f,
      ...updates,
    }));

    await clearManagedMarkersForExperiment(context, "exp_1");

    // Each flag is archived, then released.
    expect(mockUpdateFeature).toHaveBeenCalledTimes(4);
    expect(mockUpdateFeature).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ id: "flag-b" }),
      { archived: true },
      { casOnDateUpdated: dateUpdated },
    );
    expect(mockUpdateFeature).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ id: "flag-b", archived: true }),
      {},
      { unsetManagedBy: true, casOnDateUpdated: dateUpdated },
    );
  });

  it("refuses before touching anything when a managed flag is unreadable", async () => {
    // Ids resolve unfiltered, so an unreadable flag is one the caller can't release.
    mockManagedIds.mockResolvedValue(["flag-a", "flag-b"]);
    mockGetFeature.mockImplementation(async (_c, id: string) =>
      id === "flag-a" ? { id, managedBy: { type: "experiment" } } : null,
    );

    await expect(
      clearManagedMarkersForExperiment(context, "exp_1"),
    ).rejects.toThrow(/flag-b.*cannot access/);
    expect(mockUpdateFeature).not.toHaveBeenCalled();
  });
});

describe("staleLinkedFeatureIds", () => {
  it("returns only the ids that no longer resolve", async () => {
    taken("live-flag");
    expect(
      await staleLinkedFeatureIds(
        context,
        experiment({ linkedFeatures: ["deleted-flag", "live-flag"] }),
      ),
    ).toEqual(["deleted-flag"]);
  });
});

describe("planManagedFlagKey", () => {
  it("reports the derived id as available when nothing holds it", async () => {
    const plan = await planManagedFlagKey({
      context,
      experiment: experiment(),
    });
    expect(plan.derivedId).toBe("checkout-test");
    expect(plan.derivedIdAvailable).toBe(true);
    expect(plan.sanitized).toBe(false);
    expect(plan.suggestedPair).toBeNull();
  });

  it("flags a sanitized key so the UI can explain the difference", async () => {
    const plan = await planManagedFlagKey({
      context,
      experiment: experiment({ trackingKey: "My Checkout Test" }),
    });
    expect(plan.derivedId).toBe("My-Checkout-Test");
    expect(plan.sanitized).toBe(true);
    expect(plan.derivedIdAvailable).toBe(true);
  });

  it("suggests a free matching pair when the derived id is taken", async () => {
    taken("checkout-test");
    const plan = await planManagedFlagKey({
      context,
      experiment: experiment(),
    });
    expect(plan.derivedIdAvailable).toBe(false);
    // Both sides equal, so the flag key and the experiment key match exactly.
    expect(plan.suggestedPair).toEqual({
      trackingKey: "checkout-test-2",
      featureId: "checkout-test-2",
    });
  });

  it.each([
    ["exp_other", "checkout-test-3"],
    // The experiment's own key is no conflict.
    ["exp_1", "checkout-test-2"],
  ])("suggests past a tracking key %s holds: %s", async (ownerId, expected) => {
    taken("checkout-test");
    mockByTrackingKey.mockImplementation(async (_ctx, key: string) =>
      key === "checkout-test-2" ? { id: ownerId } : null,
    );
    const plan = await planManagedFlagKey({
      context,
      experiment: experiment(),
    });
    expect(plan.suggestedPair?.featureId).toBe(expected);
  });

  it("reports the org key format as an error", async () => {
    context.org.settings = { featureRegexValidator: "^ff-" };
    const plan = await planManagedFlagKey({
      context,
      experiment: experiment(),
    });
    expect(plan.regexError).toContain("^ff-");
  });

  it("returns no suggestion when every candidate is taken", async () => {
    mockExists.mockResolvedValue(true);
    const plan = await planManagedFlagKey({
      context,
      experiment: experiment(),
    });
    expect(plan.derivedIdAvailable).toBe(false);
    expect(plan.suggestedPair).toBeNull();
  });
});

describe("adoptManagedFlagForExperiment refuses before renaming", () => {
  // Renaming the tracking key re-buckets users, so the blocker runs before
  // `updateExperiment`.
  const adopt = (over: Partial<ExperimentInterface>) =>
    adoptManagedFlagForExperiment({
      context,
      experiment: experiment(over),
      valueType: "string",
      variations: [
        { variationId: "v0", value: "0" },
        { variationId: "v1", value: "1" },
      ],
      // A rename is requested, so reaching it would be observable.
      trackingKey: "renamed-key",
      eventAudit: null,
      audit: jest.fn(),
    });

  it.each<Partial<ExperimentInterface>>([
    { status: "running" },
    { archived: true },
    { linkedFeatures: ["other-flag"] },
  ])("refuses %j without renaming", async (over) => {
    // A linked flag that no longer exists would not block.
    taken("other-flag");
    await expect(adopt(over)).rejects.toThrow();
    expect(mockUpdateExperiment).not.toHaveBeenCalled();
  });
});
