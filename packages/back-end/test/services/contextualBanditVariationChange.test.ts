import { ContextualBanditInterface, Variation } from "shared/validators";
import {
  ContextualBanditRefRule,
  FeatureInterface,
  FeatureRule,
} from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ApiReqContext } from "back-end/types/api";
import { executeContextualBanditVariationChange } from "back-end/src/enterprise/services/contextualBandits";
import { refreshLinkedFeaturePayloads } from "back-end/src/services/contextualBanditChanges";
import { getRefLinkedFeatureInfo } from "back-end/src/services/experiments";
import {
  getDraftRevision,
  getLiveAndBaseRevisionsForFeature,
} from "back-end/src/services/features";
import {
  getRevision,
  updateRevision,
} from "back-end/src/models/FeatureRevisionModel";
import { getFeature, publishRevision } from "back-end/src/models/FeatureModel";
import { publishPendingFeatureDraftsForContextualBandit } from "back-end/src/services/experiment-feature";

jest.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: jest.fn(),
  generateRuleId: jest.fn(() => "fr_new"),
  getDraftRevision: jest.fn(),
  assertCanAutoPublish: jest.fn(),
  getLiveAndBaseRevisionsForFeature: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: jest.fn(),
  updateRevision: jest.fn(),
  discardRevision: jest.fn(),
  getLinkageSyncRevisionSummaries: jest
    .fn()
    .mockResolvedValue({ openDrafts: [], liveRevision: null }),
}));

jest.mock("back-end/src/models/FeatureModel", () => ({
  publishRevision: jest.fn(),
  getFeature: jest.fn(),
}));

jest.mock("back-end/src/services/experiment-feature", () => ({
  publishPendingFeatureDraftsForContextualBandit: jest
    .fn()
    .mockResolvedValue({ published: [], failed: [] }),
}));

jest.mock("back-end/src/util/featureContextualBanditSync", () => ({
  syncFeatureContextualBanditLinkages: jest.fn(),
}));

jest.mock("back-end/src/services/featureRevisionEvents", () => ({
  recordRevisionUpdate: jest.fn(),
}));

jest.mock("back-end/src/services/configValidation", () => ({
  assertConfigBackedFeatureValuesValid: jest.fn(),
}));

