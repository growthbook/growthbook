import { ExposureQuery } from "shared/types/datasource";
import {
  ContextualBanditInterface,
  ContextualBanditSnapshotInterface,
  contextualBanditSnapshotSettingsValidator,
} from "shared/validators";
import { ApiReqContext, ReqContext } from "back-end/types/api";
import {
  buildContextualBanditSnapshotSettings,
  buildSnapshotSettingsForCb,
  contextualBanditWeightsWereUpdated,
  getContextualBanditResultsForUi,
  leafWeightsFromContextualBanditResult,
  persistContextualBanditEvent,
  runContextualBanditSnapshot,
  toContextualBanditSnapshotStatusSummary,
} from "back-end/src/enterprise/services/contextualBandits";
import { refreshLinkedFeaturePayloads } from "back-end/src/services/contextualBanditChanges";
import { ContextualBanditResult } from "back-end/src/enterprise/services/contextualBanditStats";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { ContextualBanditResultsQueryRunner } from "back-end/src/enterprise/queryRunners/ContextualBanditResultsQueryRunner";

jest.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: jest.fn(),
}));

jest.mock("back-end/src/services/contextualBanditChanges", () => ({
  refreshLinkedFeaturePayloads: jest.fn().mockResolvedValue(undefined),
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
const getDataSourceByIdMock = getDataSourceById as jest.MockedFunction<
  typeof getDataSourceById
>;
const getSourceIntegrationObjectMock =
  getSourceIntegrationObject as jest.MockedFunction<
    typeof getSourceIntegrationObject
  >;
const ContextualBanditResultsQueryRunnerMock =
  ContextualBanditResultsQueryRunner as unknown as jest.Mock;

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
    contextualAttributes: ["country", "device"],
    minUsersPerLeaf: 100,
    maxLeaves: 8,
    holdoutPercent: 0,
    banditModelVersion: 1,
    decisionMetric: "met_g1",
    variations: [
      { id: "v0", name: "Control", key: "0", screenshots: [] },
      { id: "v1", name: "Treatment", key: "1", screenshots: [] },
    ],
    dateStarted: new Date("2025-01-02T00:00:00Z"),
    stage: "exploit",
    stageDateStarted: new Date("2025-01-02T00:00:00Z"),
    scheduleValue: 1,
    scheduleUnit: "days",
    burnInValue: 1,
    burnInUnit: "days",
    variationWeights: [
      { variationId: "v0", weight: 0.4 },
      { variationId: "v1", weight: 0.6 },
    ],
    currentLeafWeights: [
      {
        leafId: 0,
        condition: { country: "US", device: "mobile" },
        weights: [
          { variationId: "v0", weight: 0.5 },
          { variationId: "v1", weight: 0.5 },
        ],
      },
    ],
    banditVersion: 0,
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
        leafId: 0,
        sampleSizePerVariation: [50, 50],
        sampleMeans: [0.1, 0.2],
        updatedWeights: [0.3, 0.7],
        bestArmProbabilities: [0.3, 0.7],
        updateMessage: "ok",
      },
      {
        context: { country: "CA" },
        leafId: 1,
        sampleSizePerVariation: [30, 70],
        sampleMeans: [0.05, 0.07],
        updatedWeights: [0.55, 0.45],
        bestArmProbabilities: [0.55, 0.45],
        updateMessage: "ok",
      },
    ],
    leaf_map: [
      {
        leafId: 0,
        context: [
          { attribute: "country", levels: ["US"], operator: "in" },
          { attribute: "device", levels: ["mobile"], operator: "in" },
        ],
      },
      {
        leafId: 1,
        context: [
          { attribute: "country", levels: ["CA"], operator: "in" },
          { attribute: "device", levels: ["desktop"], operator: "in" },
        ],
      },
    ],
    ...overrides,
  };
}

