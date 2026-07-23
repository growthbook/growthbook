import { ContextualBanditInterface, Variation } from "shared/validators";
import { ApiReqContext } from "back-end/types/api";
import { executeContextualBanditVariationChange } from "back-end/src/enterprise/services/contextualBandits";
import { refreshLinkedFeaturePayloads } from "back-end/src/services/contextualBanditChanges";
import { getRefLinkedFeatureInfo } from "back-end/src/services/experiments";

jest.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: jest.fn(),
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

function v(id: string, key: string): Variation {
  return { id, name: `V${key}`, key, screenshots: [] } as Variation;
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
  const updateMock = jest
    .fn()
    .mockImplementation((existing, changes) => ({ ...existing, ...changes }));
  const patchLeafWeightsMock = jest
    .fn()
    .mockImplementation((_cbId: string, leafWeights) => ({
      ...cb,
      currentLeafWeights: leafWeights.length
        ? leafWeights
        : cb.currentLeafWeights,
      banditVersion: cb.banditVersion + 1,
    }));
  const context = {
    org: { id: "org_1" },
    models: {
      contextualBandits: {
        update: updateMock,
        patchLeafWeights: patchLeafWeightsMock,
      },
    },
  } as unknown as ApiReqContext;
  return { context, updateMock, patchLeafWeightsMock };
}

const sum = (pairs: { weight: number }[]) =>
  pairs.reduce((s, p) => s + p.weight, 0);

describe("executeContextualBanditVariationChange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    refreshLinkedFeaturePayloadsMock.mockResolvedValue(undefined);
    getRefLinkedFeatureInfoMock.mockResolvedValue([]);
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
    expect(changes.variations.map((x: Variation) => x.id)).toEqual([
      "v0",
      "v2",
    ]);
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

  it("allows metadata-only edits in exploit without reconciling weights or bumping version", async () => {
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

  it("blocks removing a variation still referenced by a linked feature", async () => {
    const cb = makeCb({
      variations: [v("v0", "0"), v("v1", "1"), v("v2", "2")],
      linkedFeatures: ["feat_1"],
    });
    getRefLinkedFeatureInfoMock.mockResolvedValue([
      { values: [{ variationId: "v1", value: "x" }] },
    ]);
    const { context, updateMock } = makeContext(cb);

    await expect(
      executeContextualBanditVariationChange(context, cb, [
        v("v0", "0"),
        v("v2", "2"),
      ]),
    ).rejects.toThrow(/still used by a linked feature/i);
    expect(updateMock).not.toHaveBeenCalled();
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