jest.mock("back-end/src/services/contextualBanditChanges", () => ({
  refreshLinkedFeaturePayloads: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("back-end/src/services/experiments", () => ({
  getRefLinkedFeatureInfo: jest.fn().mockResolvedValue([]),
}));

jest.mock("back-end/src/models/DataSourceModel", () => ({
  getDataSourceById: jest.fn(),
}));

jest.mock("back-end/src/services/datasource", () => ({
  getSourceIntegrationObject: jest.fn(),
}));

jest.mock(
  "back-end/src/enterprise/queryRunners/ContextualBanditResultsQueryRunner",
  () => ({
    ContextualBanditResultsQueryRunner: jest.fn(),
  }),
);

const refreshLinkedFeaturePayloadsMock =
  refreshLinkedFeaturePayloads as jest.MockedFunction<
    typeof refreshLinkedFeaturePayloads
  >;
const getRefLinkedFeatureInfoMock = getRefLinkedFeatureInfo as jest.Mock;
const getDraftRevisionMock = getDraftRevision as jest.MockedFunction<
  typeof getDraftRevision
>;
const getRevisionMock = getRevision as jest.MockedFunction<typeof getRevision>;
const updateRevisionMock = updateRevision as jest.MockedFunction<
  typeof updateRevision
>;
const publishRevisionMock = publishRevision as jest.MockedFunction<
  typeof publishRevision
>;
const getFeatureMock = getFeature as jest.Mock;
const publishPendingDraftsMock =
  publishPendingFeatureDraftsForContextualBandit as jest.Mock;
const getLiveAndBaseRevisionsMock =
  getLiveAndBaseRevisionsForFeature as jest.MockedFunction<
    typeof getLiveAndBaseRevisionsForFeature
  >;

function v(id: string, key: string): Variation {
  return { id, name: `V${key}`, key, screenshots: [] } as Variation;
}

function cbRefRule(
  overrides: Partial<ContextualBanditRefRule> = {},
): FeatureRule {
  return {
    id: "fr_1",
    type: "contextual-bandit-ref",
    contextualBanditId: "cb_1",
    description: "",
    enabled: true,
    condition: "",
    scheduleRules: [],
    allEnvironments: true,
    variations: [
      { variationId: "v0", value: "control" },
      { variationId: "v1", value: "treatment" },
    ],
    ...overrides,
  } as FeatureRule;
}

function makeFeature(
  overrides: Partial<FeatureInterface> = {},
): FeatureInterface {
  return {
    id: "feature",
    organization: "org_1",
    version: 3,
    valueType: "string",
    defaultValue: "control",
    environmentSettings: { production: { enabled: true } },
    rules: [cbRefRule()],
    ...overrides,
  } as unknown as FeatureInterface;
}

function makeRevision(
  overrides: Partial<FeatureRevisionInterface> = {},
): FeatureRevisionInterface {
  return {
    organization: "org_1",
    featureId: "feature",
    version: 4,
    baseVersion: 3,
    status: "draft",
    rules: [cbRefRule()],
    environmentsEnabled: {},
    ...overrides,
  } as unknown as FeatureRevisionInterface;
}

function linkedInfo(
  feature: FeatureInterface,
  overrides: Record<string, unknown> = {},
) {
  const rule = ((feature.rules ?? []) as FeatureRule[]).find(
    (r) => r.type === "contextual-bandit-ref",
  ) as ContextualBanditRefRule | undefined;
  return {
    feature,
    state: "live",
    values: rule?.variations ?? [],
    environmentStates: { production: "active" },
    ...overrides,
  };
}

function makeCb(
  overrides: Partial<ContextualBanditInterface> = {},
): ContextualBanditInterface {
  return {
    id: "cb_1",
    organization: "org_1",
    dateCreated: new Date("2025-01-01T00:00:00Z"),
    dateUpdated: new Date("2025-01-01T00:00:00Z"),
    project: "",
    name: "CB 1",
    trackingKey: "",
    datasource: "ds_1",
    contextualBanditQueryId: "cbq_1",
    contextualAttributes: ["country"],
    minUsersPerLeaf: 100,
    maxLeaves: 8,
    holdoutPercent: 0,
    banditModelVersion: 1,
    decisionMetric: "met_g1",
    status: "running",
    stage: "explore",
    variations: [v("v0", "0"), v("v1", "1")],
    variationWeights: [
      { variationId: "v0", weight: 0.5 },
      { variationId: "v1", weight: 0.5 },
    ],
    currentLeafWeights: [],
    banditVersion: 3,
    linkedFeatures: [],
    ...overrides,
  } as unknown as ContextualBanditInterface;
}

function makeContext(cb: ContextualBanditInterface) {
  // Mirrors the real model: update() persists, patchLeafWeights() re-fetches.
  let currentDoc: ContextualBanditInterface = cb;
  const updateMock = jest.fn().mockImplementation((existing, changes) => {
    currentDoc = { ...existing, ...changes };
    return currentDoc;
  });
  const patchLeafWeightsMock = jest
    .fn()
    .mockImplementation((_cbId: string, leafWeights) => {
      currentDoc = {
        ...currentDoc,
        currentLeafWeights: leafWeights.length
          ? leafWeights
          : currentDoc.currentLeafWeights,
        banditVersion: currentDoc.banditVersion + 1,
      };
      return currentDoc;
    });
  const canPublishFeature = jest.fn().mockReturnValue(true);
  const throwPermissionError = jest.fn(() => {
    throw new Error("permission error");
  });
  const context = {
    org: { id: "org_1", settings: {} },
    environments: ["production"],
    logger: { warn: jest.fn() },
    auditUser: { type: "dashboard" },
    auditLog: jest.fn(),
    permissions: {
      canPublishFeature,
      canUpdateFeature: jest.fn().mockReturnValue(true),
      canManageFeatureDrafts: jest.fn().mockReturnValue(true),
      canBypassApprovalChecks: jest.fn().mockReturnValue(false),
      throwPermissionError,
    },
    models: {
      contextualBandits: {
        update: updateMock,
        patchLeafWeights: patchLeafWeightsMock,
      },
    },
  } as unknown as ApiReqContext;
  return {
    context,
    updateMock,
    patchLeafWeightsMock,
    canPublishFeature,
  };
}

function cbRefVariationsFromUpdateRevision(n = 0) {
  const changes = updateRevisionMock.mock.calls[n][3] as {
    rules: FeatureRule[];
  };
  return (
    changes.rules.find(
      (r) => r.type === "contextual-bandit-ref",
    ) as ContextualBanditRefRule
  ).variations;
}

const sum = (pairs: { weight: number }[]) =>
  pairs.reduce((s, p) => s + p.weight, 0);

describe("executeContextualBanditVariationChange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    refreshLinkedFeaturePayloadsMock.mockResolvedValue(undefined);
    getRefLinkedFeatureInfoMock.mockResolvedValue([]);
    getDraftRevisionMock.mockResolvedValue(makeRevision());
    getFeatureMock.mockResolvedValue(makeFeature());
    publishPendingDraftsMock.mockResolvedValue({ published: [], failed: [] });
    updateRevisionMock.mockImplementation(
      async (_context, _feature, revision, changes) =>
        ({ ...revision, ...changes }) as FeatureRevisionInterface,
    );
    const liveRevision = makeRevision({ version: 3, status: "published" });
    getLiveAndBaseRevisionsMock.mockResolvedValue({
      live: liveRevision,
      base: liveRevision,
    });
  });

  it("adds a variation in explore: uniform aggregate weights, empty leaf weights, version bump, payload refresh", async () => {
    const cb = makeCb();
    const { context, updateMock, patchLeafWeightsMock } = makeContext(cb);

    const { updated } = await executeContextualBanditVariationChange(
      context,
      cb,
      [v("v0", "0"), v("v1", "1"), v("", "2")],
    );

    expect(updateMock).toHaveBeenCalledTimes(1);
    const [, changes] = updateMock.mock.calls[0];
    expect(changes.variations).toHaveLength(3);
    expect(changes.variations[2].id).toBeTruthy();
    expect(changes.variationWeights).toHaveLength(3);
    expect(sum(changes.variationWeights)).toBeCloseTo(1, 6);
    changes.variationWeights.forEach((w: { weight: number }) =>
      expect(w.weight).toBeCloseTo(1 / 3, 3),
    );

    expect(patchLeafWeightsMock).toHaveBeenCalledTimes(1);
    expect(patchLeafWeightsMock.mock.calls[0][1]).toEqual([]);
    expect(patchLeafWeightsMock.mock.calls[0][2]).toEqual({
      bumpVersion: true,
    });
    expect(updated.banditVersion).toBe(cb.banditVersion + 1);

    expect(refreshLinkedFeaturePayloadsMock).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ id: cb.id }),
      "contextualBandit.refresh",
    );
  });

  it("removes a variation in explore: re-equalizes across the remaining arms", async () => {
    const cb = makeCb({
      variations: [v("v0", "0"), v("v1", "1"), v("v2", "2")],
      variationWeights: [
        { variationId: "v0", weight: 0.2 },
        { variationId: "v1", weight: 0.3 },
        { variationId: "v2", weight: 0.5 },
      ],
    });
    const { context, updateMock } = makeContext(cb);

    await executeContextualBanditVariationChange(context, cb, [
      v("v0", "0"),
      v("v2", "2"),
    ]);

    const [, changes] = updateMock.mock.calls[0];
    // Removed arm stays as a tombstone at the tail.
    expect(changes.variations.map((x: Variation) => x.id)).toEqual([
      "v0",
      "v2",
      "v1",
    ]);
    expect(
      changes.variations.find((x: { id: string }) => x.id === "v1").status,
    ).toBe("deactivated");
    expect(changes.variationWeights).toEqual([
      { variationId: "v0", weight: 0.5 },
      { variationId: "v2", weight: 0.5 },
    ]);
  });

  it("adds a variation in exploit: redistributes weights (Luke A+B) and bumps version", async () => {
    const cb = makeCb({ stage: "exploit" });
    const { context, updateMock, patchLeafWeightsMock } = makeContext(cb);

    const { updated } = await executeContextualBanditVariationChange(
      context,
      cb,
      [v("v0", "0"), v("v1", "1"), v("", "2")],
    );

    expect(updateMock).toHaveBeenCalledTimes(1);
    const [, changes] = updateMock.mock.calls[0];
    expect(changes.variations).toHaveLength(3);
    const newId = changes.variations[2].id;
    const wmap = Object.fromEntries(
      changes.variationWeights.map(
        (p: { variationId: string; weight: number }) => [
          p.variationId,
          p.weight,
        ],
      ),
    );
    expect(wmap["v0"]).toBeCloseTo(1 / 3, 6);
    expect(wmap["v1"]).toBeCloseTo(1 / 3, 6);
    expect(wmap[newId]).toBeCloseTo(1 / 3, 6);
    expect(sum(changes.variationWeights)).toBeCloseTo(1, 6);
    expect(patchLeafWeightsMock).toHaveBeenCalledTimes(1);
    expect(patchLeafWeightsMock.mock.calls[0][2]).toEqual({
      bumpVersion: true,
    });
    expect(updated.banditVersion).toBe(cb.banditVersion + 1);
  });

  it("allows metadata-only edits in exploit without reconciling weights, bumping version, or touching linked features", async () => {
    const cb = makeCb({ stage: "exploit" });
    const { context, updateMock, patchLeafWeightsMock } = makeContext(cb);

    await executeContextualBanditVariationChange(context, cb, [
      v("v0", "0"),
      { id: "v1", name: "Renamed", key: "1", screenshots: [] } as Variation,
    ]);

    expect(updateMock).toHaveBeenCalledTimes(1);
    const [, changes] = updateMock.mock.calls[0];
    expect(changes.variations[1].name).toBe("Renamed");
    expect(changes).not.toHaveProperty("variationWeights");
    expect(patchLeafWeightsMock).not.toHaveBeenCalled();
    expect(getRefLinkedFeatureInfoMock).not.toHaveBeenCalled();
    expect(updateRevisionMock).not.toHaveBeenCalled();
  });

  it("reorders variations (same set): bumps version without recomputing weights", async () => {
    const cb = makeCb({ stage: "exploit" });
    const { context, updateMock, patchLeafWeightsMock } = makeContext(cb);

    // Swap the order of the two existing arms.
    await executeContextualBanditVariationChange(context, cb, [
      v("v1", "1"),
      v("v0", "0"),
    ]);

    // Variations persisted in the new order, weights NOT recomputed...
    const [, changes] = updateMock.mock.calls[0];
    expect(changes.variations.map((x: Variation) => x.id)).toEqual([
      "v1",
      "v0",
    ]);
    expect(changes).not.toHaveProperty("variationWeights");
    // ...but the version is bumped (empty leaf weights, bumpVersion requested).
    expect(patchLeafWeightsMock).toHaveBeenCalledTimes(1);
    expect(patchLeafWeightsMock.mock.calls[0][1]).toEqual([]);
    expect(patchLeafWeightsMock.mock.calls[0][2]).toEqual({
      bumpVersion: true,
    });
  });

  it("aborts before persisting when a new-arm value fails type validation (#3)", async () => {
    // A linked feature with a numeric value type; a non-numeric provided value
    // must throw before any weight write.
    const feature = makeFeature({
      valueType: "number",
      defaultValue: "1",
      rules: [
        cbRefRule({
          variations: [
            { variationId: "v0", value: "1" },
            { variationId: "v1", value: "2" },
          ],
        }),
      ],
    } as Partial<FeatureInterface>);
    getRefLinkedFeatureInfoMock.mockResolvedValue([linkedInfo(feature)]);
    const cb = makeCb({ linkedFeatures: ["feature"] });
    const { context, updateMock, patchLeafWeightsMock } = makeContext(cb);

    await expect(
      executeContextualBanditVariationChange(
        context,
        cb,
        [v("v0", "0"), v("v1", "1"), v("v2", "2")],
        { feature: { v2: "not-a-number" } },
      ),
    ).rejects.toThrow();

    // Nothing persisted.
    expect(updateMock).not.toHaveBeenCalled();
    expect(patchLeafWeightsMock).not.toHaveBeenCalled();
    expect(updateRevisionMock).not.toHaveBeenCalled();
  });

  it("rejects when a running-CB editor lacks publish permission on a linked feature (#4)", async () => {
    getRefLinkedFeatureInfoMock.mockResolvedValue([linkedInfo(makeFeature())]);
    const cb = makeCb({ status: "running", linkedFeatures: ["feature"] });
    const { context, updateMock, canPublishFeature } = makeContext(cb);
    canPublishFeature.mockReturnValue(false);

    await expect(
      executeContextualBanditVariationChange(context, cb, [
        v("v0", "0"),
        v("v1", "1"),
        v("v2", "2"),
      ]),
    ).rejects.toThrow(/permission/i);

    expect(canPublishFeature).toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(updateRevisionMock).not.toHaveBeenCalled();
  });

  it("rejects editing variations on a stopped bandit", async () => {
    const cb = makeCb({ status: "stopped" });
    const { context } = makeContext(cb);

    await expect(
      executeContextualBanditVariationChange(context, cb, [
        v("v0", "0"),
        v("v1", "1"),
        v("", "2"),
      ]),
    ).rejects.toThrow(/stopped/i);
  });

  it("rejects dropping below two variations", async () => {
    const cb = makeCb();
    const { context } = makeContext(cb);

    await expect(
      executeContextualBanditVariationChange(context, cb, [v("v0", "0")]),
    ).rejects.toThrow(/at least 2/i);
  });

  it("removing a variation drops it from each linked feature's rule (staged, not published, for a draft CB)", async () => {
    const feature = makeFeature({
      rules: [
        cbRefRule({
          variations: [
            { variationId: "v0", value: "control" },
            { variationId: "v1", value: "treatment" },
            { variationId: "v2", value: "extra" },
          ],
        }),
      ],
    } as Partial<FeatureInterface>);
    getDraftRevisionMock.mockResolvedValue(
      makeRevision({ rules: feature.rules as FeatureRule[] }),
    );
    getRefLinkedFeatureInfoMock.mockResolvedValue([linkedInfo(feature)]);
    const cb = makeCb({
      status: "draft",
      variations: [v("v0", "0"), v("v1", "1"), v("v2", "2")],
      linkedFeatures: ["feature"],
    });
    const { context, updateMock } = makeContext(cb);

    await executeContextualBanditVariationChange(context, cb, [
      v("v0", "0"),
      v("v1", "1"),
    ]);

    expect(updateRevisionMock).toHaveBeenCalledTimes(1);
    expect(cbRefVariationsFromUpdateRevision()).toEqual([
      { variationId: "v0", value: "control" },
      { variationId: "v1", value: "treatment" },
    ]);
    expect(publishRevisionMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("adding an arm on a running CB writes the value into the rule, publishes immediately, and the arm starts ACTIVE with seeded weight", async () => {
    const feature = makeFeature();
    getRefLinkedFeatureInfoMock.mockResolvedValue([linkedInfo(feature)]);
    // Publish succeeded, so the re-read sees the new arm.
    getFeatureMock.mockResolvedValue(
      makeFeature({
        rules: [
          cbRefRule({
            variations: [
              { variationId: "v0", value: "control" },
              { variationId: "v1", value: "treatment" },
              { variationId: "v2", value: "added-value" },
            ],
          }),
        ],
      } as Partial<FeatureInterface>),
    );
    const cb = makeCb({ status: "running", linkedFeatures: ["feature"] });
    const { context, updateMock } = makeContext(cb);

    const { featureDraftPublishFailures, pendingVariationIds, updated } =
      await executeContextualBanditVariationChange(
        context,
        cb,
        [v("v0", "0"), v("v1", "1"), v("v2", "2")],
        { feature: { v2: "added-value" } },
      );

    expect(updateRevisionMock).toHaveBeenCalledTimes(1);
    expect(cbRefVariationsFromUpdateRevision()).toContainEqual({
      variationId: "v2",
      value: "added-value",
    });
    expect(publishRevisionMock).toHaveBeenCalledTimes(1);
    expect(featureDraftPublishFailures).toEqual([]);
    expect(refreshLinkedFeaturePayloadsMock).toHaveBeenCalledTimes(1);
    // Live everywhere → straight to active, with a weight seed.
    expect(pendingVariationIds).toEqual([]);
    const savedVariations = updateMock.mock.calls[0][1].variations;
    expect(
      savedVariations.find((x: { id: string }) => x.id === "v2").status,
    ).toBeUndefined();
    expect(updated.variationWeights?.map((p) => p.variationId).sort()).toEqual([
      "v0",
      "v1",
      "v2",
    ]);
  });

  it("downgrades a failed auto-publish to a staged draft, reports it, and holds the added arm PENDING with no weight", async () => {
    const feature = makeFeature();
    getRefLinkedFeatureInfoMock.mockResolvedValue([linkedInfo(feature)]);
    publishRevisionMock.mockRejectedValueOnce(new Error("boom"));
    // Publish failed, so the live doc still only carries v0/v1.
    const cb = makeCb({ status: "running", linkedFeatures: ["feature"] });
    const { context, updateMock } = makeContext(cb);

    const { featureDraftPublishFailures, pendingVariationIds, updated } =
      await executeContextualBanditVariationChange(context, cb, [
        v("v0", "0"),
        v("v1", "1"),
        v("v2", "2"),
      ]);

    expect(updateRevisionMock).toHaveBeenCalledTimes(2);
    expect(featureDraftPublishFailures).toEqual([
      { featureId: "feature", revisionVersion: 4, reason: "publish-error" },
    ]);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(refreshLinkedFeaturePayloadsMock).toHaveBeenCalledTimes(1);
    expect(pendingVariationIds).toEqual(["v2"]);
    expect(updated.variations.find((x) => x.id === "v2")?.status).toBe(
      "pending",
    );
    expect(updated.variationWeights?.map((p) => p.variationId).sort()).toEqual([
      "v0",
      "v1",
    ]);
    expect(sum(updated.variationWeights ?? [])).toBeCloseTo(1, 6);
  });

  it("activates a pending arm and seeds its weight when a re-save finds its value live (retry path)", async () => {
    // v2 was pending; the draft has since published, so the live doc now carries it.
    getFeatureMock.mockResolvedValue(
      makeFeature({
        rules: [
          cbRefRule({
            variations: [
              { variationId: "v0", value: "control" },
              { variationId: "v1", value: "treatment" },
              { variationId: "v2", value: "added-value" },
            ],
          }),
        ],
      } as Partial<FeatureInterface>),
    );
    const cb = makeCb({
      status: "running",
      linkedFeatures: ["feature"],
      variations: [
        v("v0", "0"),
        v("v1", "1"),
        { ...v("v2", "2"), status: "pending" as const },
      ],
    } as Partial<ContextualBanditInterface>);
    const { context, patchLeafWeightsMock } = makeContext(cb);

    // Same visible arm set — the old code treated this re-save as a no-op.
    const { pendingVariationIds, updated } =
      await executeContextualBanditVariationChange(context, cb, [
        v("v0", "0"),
        v("v1", "1"),
        v("v2", "2"),
      ]);

    // The re-save retried the stuck drafts and promoted the arm.
    expect(publishPendingDraftsMock).toHaveBeenCalledTimes(1);
    expect(pendingVariationIds).toEqual([]);
    expect(updated.variations.find((x) => x.id === "v2")?.status).toBe(
      "active",
    );
    expect(updated.variationWeights?.map((p) => p.variationId).sort()).toEqual([
      "v0",
      "v1",
      "v2",
    ]);
    // Activation opens a new weight epoch.
    expect(patchLeafWeightsMock).toHaveBeenCalledWith("cb_1", [], {
      bumpVersion: true,
    });
  });

  it("keeps a pending arm pending on re-save while its value is still not live", async () => {
    const cb = makeCb({
      status: "running",
      linkedFeatures: ["feature"],
      variations: [
        v("v0", "0"),
        v("v1", "1"),
        { ...v("v2", "2"), status: "pending" as const },
      ],
    } as Partial<ContextualBanditInterface>);
    const { context, patchLeafWeightsMock } = makeContext(cb);

    const { pendingVariationIds, updated } =
      await executeContextualBanditVariationChange(context, cb, [
        v("v0", "0"),
        v("v1", "1"),
        v("v2", "2"),
      ]);

    expect(pendingVariationIds).toEqual(["v2"]);
    expect(updated.variations.find((x) => x.id === "v2")?.status).toBe(
      "pending",
    );
    // No activation → no weight epoch bump.
    expect(patchLeafWeightsMock).not.toHaveBeenCalled();
  });

  it("removing a variation tombstones it in place: id preserved, no weight, hidden from the API arm set", async () => {
    const cb = makeCb({
      variations: [v("v0", "0"), v("v1", "1"), v("v2", "2")],
      variationWeights: [
        { variationId: "v0", weight: 0.33 },
        { variationId: "v1", weight: 0.33 },
        { variationId: "v2", weight: 0.34 },
      ],
    } as Partial<ContextualBanditInterface>);
    const { context, updateMock } = makeContext(cb);

    const { updated } = await executeContextualBanditVariationChange(
      context,
      cb,
      [v("v0", "0"), v("v1", "1")],
    );

    const savedVariations = updateMock.mock.calls[0][1].variations;
    const tombstone = savedVariations.find(
      (x: { id: string }) => x.id === "v2",
    );
    expect(tombstone).toBeDefined();
    expect(tombstone.status).toBe("deactivated");
    expect(updated.variationWeights?.map((p) => p.variationId).sort()).toEqual([
      "v0",
      "v1",
    ]);
  });

  it("never resurrects a tombstoned variation id", async () => {
    const cb = makeCb({
      variations: [
        v("v0", "0"),
        v("v1", "1"),
        { ...v("v2", "2"), status: "deactivated" as const },
      ],
    } as Partial<ContextualBanditInterface>);
    const { context } = makeContext(cb);

    await expect(
      executeContextualBanditVariationChange(context, cb, [
        v("v0", "0"),
        v("v1", "1"),
        v("v2", "2"),
      ]),
    ).rejects.toThrow(/cannot be re-added/);
  });

  it("carries tombstones through a metadata-only save untouched", async () => {
    const cb = makeCb({
      variations: [
        v("v0", "0"),
        v("v1", "1"),
        { ...v("v2", "2"), status: "deactivated" as const },
      ],
    } as Partial<ContextualBanditInterface>);
    const { context, updateMock } = makeContext(cb);

    await executeContextualBanditVariationChange(context, cb, [
      { id: "v0", name: "Renamed", key: "0", screenshots: [] } as Variation,
      v("v1", "1"),
    ]);

    const savedVariations = updateMock.mock.calls[0][1].variations;
    expect(
      savedVariations.find((x: { id: string }) => x.id === "v2")?.status,
    ).toBe("deactivated");
    // A save on a bandit with tombstones retries the linked-feature sync.
    expect(publishPendingDraftsMock).toHaveBeenCalledTimes(1);
  });

  it("bundles the rule edit into the pending draft that carries the bandit's rule", async () => {
    const feature = makeFeature({ rules: [] } as Partial<FeatureInterface>);
    const draftRules = [cbRefRule()];
    getRefLinkedFeatureInfoMock.mockResolvedValue([
      linkedInfo(feature, {
        state: "draft",
        draftRevisionVersion: 6,
        values: (draftRules[0] as ContextualBanditRefRule).variations,
      }),
    ]);
    getRevisionMock.mockResolvedValue(
      makeRevision({ version: 6, rules: draftRules }),
    );
    getDraftRevisionMock.mockResolvedValue(
      makeRevision({ version: 6, rules: draftRules }),
    );
    const cb = makeCb({
      status: "draft",
      linkedFeatures: [],
      pendingFeatureDrafts: [{ featureId: "feature", revisionVersion: 6 }],
    } as Partial<ContextualBanditInterface>);
    const { context } = makeContext(cb);

    await executeContextualBanditVariationChange(context, cb, [
      v("v0", "0"),
      v("v1", "1"),
      v("v2", "2"),
    ]);

    expect(getDraftRevisionMock).toHaveBeenCalledWith(context, feature, 6);
    expect(cbRefVariationsFromUpdateRevision()).toContainEqual({
      variationId: "v2",
      value: "control",
    });
    expect(publishRevisionMock).not.toHaveBeenCalled();
  });

  it("refreshes the SDK payload even on a metadata-only edit (keys/names change the payload)", async () => {
    const cb = makeCb();
    const { context } = makeContext(cb);

    await executeContextualBanditVariationChange(context, cb, [
      v("v0", "0"),
      { id: "v1", name: "Renamed", key: "1", screenshots: [] } as Variation,
    ]);

    expect(refreshLinkedFeaturePayloadsMock).toHaveBeenCalledTimes(1);
  });
});
