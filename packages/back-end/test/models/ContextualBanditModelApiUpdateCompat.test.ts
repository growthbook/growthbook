import { ContextualBanditInterface } from "shared/validators";
import type { Context } from "back-end/src/models/BaseModel";
import { ContextualBanditModel } from "back-end/src/enterprise/models/ContextualBanditModel";
import { executeContextualBanditVariationChange } from "back-end/src/enterprise/services/contextualBandits";

jest.mock("back-end/src/enterprise/services/contextualBandits", () => ({
  executeContextualBanditVariationChange: jest.fn(),
  activatePendingContextualBanditVariations: jest.fn(),
  cancelContextualBanditLatestRunningSnapshot: jest.fn(),
  getContextualBanditLinkedFeatureInfo: jest.fn(),
  runContextualBanditSnapshot: jest.fn(),
}));

jest.mock("back-end/src/services/contextualBanditChanges", () => ({
  executeContextualBanditStart: jest.fn(),
  executeContextualBanditStop: jest.fn(),
  refreshLinkedFeaturePayloads: jest.fn(),
}));

jest.mock("back-end/src/services/owner", () => ({
  resolveOwnerEmail: jest.fn(async (doc: unknown) => doc),
  resolveOwnerEmails: jest.fn(async (docs: unknown) => docs),
}));

const executeChangeMock =
  executeContextualBanditVariationChange as jest.MockedFunction<
    typeof executeContextualBanditVariationChange
  >;

function makeCb(
  overrides: Partial<ContextualBanditInterface> = {},
): ContextualBanditInterface {
  return {
    id: "cb_1",
    organization: "org_1",
    dateCreated: new Date("2026-01-01"),
    dateUpdated: new Date("2026-01-01"),
    name: "CB",
    description: "",
    project: "",
    owner: "",
    tags: [],
    trackingKey: "cb_1",
    hashAttribute: "id",
    variations: [
      { id: "a", name: "Control", key: "0", screenshots: [] },
      { id: "b", name: "B", key: "1", screenshots: [] },
      {
        id: "z",
        name: "Old",
        key: "2",
        screenshots: [],
        status: "deactivated",
      },
    ],
    datasource: "ds_1",
    contextualBanditQueryId: "cbq_1",
    contextualAttributes: [],
    decisionMetric: "fact__m",
    minUsersPerLeaf: 100,
    maxLeaves: 10,
    scheduleValue: 1,
    scheduleUnit: "days",
    burnInValue: 1,
    burnInUnit: "days",
    archived: false,
    status: "running",
    stage: "explore",
    coverage: 1,
    condition: "",
    savedGroups: [],
    prerequisites: [],
    seed: "seed",
    variationWeights: [
      { variationId: "a", weight: 0.5 },
      { variationId: "b", weight: 0.5 },
    ],
    currentLeafWeights: [],
    banditVersion: 3,
    linkedFeatures: [],
    pendingFeatureDrafts: [],
    ...overrides,
  } as unknown as ContextualBanditInterface;
}

function makeModel() {
  const logger = { warn: jest.fn() };
  const context = {
    org: { id: "org_1", settings: {} },
    logger,
    permissions: {
      canUpdateContextualBandit: jest.fn(() => true),
      throwPermissionError: jest.fn(() => {
        throw new Error("permission");
      }),
    },
    models: {},
  } as unknown as Context;
  class TestModel extends ContextualBanditModel {
    protected updateIndexes() {}
  }
  const model = new TestModel(context);
  const cb = makeCb();
  jest.spyOn(model, "getById").mockResolvedValue(cb);
  const updateById = jest
    .spyOn(model, "updateById")
    .mockImplementation(async (_id, updates) => ({
      ...cb,
      ...(updates as Partial<ContextualBanditInterface>),
    }));
  return { model, cb, updateById, logger, context };
}

function makeReq(body: Record<string, unknown>) {
  const res = { setHeader: jest.fn() };
  return {
    req: { params: { id: "cb_1" }, body, res } as unknown as Parameters<
      ContextualBanditModel["handleApiUpdate"]
    >[0],
    res,
  };
}

