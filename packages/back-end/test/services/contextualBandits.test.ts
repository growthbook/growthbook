import { ExposureQuery } from "shared/types/datasource";
import {
  ContextualBanditInterface,
  ContextualBanditSnapshotInterface,
  contextualBanditSnapshotSettingsValidator,
} from "shared/validators";
import { deriveContextId } from "shared/util";
import { ReqContext } from "back-end/types/api";
import {
  buildContextualBanditSnapshotSettings,
  buildSnapshotMetricRequestForCb,
  getContextualBanditResultsForUi,
  leafWeightsFromContextualBanditResult,
  persistContextualBanditEvent,
  toContextualBanditSnapshotStatusSummary,
} from "back-end/src/enterprise/services/contextualBandits";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { getPayloadKeysForContextualBandit } from "back-end/src/services/contextualBanditChanges";
import { ContextualBanditResult } from "back-end/src/enterprise/services/contextualBanditStats";

jest.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: jest.fn(),
}));

jest.mock("back-end/src/services/contextualBanditChanges", () => ({
  getPayloadKeysForContextualBandit: jest
    .fn()
    .mockReturnValue([{ project: "", environment: "production" }]),
}));

const queueSDKPayloadRefreshMock =
  queueSDKPayloadRefresh as jest.MockedFunction<typeof queueSDKPayloadRefresh>;
const getPayloadKeysForContextualBanditMock =
  getPayloadKeysForContextualBandit as jest.MockedFunction<
    typeof getPayloadKeysForContextualBandit
  >;

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
    datasourceId: "ds_1",
    exposureQueryId: "eq_1",
    contextualAttributes: ["country", "device"],
    maxContexts: 16,
    treeModel: "regression_tree",
    minUsersPerLeaf: 100,
    maxLeaves: 8,
    holdoutPercent: 0,
    disableStickyBucketing: false,
    canonicalFormVersion: 1,
    goalMetrics: ["met_g1"],
    secondaryMetrics: ["met_s1"],
    guardrailMetrics: ["met_guard"],
    metricOverrides: [],
    regressionAdjustmentEnabled: false,
    variations: [
      { id: "v0", name: "Control", key: "0", screenshots: [] },
      { id: "v1", name: "Treatment", key: "1", screenshots: [] },
    ],
    dateStarted: new Date("2025-01-02T00:00:00Z"),
    variationWeights: [0.4, 0.6],
    currentLeafWeights: [{ contextId: "ctx_catchall", weights: [0.5, 0.5] }],
    linkedFeatures: [],
    ...overrides,
  } as unknown as ContextualBanditInterface;
}

function makeExposureQuery(
  overrides: Partial<ExposureQuery> = {},
): ExposureQuery {
  return {
    id: "eq_1",
    name: "EAQ",
    description: "",
    userIdType: "user_id",
    query: "SELECT * FROM events",
    dimensions: [],
    targetingAttributeColumns: ["country", "device"],
    ...overrides,
  } as ExposureQuery;
}

function makeCbs(
  overrides: Partial<ContextualBanditSnapshotInterface> = {},
): ContextualBanditSnapshotInterface {
  return {
    id: "cbs_1",
    organization: "org_1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    contextualBandit: "cb_1",
    status: "running",
    runStarted: null,
    queries: [],
    triggeredBy: "manual",
    weightsWereUpdated: false,
    ...overrides,
  } as ContextualBanditSnapshotInterface;
}

function makeResult(
  overrides: Partial<ContextualBanditResult> = {},
): ContextualBanditResult {
  return {
    attributes: ["country", "device"],
    responses: [
      {
        context: { country: "US" },
        sampleSizePerVariation: [50, 50],
        sampleMeans: [0.1, 0.2],
        updatedWeights: [0.3, 0.7],
        bestArmProbabilities: [0.3, 0.7],
        updateMessage: "ok",
      },
      {
        context: { country: "CA" },
        sampleSizePerVariation: [30, 70],
        sampleMeans: [0.05, 0.07],
        updatedWeights: [0.55, 0.45],
        bestArmProbabilities: [0.55, 0.45],
        updateMessage: "ok",
      },
    ],
    leaf_map: [
      { context: { country: "US", device: "mobile" }, leafId: 0 },
      { context: { country: "CA", device: "desktop" }, leafId: 1 },
    ],
    ...overrides,
  };
}