describe("buildContextualBanditSnapshotSettings", () => {
  it("produces strict-valid settings", () => {
    const cb = makeCb();
    const eaq = makeExposureQuery();

    const settings = buildContextualBanditSnapshotSettings(cb, eaq);

    expect(settings).not.toHaveProperty("activationMetric");
    expect(settings).not.toHaveProperty("phase");

    expect(() =>
      contextualBanditSnapshotSettingsValidator.parse(settings),
    ).not.toThrow();

    expect(settings.experimentId).toBe("cb_1");
    expect(settings.contextualBanditId).toBe("cb_1");
    expect(settings.banditWeightsSeed).toBe(0);
    expect(settings.decisionMetric).toEqual("met_g1");
    expect(settings.variations).toEqual([
      { id: "v0", weight: 0.4 },
      { id: "v1", weight: 0.6 },
    ]);
    expect(settings.contextualAttributes).toEqual(["country", "device"]);
  });

  it("stores trackingKey separately from experimentId for warehouse SQL", () => {
    const settings = buildContextualBanditSnapshotSettings(
      makeCb({ trackingKey: "first_contextual_bandit" }),
      makeExposureQuery(),
    );

    expect(settings.experimentId).toBe("cb_1");
    expect(settings.trackingKey).toBe("first_contextual_bandit");
  });

  it("maps trackingKey to ExperimentSnapshotSettings.experimentId for SQL", () => {
    const cbSettings = buildContextualBanditSnapshotSettings(
      makeCb({ trackingKey: "first_contextual_bandit" }),
      makeExposureQuery(),
    );

    expect(buildSnapshotSettingsForCb(cbSettings).experimentId).toBe(
      "first_contextual_bandit",
    );
  });

  it("falls back to CB.contextualAttributes when EAQ has no targeting columns", () => {
    const cb = makeCb({ contextualAttributes: ["plan_tier"] });
    const eaq = makeExposureQuery({ targetingAttributeColumns: undefined });

    const settings = buildContextualBanditSnapshotSettings(cb, eaq);

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
    );

    expect(settings.variations).toEqual([
      { id: "v0", weight: 1 / 3 },
      { id: "v1", weight: 1 / 3 },
      { id: "v2", weight: 1 / 3 },
    ]);
  });
});