describe("ContextualBanditModel.handleApiUpdate compat for deprecated PUT fields", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    executeChangeMock.mockImplementation(async (_ctx, cb, args) => ({
      updated: {
        ...cb,
        banditVersion: cb.banditVersion + 1,
        variations: [
          ...cb.variations,
          ...(args.addVariations ?? []).map((v) => ({
            id: v.id ?? "gen",
            name: v.name,
            key: v.key ?? "9",
            screenshots: v.screenshots ?? [],
          })),
        ],
      },
      featureDraftPublishFailures: [],
    }));
  });

  it("leaves the normal path alone when no deprecated field is sent", async () => {
    const { model, updateById, logger } = makeModel();
    const { req, res } = makeReq({ name: "Renamed" });

    const out = await model.handleApiUpdate(req);

    expect(updateById).toHaveBeenCalledWith("cb_1", { name: "Renamed" });
    expect(executeChangeMock).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(out.name).toBe("Renamed");
  });

  it("treats a GET -> PUT round trip of `variations` as a no-op but flags deprecation", async () => {
    const { model, updateById, logger } = makeModel();
    const { req, res } = makeReq({
      variations: [
        { id: "b", name: "B", key: "1" },
        { id: "a", name: "Control", key: "0", status: "active" },
      ],
    });

    const out = await model.handleApiUpdate(req);

    expect(executeChangeMock).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("Deprecation", "true");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatchObject({
      variations: true,
      variationWeights: false,
    });
    expect(out.variations.map((v) => v.id)).toEqual(["a", "b"]);
  });

  it("routes an added arm through executeContextualBanditVariationChange", async () => {
    const { model, cb, context } = makeModel();
    const { req } = makeReq({
      variations: [
        { id: "a", name: "Control", key: "0", screenshots: [] },
        { id: "b", name: "B", key: "1", screenshots: [] },
        { id: "c", name: "C", key: "2", screenshots: [] },
      ],
    });

    const out = await model.handleApiUpdate(req);

    expect(executeChangeMock).toHaveBeenCalledTimes(1);
    expect(executeChangeMock).toHaveBeenCalledWith(context, cb, {
      addVariations: [{ id: "c", name: "C", key: "2", screenshots: [] }],
      removeVariationIds: [],
      updateVariations: [],
    });
    expect(out.variations.map((v) => v.id)).toEqual(["a", "b", "c"]);
  });

  it("routes a missing arm to removeVariationIds and a rename to updateVariations", async () => {
    const { model, cb, context } = makeModel();
    const { req } = makeReq({
      variations: [{ id: "b", name: "B renamed", key: "1" }],
    });

    await model.handleApiUpdate(req);

    expect(executeChangeMock).toHaveBeenCalledWith(context, cb, {
      addVariations: [],
      removeVariationIds: ["a"],
      updateVariations: [{ id: "b", name: "B renamed" }],
    });
  });

  it("never lets `variations` or `variationWeights` reach updateById", async () => {
    const { model, updateById } = makeModel();
    const { req } = makeReq({
      description: "d",
      variations: [
        { id: "a", name: "Control", key: "0" },
        { id: "b", name: "B", key: "1" },
      ],
      variationWeights: [{ variationId: "a", weight: 1 }],
    });

    await model.handleApiUpdate(req);

    expect(updateById).toHaveBeenCalledTimes(1);
    expect(updateById).toHaveBeenCalledWith("cb_1", { description: "d" });
  });

  it("ignores `variationWeights` on its own, with the header and a warn log", async () => {
    const { model, updateById, logger } = makeModel();
    const { req, res } = makeReq({
      variationWeights: [
        { variationId: "a", weight: 0.9 },
        { variationId: "b", weight: 0.1 },
      ],
    });

    const out = await model.handleApiUpdate(req);

    expect(updateById).not.toHaveBeenCalled();
    expect(executeChangeMock).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("Deprecation", "true");
    expect(logger.warn.mock.calls[0][0]).toMatchObject({
      variations: false,
      variationWeights: true,
    });
    expect(out.variationWeights).toEqual([
      { variationId: "a", weight: 0.5 },
      { variationId: "b", weight: 0.5 },
    ]);
  });

  it("applies other fields before the arm change, and passes the updated doc to the service", async () => {
    const { model, updateById, context } = makeModel();
    const order: string[] = [];
    updateById.mockImplementation(async (_id, updates) => {
      order.push("updateById");
      return {
        ...makeCb(),
        ...(updates as Partial<ContextualBanditInterface>),
      };
    });
    executeChangeMock.mockImplementation(async (_ctx, cb) => {
      order.push("executeChange");
      return { updated: cb, featureDraftPublishFailures: [] };
    });
    const { req } = makeReq({
      name: "New name",
      variations: [{ id: "a", name: "Control", key: "0" }],
    });

    await model.handleApiUpdate(req);

    expect(order).toEqual(["updateById", "executeChange"]);
    expect(executeChangeMock.mock.calls[0][0]).toBe(context);
    expect(executeChangeMock.mock.calls[0][1].name).toBe("New name");
  });

  it("does not persist an arm change when the other fields fail validation", async () => {
    const { model, updateById } = makeModel();
    updateById.mockRejectedValue(new Error("invalid decision metric"));
    const { req } = makeReq({
      decisionMetric: "not_a_fact_metric",
      variations: [{ id: "a", name: "Control", key: "0" }],
    });

    await expect(model.handleApiUpdate(req)).rejects.toThrow(
      "invalid decision metric",
    );
    expect(executeChangeMock).not.toHaveBeenCalled();
  });

  it("checks update permission before doing anything", async () => {
    const { model, context, updateById } = makeModel();
    (
      context.permissions.canUpdateContextualBandit as jest.Mock
    ).mockReturnValue(false);
    const { req } = makeReq({
      variations: [{ id: "a", name: "Control", key: "0" }],
    });

    await expect(model.handleApiUpdate(req)).rejects.toThrow("permission");
    expect(updateById).not.toHaveBeenCalled();
    expect(executeChangeMock).not.toHaveBeenCalled();
  });

  it("still rejects unknown body fields", async () => {
    const { model } = makeModel();
    const { req } = makeReq({
      variations: [{ id: "a", name: "Control", key: "0" }],
      notAField: 1,
    });

    await expect(model.handleApiUpdate(req)).rejects.toThrow();
    expect(executeChangeMock).not.toHaveBeenCalled();
  });
});