describe("buildContextualBanditSnapshotSettings", () => {
  it("produces strict-valid settings with no `guardrailMetrics` even when the CB has them", () => {
    const cb = makeCb({ guardrailMetrics: ["met_guard"] });
    const eaq = makeExposureQuery();

    const settings = buildContextualBanditSnapshotSettings(cb, eaq, false);

    expect(settings).not.toHaveProperty("guardrailMetrics");
    expect(settings).not.toHaveProperty("activationMetric");
    expect(settings).not.toHaveProperty("phase");
    expect(settings.regressionAdjustmentEnabled).toBe(false);

    expect(() =>
      contextualBanditSnapshotSettingsValidator.parse(settings),
    ).not.toThrow();

    expect(settings.experimentId).toBe("cb_1");
    expect(settings.contextualBanditId).toBe("cb_1");
    expect(settings.banditWeightsSeed).toBe(0);
    expect(settings.goalMetrics).toEqual(["met_g1"]);
    expect(settings.secondaryMetrics).toEqual(["met_s1"]);
    expect(settings.variations).toEqual([
      { id: "v0", weight: 0.4 },
      { id: "v1", weight: 0.6 },
    ]);
    expect(settings.treeModel).toBe("regression_tree");
    expect(settings.contextualAttributes).toEqual(["country", "device"]);
  });

  it("stores trackingKey separately from experimentId for warehouse SQL", () => {
    const settings = buildContextualBanditSnapshotSettings(
      makeCb({ trackingKey: "first_contextual_bandit" }),
      makeExposureQuery(),
      false,
    );

    expect(settings.experimentId).toBe("cb_1");
    expect(settings.trackingKey).toBe("first_contextual_bandit");
  });

  it("maps trackingKey to SnapshotMetricRequest.experimentId for SQL", () => {
    const cbSettings = buildContextualBanditSnapshotSettings(
      makeCb({ trackingKey: "first_contextual_bandit" }),
      makeExposureQuery(),
      false,
    );

    expect(buildSnapshotMetricRequestForCb(cbSettings).experimentId).toBe(
      "first_contextual_bandit",
    );
  });

  it("falls back to CB.contextualAttributes when EAQ has no targeting columns", () => {
    const cb = makeCb({ contextualAttributes: ["plan_tier"] });
    const eaq = makeExposureQuery({ targetingAttributeColumns: undefined });

    const settings = buildContextualBanditSnapshotSettings(cb, eaq, false);

    expect(settings.contextualAttributes).toEqual(["plan_tier"]);
  });

  it("defaults variation weights to uniform when the CB has none set", () => {
    const cb = makeCb({
      variations: [
        { id: "v0", name: "Control", key: "0", screenshots: [] },
        { id: "v1", name: "T1", key: "1", screenshots: [] },
        { id: "v2", name: "T2", key: "2", screenshots: [] },
      ] as unknown as ContextualBanditInterface["variations"],
      variationWeights: undefined,
      currentLeafWeights: [],
    });

    const settings = buildContextualBanditSnapshotSettings(
      cb,
      makeExposureQuery(),
      false,
    );

    expect(settings.variations).toEqual([
      { id: "v0", weight: 1 / 3 },
      { id: "v1", weight: 1 / 3 },
      { id: "v2", weight: 1 / 3 },
    ]);
  });

  it("narrows unrecognised CB tree models to `regression_tree`", () => {
    const cb = makeCb({ treeModel: "some_legacy_value" });
    const settings = buildContextualBanditSnapshotSettings(
      cb,
      makeExposureQuery(),
      false,
    );
    expect(settings.treeModel).toBe("regression_tree");
  });

  it("threads CUPED into SQL settings without pooled theta", () => {
    const cbSettings = buildContextualBanditSnapshotSettings(
      makeCb({ regressionAdjustmentEnabled: true }),
      makeExposureQuery(),
      true,
    );

    expect(cbSettings.regressionAdjustmentEnabled).toBe(true);

    const expSettings = buildSnapshotMetricRequestForCb(cbSettings);
    expect(expSettings.regressionAdjustmentEnabled).toBe(true);
    expect(expSettings.banditSettings?.poolRegressionTheta).toBe(false);
  });
});