describe("runContextualBanditSnapshot", () => {
  const startAnalysisMock = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    startAnalysisMock.mockResolvedValue(undefined);
    getDataSourceByIdMock.mockResolvedValue({
      id: "ds_1",
    } as unknown as Awaited<ReturnType<typeof getDataSourceById>>);
    getSourceIntegrationObjectMock.mockReturnValue(
      {} as unknown as ReturnType<typeof getSourceIntegrationObject>,
    );
    ContextualBanditResultsQueryRunnerMock.mockImplementation(() => ({
      startAnalysis: startAnalysisMock,
    }));
  });

  function makeContext(
    overrides: Partial<{
      update: jest.Mock;
      cbeSnapshotId: string;
    }> = {},
  ) {
    const updateMock =
      overrides.update ?? jest.fn().mockImplementation((cb) => cb);
    return {
      hasPremiumFeature: jest.fn().mockReturnValue(true),
      models: {
        contextualBandits: { update: updateMock },
        contextualBanditQueries: {
          getById: jest.fn().mockResolvedValue({
            id: "cbq_1",
            query: "SELECT 1",
            userIdType: "user_id",
            targetingAttributeColumns: ["country"],
          }),
        },
        contextualBanditSnapshots: {
          create: jest
            .fn()
            .mockResolvedValue({ id: overrides.cbeSnapshotId ?? "cbs_1" }),
        },
      },
    } as unknown as ApiReqContext;
  }

  it("resolves the explore -> exploit stage transition before starting the run", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2025-01-03T01:00:00Z"));
    try {
      // Burn-in (1 day from stageDateStarted) has already elapsed, but the CB
      // doc still says "explore" since nothing has re-derived it yet.
      const cb = makeCb({
        stage: "explore",
        stageDateStarted: new Date("2025-01-02T00:00:00Z"),
        burnInValue: 1,
        burnInUnit: "days",
      });
      const updateMock = jest.fn().mockImplementation((existing, changes) => ({
        ...existing,
        ...changes,
      }));
      const context = makeContext({ update: updateMock });

      const result = await runContextualBanditSnapshot(context, cb, {
        triggeredBy: "manual",
      });

      expect(updateMock).toHaveBeenCalledWith(
        cb,
        expect.objectContaining({ stage: "exploit" }),
      );
      // The stage/schedule update is persisted before the run kicks off, so
      // persistContextualBanditEvent (called later, possibly async) sees the
      // correct stage without having to recompute it.
      expect(updateMock.mock.invocationCallOrder[0]).toBeLessThan(
        startAnalysisMock.mock.invocationCallOrder[0],
      );
      expect(result.snapshotId).toBe("cbs_1");
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("persistContextualBanditEvent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    refreshLinkedFeaturePayloadsMock.mockResolvedValue(undefined);
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
          update: jest.fn().mockResolvedValue(cb),
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
    const [cbIdArg, leafWeightsArg, patchOptions] =
      patchLeafWeightsMock.mock.calls[0];
    expect(cbIdArg).toBe(cb.id);
    expect(leafWeightsArg).toHaveLength(2);
    // Weights changed → the version bumps alongside the payload refresh
    expect(patchOptions).toEqual({ bumpVersion: true });
    const expectedLeafWeights = leafWeightsFromContextualBanditResult(
      result,
      cb.variations,
    );
    expect(leafWeightsArg).toEqual(expectedLeafWeights);
    expect(leafWeightsArg[0].leafId).toBe(0);
    expect(leafWeightsArg[0].condition).toEqual({
      country: "US",
      device: "mobile",
    });

    expect(refreshLinkedFeaturePayloadsMock).toHaveBeenCalledWith(
      context,
      cb,
      "contextualBandit.refresh",
    );
  });

  it("patches without bumping banditVersion on a no-weight run", async () => {
    const cb = makeCb();
    const cbs = makeCbs();
    const result = makeResult({ responses: [], leaf_map: [] });

    const createCbeMock = jest.fn().mockResolvedValue({
      id: "cbe_empty",
      organization: "org_1",
      contextualBandit: cb.id,
      snapshotId: cbs.id,
      attributes: result.attributes,
      responses: [],
      weightsWereUpdated: false,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    const patchLeafWeightsMock = jest.fn().mockResolvedValue(cb);

    const context = {
      org: { id: "org_1" },
      models: {
        contextualBandits: {
          getById: jest.fn().mockResolvedValue(cb),
          patchLeafWeights: patchLeafWeightsMock,
          update: jest.fn().mockResolvedValue(cb),
        },
        contextualBanditEvents: {
          create: createCbeMock,
        },
      },
    } as unknown as ReqContext;

    await persistContextualBanditEvent(context, cbs, result);

    expect(patchLeafWeightsMock).toHaveBeenCalledTimes(1);
    const [cbIdArg, leafWeightsArg, patchOptions] =
      patchLeafWeightsMock.mock.calls[0];
    expect(cbIdArg).toBe(cb.id);
    expect(leafWeightsArg).toEqual([]);
    // No weight change → no version bump and no SDK payload refresh, so the
    // payload's banditVersion stays consistent with the DB.
    expect(patchOptions).toEqual({ bumpVersion: false });
    expect(refreshLinkedFeaturePayloadsMock).not.toHaveBeenCalled();
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

  it("trusts the CB's persisted stage rather than recomputing it", async () => {
    // Stage/schedule resolution now happens up front in
    // runContextualBanditSnapshot, so persistContextualBanditEvent should
    // just read whatever stage is already on the CB doc.
    const cb = makeCb({ stage: "explore", currentLeafWeights: [] });
    const cbs = makeCbs();
    const result = makeResult();

    const patchLeafWeightsMock = jest.fn().mockResolvedValue(cb);
    const createCbeMock = jest.fn().mockResolvedValue({
      id: "cbe_1",
      organization: "org_1",
      contextualBandit: cb.id,
      snapshotId: cbs.id,
      attributes: result.attributes,
      responses: result.responses,
      weightsWereUpdated: false,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });

    const updateMock = jest.fn();
    const context = {
      org: { id: "org_1" },
      models: {
        contextualBandits: {
          getById: jest.fn().mockResolvedValue(cb),
          patchLeafWeights: patchLeafWeightsMock,
          update: updateMock,
        },
        contextualBanditEvents: {
          create: createCbeMock,
        },
      },
    } as unknown as ReqContext;

    await persistContextualBanditEvent(context, cbs, result);

    // Still "explore" per the CB doc, so weights are discarded for this run...
    const [, leafWeightsArg] = patchLeafWeightsMock.mock.calls[0];
    expect(leafWeightsArg).toEqual([]);
    expect(createCbeMock).toHaveBeenCalledWith(
      expect.objectContaining({ weightsWereUpdated: false }),
    );
    // ...persistContextualBanditEvent no longer touches the schedule itself...
    expect(updateMock).not.toHaveBeenCalled();
    // ...and explore-stage runs never queue an SDK payload refresh.
    expect(refreshLinkedFeaturePayloadsMock).not.toHaveBeenCalled();
  });

  it("skips the SDK payload refresh when the new weights match the current ones", async () => {
    const result = makeResult();
    const cb = makeCb();
    // Pre-seed the CB doc with exactly the leaf weights this run will produce
    // so weightsWereUpdated computes to false.
    cb.currentLeafWeights = leafWeightsFromContextualBanditResult(
      result,
      cb.variations,
    );
    const patchLeafWeightsMock = jest.fn().mockResolvedValue(cb);
    const context = {
      org: { id: "org_1" },
      models: {
        contextualBandits: {
          getById: jest.fn().mockResolvedValue(cb),
          patchLeafWeights: patchLeafWeightsMock,
          update: jest.fn().mockResolvedValue(cb),
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

    await persistContextualBanditEvent(context, makeCbs(), result);

    expect(patchLeafWeightsMock).toHaveBeenCalledTimes(1);
    expect(patchLeafWeightsMock.mock.calls[0][2]).toEqual({
      bumpVersion: false,
    });
    expect(refreshLinkedFeaturePayloadsMock).not.toHaveBeenCalled();
  });
});

describe("contextualBanditWeightsWereUpdated", () => {
  const variations = [{ id: "v0" }, { id: "v1" }];

  /** Persisted leaf weights matching what makeResult() produces. */
  function currentFromResult() {
    return leafWeightsFromContextualBanditResult(makeResult(), variations);
  }

  it("returns false when leaves, ids, and weights are unchanged", () => {
    expect(
      contextualBanditWeightsWereUpdated(
        makeResult(),
        currentFromResult(),
        variations,
      ),
    ).toBe(false);
  });

  it("returns true when a leaf's weights change", () => {
    const result = makeResult();
    result.responses[0].updatedWeights = [0.9, 0.1];
    expect(
      contextualBanditWeightsWereUpdated(
        result,
        currentFromResult(),
        variations,
      ),
    ).toBe(true);
  });

  it("returns true when a leaf is added", () => {
    const result = makeResult();
    result.responses.push({
      context: { country: "MX" },
      leafId: 2,
      sampleSizePerVariation: [10, 10],
      sampleMeans: [0.1, 0.1],
      updatedWeights: [0.5, 0.5],
      bestArmProbabilities: [0.5, 0.5],
      updateMessage: "ok",
    });
    result.leaf_map.push({
      leafId: 2,
      context: [
        { attribute: "country", levels: ["MX"], operator: "in" },
        { attribute: "device", levels: ["desktop"], operator: "in" },
      ],
    });
    expect(
      contextualBanditWeightsWereUpdated(
        result,
        currentFromResult(),
        variations,
      ),
    ).toBe(true);
  });

  it("returns true when a leaf is removed (persisted set shrinks)", () => {
    const result = makeResult();
    // Drop the CA leaf; the US leaf's condition and weights are unchanged.
    result.responses = [result.responses[0]];
    result.leaf_map = [result.leaf_map[0]];
    expect(
      contextualBanditWeightsWereUpdated(
        result,
        currentFromResult(),
        variations,
      ),
    ).toBe(true);
  });

  it("returns true when a leafId is renumbered for an unchanged condition", () => {
    const result = makeResult();
    // Same conditions and weights, but the tree relabeled the leaves.
    result.responses[0].leafId = 5;
    result.responses[1].leafId = 6;
    result.leaf_map = [
      {
        leafId: 5,
        context: [
          { attribute: "country", levels: ["US"], operator: "in" },
          { attribute: "device", levels: ["mobile"], operator: "in" },
        ],
      },
      {
        leafId: 6,
        context: [
          { attribute: "country", levels: ["CA"], operator: "in" },
          { attribute: "device", levels: ["desktop"], operator: "in" },
        ],
      },
    ];
    expect(
      contextualBanditWeightsWereUpdated(
        result,
        currentFromResult(),
        variations,
      ),
    ).toBe(true);
  });

  it("returns false for a no-weight run (patchLeafWeights keeps the persisted set)", () => {
    const result = makeResult({ responses: [], leaf_map: [] });
    expect(
      contextualBanditWeightsWereUpdated(
        result,
        currentFromResult(),
        variations,
      ),
    ).toBe(false);
  });
});

describe("persistContextualBanditEvent — P3 stale-epoch guard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPayloadKeysForContextualBanditMock.mockReturnValue([
      { project: "", environment: "production" },
    ]);
  });

  function makeGuardContext(cb: ContextualBanditInterface) {
    const patchLeafWeightsMock = jest.fn().mockResolvedValue(cb);
    const createCbeMock = jest.fn().mockImplementation((doc) =>
      Promise.resolve({
        id: "cbe_x",
        organization: "org_1",
        ...doc,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      }),
    );
    const warnMock = jest.fn();
    const context = {
      org: { id: "org_1" },
      logger: { warn: warnMock },
      models: {
        contextualBandits: {
          getById: jest.fn().mockResolvedValue(cb),
          patchLeafWeights: patchLeafWeightsMock,
          update: jest.fn(),
        },
        contextualBanditEvents: { create: createCbeMock },
      },
    } as unknown as ReqContext;
    return { context, patchLeafWeightsMock, createCbeMock, warnMock };
  }

  it("discards this run's weights when banditVersion changed mid-run", async () => {
    const cb = makeCb({ stage: "exploit", banditVersion: 5 });
    const cbs = makeCbs({ banditVersion: 3 });
    const { context, patchLeafWeightsMock, createCbeMock, warnMock } =
      makeGuardContext(cb);

    await persistContextualBanditEvent(context, cbs, makeResult());

    // Weights discarded: empty leaf-weight patch, CBE flagged not-updated,
    // and a warning logged.
    expect(patchLeafWeightsMock.mock.calls[0][1]).toEqual([]);
    expect(createCbeMock).toHaveBeenCalledWith(
      expect.objectContaining({ weightsWereUpdated: false }),
    );
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it("persists weights when the run's banditVersion still matches the live CB", async () => {
    const cb = makeCb({ stage: "exploit", banditVersion: 5 });
    const cbs = makeCbs({ banditVersion: 5 });
    const { context, patchLeafWeightsMock, warnMock } = makeGuardContext(cb);

    await persistContextualBanditEvent(context, cbs, makeResult());

    expect(patchLeafWeightsMock.mock.calls[0][1].length).toBeGreaterThan(0);
    expect(warnMock).not.toHaveBeenCalled();
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
          leafId: 0,
          updatedWeights: [0.4, 0.6],
        },
      ],
      leaf_map: [
        {
          leafId: 0,
          context: [{ attribute: "country", levels: ["US"], operator: "in" }],
        },
      ],
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
    expect(results.latestSnapshotSummary).toEqual(
      toContextualBanditSnapshotStatusSummary(cbs),
    );
  });
});