describe("persistContextualBanditEvent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPayloadKeysForContextualBanditMock.mockReturnValue([
      { project: "", environment: "production" },
    ]);
  });

  it("creates a CBE with N leaves and patches CB leaf weights to match", async () => {
    const cb = makeCb();
    const cbs = makeCbs();
    const result = makeResult();

    const createCbeMock = jest.fn().mockResolvedValue({
      id: "cbe_1",
      organization: "org_1",
      contextualBandit: cb.id,
      snapshotId: cbs.id,
      attributes: result.attributes,
      responses: result.responses,
      weightsWereUpdated: true,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    const patchLeafWeightsMock = jest.fn().mockResolvedValue(cb);
    const getByIdMock = jest.fn().mockResolvedValue(cb);

    const context = {
      org: { id: "org_1" },
      models: {
        contextualBandits: {
          getById: getByIdMock,
          patchLeafWeights: patchLeafWeightsMock,
        },
        contextualBanditEvents: {
          create: createCbeMock,
        },
      },
    } as unknown as ReqContext;

    const cbe = await persistContextualBanditEvent(context, cbs, result);

    expect(cbe.id).toBe("cbe_1");
    expect(getByIdMock).toHaveBeenCalledWith(cbs.contextualBandit);

    expect(createCbeMock).toHaveBeenCalledWith({
      contextualBandit: cb.id,
      snapshotId: cbs.id,
      attributes: result.attributes,
      responses: result.responses,
      leaf_map: result.leaf_map,
      weightsWereUpdated: true,
    });

    expect(patchLeafWeightsMock).toHaveBeenCalledTimes(1);
    const [cbIdArg, leafWeightsArg] = patchLeafWeightsMock.mock.calls[0];
    expect(cbIdArg).toBe(cb.id);
    expect(leafWeightsArg).toHaveLength(2);
    // deriveContextId is seeded by CB id, matching persistContextualBanditEvent.
    const expectedLeafWeights = leafWeightsFromContextualBanditResult(
      cb.id,
      result,
    );
    expect(leafWeightsArg).toEqual(expectedLeafWeights);
    expect(leafWeightsArg[0].contextId).toBe(
      deriveContextId(cb.id, { country: "US" }),
    );

    expect(queueSDKPayloadRefreshMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context,
        auditContext: expect.objectContaining({
          event: "contextualBandit.refresh",
          model: "contextualBandit",
          id: cb.id,
        }),
      }),
    );
  });

  it("throws when the CB doc is missing", async () => {
    const context = {
      org: { id: "org_1" },
      models: {
        contextualBandits: {
          getById: jest.fn().mockResolvedValue(null),
          patchLeafWeights: jest.fn(),
        },
        contextualBanditEvents: { create: jest.fn() },
      },
    } as unknown as ReqContext;

    await expect(
      persistContextualBanditEvent(context, makeCbs(), makeResult()),
    ).rejects.toThrow(/No CB doc/);
  });

  it("skips the SDK payload refresh when there are no payload keys", async () => {
    getPayloadKeysForContextualBanditMock.mockReturnValueOnce([]);
    const cb = makeCb();
    const context = {
      org: { id: "org_1" },
      models: {
        contextualBandits: {
          getById: jest.fn().mockResolvedValue(cb),
          patchLeafWeights: jest.fn().mockResolvedValue(cb),
        },
        contextualBanditEvents: {
          create: jest.fn().mockResolvedValue({
            id: "cbe_1",
            organization: "org_1",
            contextualBandit: cb.id,
            snapshotId: "cbs_1",
            attributes: [],
            responses: [],
            weightsWereUpdated: false,
            dateCreated: new Date(),
            dateUpdated: new Date(),
          }),
        },
      },
    } as unknown as ReqContext;

    await persistContextualBanditEvent(context, makeCbs(), makeResult());

    expect(queueSDKPayloadRefreshMock).not.toHaveBeenCalled();
  });
});

describe("getContextualBanditResultsForUi", () => {
  it("returns latest CBE payload and CBS status summary", async () => {
    const cb = makeCb();
    const cbs = {
      id: "cbs_1",
      status: "running",
      error: "",
      queries: [
        { name: "contextual-bandit-rows", query: "q_1", status: "running" },
      ],
      runStarted: new Date("2025-01-03T00:00:00Z"),
      dateCreated: new Date("2025-01-03T00:00:00Z"),
      triggeredBy: "manual",
    } as ContextualBanditSnapshotInterface;
    const cbe = {
      id: "cbe_1",
      attributes: ["country"],
      responses: [
        {
          context: { country: "US" },
          updatedWeights: [0.4, 0.6],
        },
      ],
      leaf_map: [{ context: { country: "US" }, leafId: 0 }],
    };

    const context = {
      models: {
        contextualBanditSnapshots: {
          getLatestForContextualBandit: jest.fn().mockResolvedValue(cbs),
        },
        contextualBanditEvents: {
          getLatestForContextualBandit: jest.fn().mockResolvedValue(cbe),
        },
      },
    } as unknown as ReqContext;

    const results = await getContextualBanditResultsForUi(context, cb);

    expect(results.contextualBanditSnapshot).toEqual({
      attributes: ["country"],
      responses: cbe.responses,
      leaf_map: cbe.leaf_map,
    });
    expect(results.latest).toEqual(
      toContextualBanditSnapshotStatusSummary(cbs),
    );
  });
});
