import { ExposureQuery } from "shared/types/datasource";
import type { SDKAttributeSchema } from "shared/types/organization";
import {
  ContextualBanditInterface,
  ContextualBanditSnapshotInterface,
  contextualBanditSnapshotSettingsValidator,
} from "shared/validators";

const schema = (...properties: string[]): SDKAttributeSchema =>
  properties.map((property) => ({ property })) as SDKAttributeSchema;
import { ApiReqContext, ReqContext } from "back-end/types/api";
import {
  buildContextualBanditSnapshotSettings,
  buildSnapshotSettingsForCb,
  contextualBanditWeightsWereUpdated,
  getContextualBanditResultsForUi,
  getContextualBanditStatusForUi,
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
import { CasConflictError } from "back-end/src/models/BaseModel";

jest.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: jest.fn(),
}));

jest.mock("back-end/src/services/contextualBanditChanges", () => ({
  refreshLinkedFeaturePayloads: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("back-end/src/services/contextualBanditVisualState", () => ({
  onContextualBanditVisualStateChanged: jest.fn(async (context, cb) => {
    const { refreshLinkedFeaturePayloads } = jest.requireMock(
      "back-end/src/services/contextualBanditChanges",
    );
    await refreshLinkedFeaturePayloads(context, cb, "contextualBandit.refresh");
    return cb;
  }),
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

// Minimal frozenSettings carrying just the variation ids the results view needs.
function frozenVariations(
  ids: string[],
): ContextualBanditSnapshotInterface["frozenSettings"] {
  return {
    variations: ids.map((id) => ({ id, weight: 1 / ids.length })),
  } as ContextualBanditSnapshotInterface["frozenSettings"];
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

    const settings = buildContextualBanditSnapshotSettings(
      cb,
      eaq,
      schema("country", "device"),
    );

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
      schema("country", "device"),
    );

    expect(settings.experimentId).toBe("cb_1");
    expect(settings.trackingKey).toBe("first_contextual_bandit");
  });

  it("maps trackingKey to ExperimentSnapshotSettings.experimentId for SQL", () => {
    const cbSettings = buildContextualBanditSnapshotSettings(
      makeCb({ trackingKey: "first_contextual_bandit" }),
      makeExposureQuery(),
      schema("country", "device"),
    );

    expect(buildSnapshotSettingsForCb(cbSettings).experimentId).toBe(
      "first_contextual_bandit",
    );
  });

  it("intersects CB, query, and global attributes and preserves query order", () => {
    const cb = makeCb({ contextualAttributes: ["device", "country"] });
    const eaq = makeExposureQuery({
      targetingAttributeColumns: ["country", "device", "plan_tier"],
    });

    const settings = buildContextualBanditSnapshotSettings(
      cb,
      eaq,
      schema("country", "device", "plan_tier"),
    );

    expect(settings.contextualAttributes).toEqual(["country", "device"]);
  });

  it("drops an attribute the query no longer exposes", () => {
    const cb = makeCb({ contextualAttributes: ["country", "device"] });
    const eaq = makeExposureQuery({ targetingAttributeColumns: ["country"] });

    const settings = buildContextualBanditSnapshotSettings(
      cb,
      eaq,
      schema("country", "device"),
    );

    expect(settings.contextualAttributes).toEqual(["country"]);
  });

  it("drops an attribute removed from the global attribute schema", () => {
    const cb = makeCb({ contextualAttributes: ["country", "device"] });
    const eaq = makeExposureQuery({
      targetingAttributeColumns: ["country", "device"],
    });

    const settings = buildContextualBanditSnapshotSettings(
      cb,
      eaq,
      schema("country"),
    );

    expect(settings.contextualAttributes).toEqual(["country"]);
  });

  it("does not include a query attribute the CB did not select", () => {
    const cb = makeCb({ contextualAttributes: ["country"] });
    const eaq = makeExposureQuery({
      targetingAttributeColumns: ["country", "device"],
    });

    const settings = buildContextualBanditSnapshotSettings(
      cb,
      eaq,
      schema("country", "device"),
    );

    expect(settings.contextualAttributes).toEqual(["country"]);
  });

  it("throws when the intersection is empty", () => {
    const cb = makeCb({ contextualAttributes: ["country"] });
    const eaq = makeExposureQuery({ targetingAttributeColumns: ["device"] });

    expect(() =>
      buildContextualBanditSnapshotSettings(
        cb,
        eaq,
        schema("country", "device"),
      ),
    ).toThrow(/no usable contextual attributes/);
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
      schema("country", "device"),
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
      auditLog: jest.fn().mockResolvedValue(undefined),
      logger: { error: jest.fn() },
      org: {
        settings: {
          attributeSchema: [{ property: "country" }, { property: "device" }],
        },
      },
      models: {
        contextualBandits: { dangerousUpdateBypassPermission: updateMock },
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
          getLatestForContextualBandit: jest.fn().mockResolvedValue(null),
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
    const applyWeightEpochUpdateMock = jest.fn().mockResolvedValue(cb);
    const getByIdMock = jest.fn().mockResolvedValue(cb);

    const context = {
      org: { id: "org_1" },
      models: {
        contextualBandits: {
          getById: getByIdMock,
          applyWeightEpochUpdate: applyWeightEpochUpdateMock,
          update: jest.fn().mockResolvedValue(cb),
        },
        contextualBanditEvents: {
          getBySnapshotId: jest.fn().mockResolvedValue(null),
          create: createCbeMock,
        },
      },
      auditLog: jest.fn().mockResolvedValue(undefined),
      logger: { error: jest.fn() },
    } as unknown as ReqContext;

    const cbe = await persistContextualBanditEvent(context, cbs, result);

    expect(cbe.id).toBe("cbe_1");
    expect(getByIdMock).toHaveBeenCalledWith(cbs.contextualBandit);

    expect(createCbeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contextualBandit: cb.id,
        snapshotId: cbs.id,
        attributes: result.attributes,
        responses: result.responses,
        leaf_map: result.leaf_map,
        weightsWereUpdated: true,
        // The run's frozen variation ids are stored on the event so the
        // decision-results view can label responses even if the snapshot is gone.
        frozenVariationIds: ["v0", "v1"],
        // New seed is generated when weights are updated
        seed: expect.any(String),
      }),
    );

    expect(applyWeightEpochUpdateMock).toHaveBeenCalledTimes(1);
    const [cbIdArg, changes] = applyWeightEpochUpdateMock.mock.calls[0];
    expect(cbIdArg).toBe(cb.id);
    expect(changes.currentLeafWeights).toHaveLength(2);
    expect(changes.bumpVersion).toBe(true);
    expect(changes.expectedBanditVersion).toBe(cb.banditVersion);
    expect(changes.newSeed).toEqual(expect.any(String));
    const expectedLeafWeights = leafWeightsFromContextualBanditResult(
      result,
      cb.variations,
    );
    expect(changes.currentLeafWeights).toEqual(expectedLeafWeights);
    expect(changes.currentLeafWeights[0].leafId).toBe(0);
    expect(changes.currentLeafWeights[0].condition).toEqual({
      country: "US",
      device: "mobile",
    });

    expect(refreshLinkedFeaturePayloadsMock).toHaveBeenCalledWith(
      context,
      cb,
      "contextualBandit.refresh",
    );
  });

  it("reuses an existing event (no duplicate) but resumes the unfinished weight update when a prior attempt never applied the weights", async () => {
    // The event was created on a prior attempt, but the weight update failed before
    // committing — so the live CB still sits at the run's banditVersion (never bumped).
    const cb = makeCb({ stage: "exploit", banditVersion: 2 });
    const cbs = makeCbs({ banditVersion: 2 });
    const result = makeResult();

    const existingEvent = {
      id: "cbe_existing",
      organization: "org_1",
      contextualBandit: cb.id,
      snapshotId: cbs.id,
      attributes: result.attributes,
      responses: result.responses,
      leaf_map: result.leaf_map,
      weightsWereUpdated: true,
      seed: "seed_existing",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };

    const createCbeMock = jest.fn();
    const applyWeightEpochUpdateMock = jest.fn().mockResolvedValue(cb);
    const getBySnapshotIdMock = jest.fn().mockResolvedValue(existingEvent);

    const context = {
      org: { id: "org_1" },
      logger: { warn: jest.fn(), error: jest.fn() },
      auditLog: jest.fn().mockResolvedValue(undefined),
      models: {
        contextualBandits: {
          getById: jest.fn().mockResolvedValue(cb),
          applyWeightEpochUpdate: applyWeightEpochUpdateMock,
          update: jest.fn().mockResolvedValue(cb),
        },
        contextualBanditEvents: {
          getBySnapshotId: getBySnapshotIdMock,
          create: createCbeMock,
        },
      },
    } as unknown as ReqContext;

    const cbe = await persistContextualBanditEvent(context, cbs, result);

    expect(getBySnapshotIdMock).toHaveBeenCalledWith(cbs.id);
    // No duplicate event: the persisted one is reused.
    expect(cbe).toBe(existingEvent);
    expect(createCbeMock).not.toHaveBeenCalled();
    // ...but the unfinished work is completed: weights are (re)applied, reusing the
    // seed the event already recorded, and the SDK payload is refreshed.
    expect(applyWeightEpochUpdateMock).toHaveBeenCalledTimes(1);
    expect(applyWeightEpochUpdateMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ newSeed: "seed_existing", bumpVersion: true }),
    );
    expect(refreshLinkedFeaturePayloadsMock).toHaveBeenCalled();
  });

  it("serves the saved event's weights on resume, not the freshly re-run result's", async () => {
    // The event persisted on a prior attempt, but the weight write failed, so the
    // live CB still sits at the run's banditVersion. A resume re-runs analysis,
    // which is non-deterministic for high-cardinality attributes (unseeded split
    // search) and can produce different leaf conditions/weights. The served
    // weights must match what the event recorded, not the divergent re-run.
    const cb = makeCb({ stage: "exploit", banditVersion: 2 });
    const cbs = makeCbs({ banditVersion: 2 });

    // What the event recorded on the original attempt.
    const eventResult = makeResult({
      responses: [
        {
          context: { country: "US" },
          leafId: 0,
          updatedWeights: [0.3, 0.7],
          updateMessage: "ok",
        },
      ],
      leaf_map: [
        {
          leafId: 0,
          context: [{ attribute: "country", levels: ["US"], operator: "in" }],
        },
      ],
    });
    // A fresh re-run yields different leaf conditions and weights.
    const rerunResult = makeResult({
      responses: [
        {
          context: { country: "CA" },
          leafId: 0,
          updatedWeights: [0.9, 0.1],
          updateMessage: "ok",
        },
      ],
      leaf_map: [
        {
          leafId: 0,
          context: [{ attribute: "country", levels: ["CA"], operator: "in" }],
        },
      ],
    });

    const existingEvent = {
      id: "cbe_existing",
      organization: "org_1",
      contextualBandit: cb.id,
      snapshotId: cbs.id,
      attributes: eventResult.attributes,
      responses: eventResult.responses,
      leaf_map: eventResult.leaf_map,
      weightsWereUpdated: true,
      seed: "seed_existing",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };

    const applyWeightEpochUpdateMock = jest.fn().mockResolvedValue(cb);

    const context = {
      org: { id: "org_1" },
      logger: { warn: jest.fn(), error: jest.fn() },
      auditLog: jest.fn().mockResolvedValue(undefined),
      models: {
        contextualBandits: {
          getById: jest.fn().mockResolvedValue(cb),
          applyWeightEpochUpdate: applyWeightEpochUpdateMock,
          update: jest.fn().mockResolvedValue(cb),
        },
        contextualBanditEvents: {
          getBySnapshotId: jest.fn().mockResolvedValue(existingEvent),
          create: jest.fn(),
        },
      },
    } as unknown as ReqContext;

    await persistContextualBanditEvent(context, cbs, rerunResult);

    expect(applyWeightEpochUpdateMock).toHaveBeenCalledTimes(1);
    const appliedWeights =
      applyWeightEpochUpdateMock.mock.calls[0][1].currentLeafWeights;
    // Weights match the event...
    expect(appliedWeights).toEqual(
      leafWeightsFromContextualBanditResult(eventResult, cb.variations),
    );
    expect(appliedWeights[0].condition).toEqual({ country: "US" });
    // ...and NOT the divergent re-run result.
    expect(appliedWeights).not.toEqual(
      leafWeightsFromContextualBanditResult(rerunResult, cb.variations),
    );
  });

  it("does not re-apply weights on resume once a prior attempt already applied them (version bumped), but still retries the payload refresh", async () => {
    // A prior attempt applied the weights (bumping banditVersion past the run's) and
    // then failed on the payload refresh; the resume must not double-apply.
    const cb = makeCb({ stage: "exploit", banditVersion: 3 });
    const cbs = makeCbs({ banditVersion: 2 });
    const result = makeResult();

    const existingEvent = {
      id: "cbe_existing",
      organization: "org_1",
      contextualBandit: cb.id,
      snapshotId: cbs.id,
      attributes: result.attributes,
      responses: result.responses,
      weightsWereUpdated: true,
      seed: "seed_existing",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };

    const createCbeMock = jest.fn();
    const applyWeightEpochUpdateMock = jest.fn().mockResolvedValue(cb);

    const context = {
      org: { id: "org_1" },
      logger: { warn: jest.fn(), error: jest.fn() },
      auditLog: jest.fn().mockResolvedValue(undefined),
      models: {
        contextualBandits: {
          getById: jest.fn().mockResolvedValue(cb),
          applyWeightEpochUpdate: applyWeightEpochUpdateMock,
          update: jest.fn().mockResolvedValue(cb),
        },
        contextualBanditEvents: {
          getBySnapshotId: jest.fn().mockResolvedValue(existingEvent),
          create: createCbeMock,
        },
      },
    } as unknown as ReqContext;

    const cbe = await persistContextualBanditEvent(context, cbs, result);

    expect(cbe).toBe(existingEvent);
    expect(createCbeMock).not.toHaveBeenCalled();
    // Weights already applied (stale epoch) → not reapplied, but the payload refresh
    // is retried so a prior refresh failure is recovered.
    expect(applyWeightEpochUpdateMock).not.toHaveBeenCalled();
    expect(refreshLinkedFeaturePayloadsMock).toHaveBeenCalled();
  });

  it("does not apply weights on resume when the original run discarded them, even after the stage advances to exploit", async () => {
    // The original attempt ran in `explore` and recorded weightsWereUpdated:false
    // (weights discarded, never applied, so banditVersion never bumped). Its
    // snapshot write failed, and a later refresh advanced the CB to `exploit`.
    // The resume must honor the event's recorded decision and leave serving
    // weights untouched — not silently re-apply them off today's stage.
    const cb = makeCb({ stage: "exploit", banditVersion: 2 });
    const cbs = makeCbs({ banditVersion: 2 });
    const result = makeResult();

    const existingEvent = {
      id: "cbe_existing",
      organization: "org_1",
      contextualBandit: cb.id,
      snapshotId: cbs.id,
      attributes: result.attributes,
      responses: result.responses,
      leaf_map: result.leaf_map,
      weightsWereUpdated: false,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };

    const createCbeMock = jest.fn();
    const applyWeightEpochUpdateMock = jest.fn().mockResolvedValue(cb);

    const context = {
      org: { id: "org_1" },
      logger: { warn: jest.fn(), error: jest.fn() },
      auditLog: jest.fn().mockResolvedValue(undefined),
      models: {
        contextualBandits: {
          getById: jest.fn().mockResolvedValue(cb),
          applyWeightEpochUpdate: applyWeightEpochUpdateMock,
          update: jest.fn().mockResolvedValue(cb),
        },
        contextualBanditEvents: {
          getBySnapshotId: jest.fn().mockResolvedValue(existingEvent),
          create: createCbeMock,
        },
      },
    } as unknown as ReqContext;

    const cbe = await persistContextualBanditEvent(context, cbs, result);

    expect(cbe).toBe(existingEvent);
    expect(createCbeMock).not.toHaveBeenCalled();
    // The original decision to discard is preserved: no weight write, no seed,
    // no payload refresh.
    expect(applyWeightEpochUpdateMock).not.toHaveBeenCalled();
    expect(refreshLinkedFeaturePayloadsMock).not.toHaveBeenCalled();
  });

  it("does not publish saved exploit weights on resume when a stop/start reset the stage to explore", async () => {
    // An exploit run saved its event (weightsWereUpdated:true) but its weight
    // write failed, so banditVersion never moved. A stop/start then reset the CB
    // to `explore` (same banditVersion). The resume must not republish the saved
    // exploit weights into the new exploration period.
    const cb = makeCb({ stage: "explore", banditVersion: 2 });
    const cbs = makeCbs({ banditVersion: 2 });
    const result = makeResult();

    const existingEvent = {
      id: "cbe_existing",
      organization: "org_1",
      contextualBandit: cb.id,
      snapshotId: cbs.id,
      attributes: result.attributes,
      responses: result.responses,
      leaf_map: result.leaf_map,
      weightsWereUpdated: true,
      seed: "seed_existing",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };

    const createCbeMock = jest.fn();
    const applyWeightEpochUpdateMock = jest.fn().mockResolvedValue(cb);

    const context = {
      org: { id: "org_1" },
      logger: { warn: jest.fn(), error: jest.fn() },
      auditLog: jest.fn().mockResolvedValue(undefined),
      models: {
        contextualBandits: {
          getById: jest.fn().mockResolvedValue(cb),
          applyWeightEpochUpdate: applyWeightEpochUpdateMock,
          update: jest.fn().mockResolvedValue(cb),
        },
        contextualBanditEvents: {
          getBySnapshotId: jest.fn().mockResolvedValue(existingEvent),
          create: createCbeMock,
        },
      },
    } as unknown as ReqContext;

    const cbe = await persistContextualBanditEvent(context, cbs, result);

    expect(cbe).toBe(existingEvent);
    expect(createCbeMock).not.toHaveBeenCalled();
    // The exploration guard still applies on resume: the saved exploit weights
    // are not written to the serving weights.
    expect(applyWeightEpochUpdateMock).not.toHaveBeenCalled();
  });

  it("leaves the persisted weights alone on a no-weight run", async () => {
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
    const applyWeightEpochUpdateMock = jest.fn().mockResolvedValue(cb);

    const context = {
      org: { id: "org_1" },
      models: {
        contextualBandits: {
          getById: jest.fn().mockResolvedValue(cb),
          applyWeightEpochUpdate: applyWeightEpochUpdateMock,
          update: jest.fn().mockResolvedValue(cb),
        },
        contextualBanditEvents: {
          getBySnapshotId: jest.fn().mockResolvedValue(null),
          create: createCbeMock,
        },
      },
    } as unknown as ReqContext;

    await persistContextualBanditEvent(context, cbs, result);

    expect(applyWeightEpochUpdateMock).not.toHaveBeenCalled();
    expect(refreshLinkedFeaturePayloadsMock).not.toHaveBeenCalled();
  });

  it("throws when the CB doc is missing", async () => {
    const context = {
      org: { id: "org_1" },
      models: {
        contextualBandits: {
          getById: jest.fn().mockResolvedValue(null),
          applyWeightEpochUpdate: jest.fn(),
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

    const applyWeightEpochUpdateMock = jest.fn().mockResolvedValue(cb);
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
          applyWeightEpochUpdate: applyWeightEpochUpdateMock,
          update: updateMock,
        },
        contextualBanditEvents: {
          getBySnapshotId: jest.fn().mockResolvedValue(null),
          create: createCbeMock,
        },
      },
    } as unknown as ReqContext;

    await persistContextualBanditEvent(context, cbs, result);

    // Still "explore" per the CB doc, so weights are discarded for this run...
    expect(applyWeightEpochUpdateMock).not.toHaveBeenCalled();
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
    const applyWeightEpochUpdateMock = jest.fn().mockResolvedValue(cb);
    const context = {
      org: { id: "org_1" },
      models: {
        contextualBandits: {
          getById: jest.fn().mockResolvedValue(cb),
          applyWeightEpochUpdate: applyWeightEpochUpdateMock,
          update: jest.fn().mockResolvedValue(cb),
        },
        contextualBanditEvents: {
          getBySnapshotId: jest.fn().mockResolvedValue(null),
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

    expect(applyWeightEpochUpdateMock).toHaveBeenCalledTimes(1);
    expect(applyWeightEpochUpdateMock.mock.calls[0][1].bumpVersion).toBe(false);
    expect(
      applyWeightEpochUpdateMock.mock.calls[0][1].expectedBanditVersion,
    ).toBe(cb.banditVersion);
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

  it("returns false for a no-weight run (the persisted set is kept as-is)", () => {
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
    refreshLinkedFeaturePayloadsMock.mockResolvedValue(undefined);
  });

  function makeGuardContext(cb: ContextualBanditInterface) {
    const applyWeightEpochUpdateMock = jest.fn().mockResolvedValue(cb);
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
      logger: { warn: warnMock, error: jest.fn() },
      auditLog: jest.fn().mockResolvedValue(undefined),
      models: {
        contextualBandits: {
          getById: jest.fn().mockResolvedValue(cb),
          applyWeightEpochUpdate: applyWeightEpochUpdateMock,
          update: jest.fn(),
        },
        contextualBanditEvents: {
          getBySnapshotId: jest.fn().mockResolvedValue(null),
          create: createCbeMock,
        },
      },
    } as unknown as ReqContext;
    return { context, applyWeightEpochUpdateMock, createCbeMock, warnMock };
  }

  it("discards this run's weights when banditVersion changed mid-run", async () => {
    const cb = makeCb({ stage: "exploit", banditVersion: 5 });
    const cbs = makeCbs({ banditVersion: 3 });
    const { context, applyWeightEpochUpdateMock, createCbeMock, warnMock } =
      makeGuardContext(cb);

    await persistContextualBanditEvent(context, cbs, makeResult());

    expect(applyWeightEpochUpdateMock).not.toHaveBeenCalled();
    expect(createCbeMock).toHaveBeenCalledWith(
      expect.objectContaining({ weightsWereUpdated: false }),
    );
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it("persists weights when the run's banditVersion still matches the live CB", async () => {
    const cb = makeCb({ stage: "exploit", banditVersion: 5 });
    const cbs = makeCbs({ banditVersion: 5 });
    const { context, applyWeightEpochUpdateMock, warnMock } =
      makeGuardContext(cb);

    await persistContextualBanditEvent(context, cbs, makeResult());

    expect(
      applyWeightEpochUpdateMock.mock.calls[0][1].currentLeafWeights.length,
    ).toBeGreaterThan(0);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("discards this run's weights when an arm change lands between the read and the leaf-weight write", async () => {
    const cb = makeCb({ stage: "exploit", banditVersion: 5 });
    const cbs = makeCbs({ banditVersion: 5 });
    const { context, applyWeightEpochUpdateMock, warnMock } =
      makeGuardContext(cb);
    applyWeightEpochUpdateMock.mockRejectedValueOnce(new CasConflictError());

    const cbe = await persistContextualBanditEvent(context, cbs, makeResult());

    expect(cbe).toEqual(expect.objectContaining({ id: "cbe_x" }));
    expect(applyWeightEpochUpdateMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledTimes(1);
  });
});

describe("getContextualBanditStatusForUi", () => {
  function makeStatusContext(
    latestSnapshot: ContextualBanditSnapshotInterface | null,
  ) {
    const getLatestStatusForContextualBandit = jest
      .fn()
      .mockResolvedValue(latestSnapshot);
    const getLatestForContextualBandit = jest.fn();
    const getBySnapshotIdInOrg = jest.fn();
    const getLatestEventForContextualBandit = jest.fn();
    const context = {
      models: {
        contextualBanditSnapshots: {
          getLatestStatusForContextualBandit,
          getLatestForContextualBandit,
          getBySnapshotIdInOrg,
        },
        contextualBanditEvents: {
          getLatestForContextualBandit: getLatestEventForContextualBandit,
        },
      },
    } as unknown as ReqContext;
    return {
      context,
      getLatestStatusForContextualBandit,
      getLatestForContextualBandit,
      getBySnapshotIdInOrg,
      getLatestEventForContextualBandit,
    };
  }

  it("returns null when there is no snapshot yet", async () => {
    const cb = makeCb();
    const { context } = makeStatusContext(null);

    expect(await getContextualBanditStatusForUi(context, cb)).toBeNull();
  });

  it("returns the mapped status summary for the latest snapshot", async () => {
    const cb = makeCb();
    const cbs = makeCbs({
      id: "cbs_1",
      // "partial" folds to "success" in the UI status summary.
      status: "partial",
      error: "",
      queries: [
        { name: "contextual-bandit-rows", query: "q_1", status: "succeeded" },
      ],
      runStarted: new Date("2025-01-03T00:00:00Z"),
      multipleExposures: 7,
      triggeredBy: "scheduled",
    });
    const { context } = makeStatusContext(cbs);

    const summary = await getContextualBanditStatusForUi(context, cb);

    expect(summary).toEqual(toContextualBanditSnapshotStatusSummary(cbs));
    expect(summary?.status).toBe("success");
  });

  it("only reads the latest snapshot status, never events or full results", async () => {
    const cb = makeCb();
    const {
      context,
      getLatestStatusForContextualBandit,
      getLatestForContextualBandit,
      getBySnapshotIdInOrg,
      getLatestEventForContextualBandit,
    } = makeStatusContext(makeCbs({ id: "cbs_1", status: "running" }));

    await getContextualBanditStatusForUi(context, cb);

    expect(getLatestStatusForContextualBandit).toHaveBeenCalledTimes(1);
    expect(getLatestStatusForContextualBandit).toHaveBeenCalledWith("cb_1");
    // Status polling must stay cheap: use the projected status lookup, never
    // the full-document latest read, an event read, or a heavy snapshot lookup.
    expect(getLatestForContextualBandit).not.toHaveBeenCalled();
    expect(getLatestEventForContextualBandit).not.toHaveBeenCalled();
    expect(getBySnapshotIdInOrg).not.toHaveBeenCalled();
  });
});

describe("getContextualBanditResultsForUi", () => {
  const healthFields = {
    srm: { statistic: 10, pValue: 0.001, degreesOfFreedom: 1 },
    multipleExposures: 42,
    traffic: {
      overall: { name: "", srm: 0.001, variationUnits: [100, 100] },
      dimension: {},
    },
  };

  function makeContext({
    latestSnapshot,
    latestEvent,
    snapshotById = null,
  }: {
    latestSnapshot: ContextualBanditSnapshotInterface | null;
    latestEvent: unknown;
    snapshotById?: ContextualBanditSnapshotInterface | null;
  }) {
    const getBySnapshotIdInOrg = jest.fn().mockResolvedValue(snapshotById);
    const context = {
      models: {
        contextualBanditSnapshots: {
          getLatestForContextualBandit: jest
            .fn()
            .mockResolvedValue(latestSnapshot),
          getBySnapshotIdInOrg,
        },
        contextualBanditEvents: {
          getLatestForContextualBandit: jest
            .fn()
            .mockResolvedValue(latestEvent),
        },
      },
    } as unknown as ReqContext;
    return { context, getBySnapshotIdInOrg };
  }

  it("returns latest CBE payload and CBS status summary", async () => {
    const cb = makeCb();
    const cbs = makeCbs({
      id: "cbs_1",
      status: "running",
      queries: [
        { name: "contextual-bandit-rows", query: "q_1", status: "running" },
      ],
    });
    const cbe = {
      id: "cbe_1",
      snapshotId: "cbs_1",
      dateCreated: new Date("2025-01-03T00:00:00Z"),
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
    const { context } = makeContext({ latestSnapshot: cbs, latestEvent: cbe });

    const results = await getContextualBanditResultsForUi(context, cb);

    expect(results.contextualBanditSnapshot).toEqual({
      attributes: ["country"],
      responses: cbe.responses,
      leaf_map: cbe.leaf_map,
    });
    expect(results.latestSnapshotSummary).toEqual(
      toContextualBanditSnapshotStatusSummary(cbs),
    );
    expect(results.resultsRun).toEqual({
      snapshotId: "cbs_1",
      dateCreated: cbe.dateCreated,
    });
    // The snapshot has no health fields yet.
    expect(results.health).toBeNull();
  });

  it("reads results and health from the event's own snapshot when it is the latest", async () => {
    const cb = makeCb();
    const cbs = makeCbs({
      id: "cbs_done",
      status: "success",
      frozenSettings: frozenVariations(["v0", "v2"]),
      ...healthFields,
    });
    const cbe = {
      id: "cbe_done",
      snapshotId: "cbs_done",
      dateCreated: cbs.dateCreated,
      attributes: [],
      responses: [],
    };
    const { context, getBySnapshotIdInOrg } = makeContext({
      latestSnapshot: cbs,
      latestEvent: cbe,
    });

    const results = await getContextualBanditResultsForUi(context, cb);

    expect(getBySnapshotIdInOrg).not.toHaveBeenCalled();
    expect(results.snapshotVariationIds).toEqual(["v0", "v2"]);
    expect(results.health).toEqual({
      variations: [
        { id: "v0", weight: 0.5 },
        { id: "v2", weight: 0.5 },
      ],
      srm: healthFields.srm,
      traffic: healthFields.traffic,
      multipleExposures: 42,
    });
  });

  it("keeps results and health on the event's snapshot while a newer refresh is in flight", async () => {
    const cb = makeCb();
    const runningSnapshot = makeCbs({
      id: "cbs_running",
      status: "running",
      frozenSettings: frozenVariations(["v0", "v1"]),
    });
    const eventSnapshot = makeCbs({
      id: "cbs_done",
      status: "success",
      frozenSettings: frozenVariations(["v0", "v2"]),
      ...healthFields,
    });
    const cbe = {
      id: "cbe_done",
      snapshotId: "cbs_done",
      dateCreated: eventSnapshot.dateCreated,
      attributes: [],
      responses: [],
    };
    const { context, getBySnapshotIdInOrg } = makeContext({
      latestSnapshot: runningSnapshot,
      latestEvent: cbe,
      snapshotById: eventSnapshot,
    });

    const results = await getContextualBanditResultsForUi(context, cb);

    expect(getBySnapshotIdInOrg).toHaveBeenCalledWith("cbs_done");
    // Status reflects the in-flight run so the UI keeps polling...
    expect(results.latestSnapshotSummary?.id).toBe("cbs_running");
    expect(results.latestSnapshotSummary?.status).toBe("running");
    // ...while results and health both describe the completed run.
    expect(results.resultsRun?.snapshotId).toBe("cbs_done");
    expect(results.snapshotVariationIds).toEqual(["v0", "v2"]);
    expect(results.health?.variations.map((v) => v.id)).toEqual(["v0", "v2"]);
    expect(results.health?.multipleExposures).toBe(42);
  });

  it("keeps results and health on the event's snapshot when the newest refresh failed", async () => {
    const cb = makeCb();
    const failedSnapshot = makeCbs({
      id: "cbs_failed",
      status: "error",
      error: "SQL boom",
    });
    const eventSnapshot = makeCbs({
      id: "cbs_done",
      status: "success",
      frozenSettings: frozenVariations(["v0", "v1"]),
      ...healthFields,
    });
    const cbe = {
      id: "cbe_done",
      snapshotId: "cbs_done",
      dateCreated: eventSnapshot.dateCreated,
      attributes: [],
      responses: [],
    };
    const { context } = makeContext({
      latestSnapshot: failedSnapshot,
      latestEvent: cbe,
      snapshotById: eventSnapshot,
    });

    const results = await getContextualBanditResultsForUi(context, cb);

    expect(results.latestSnapshotSummary?.status).toBe("error");
    expect(results.health?.traffic?.overall.variationUnits).toEqual([100, 100]);
    expect(results.health?.multipleExposures).toBe(42);
  });

  it("labels results from the event's own frozen ids when its snapshot is gone, with no health", async () => {
    const cb = makeCb();
    const latestSnapshot = makeCbs({
      id: "cbs_other",
      status: "success",
      frozenSettings: frozenVariations(["v0", "v1"]),
      ...healthFields,
    });
    const cbe = {
      id: "cbe_orphan",
      snapshotId: "cbs_deleted",
      dateCreated: new Date("2025-01-02T00:00:00Z"),
      frozenVariationIds: ["v0", "v2"],
      attributes: [],
      responses: [],
    };
    const { context } = makeContext({
      latestSnapshot,
      latestEvent: cbe,
      snapshotById: null,
    });

    const results = await getContextualBanditResultsForUi(context, cb);

    expect(results.snapshotVariationIds).toEqual(["v0", "v2"]);
    // Health is never borrowed from a different run.
    expect(results.health).toBeNull();
  });

  it("reports null multiple exposures when the SRM query did not run", async () => {
    const cb = makeCb();
    const cbs = makeCbs({
      id: "cbs_done",
      status: "success",
      frozenSettings: frozenVariations(["v0", "v1"]),
      traffic: healthFields.traffic,
    });
    const cbe = {
      id: "cbe_done",
      snapshotId: "cbs_done",
      dateCreated: cbs.dateCreated,
      attributes: [],
      responses: [],
    };
    const { context } = makeContext({ latestSnapshot: cbs, latestEvent: cbe });

    const results = await getContextualBanditResultsForUi(context, cb);

    expect(results.health?.srm).toBeNull();
    expect(results.health?.multipleExposures).toBeNull();
  });

  it("returns no results or health before any event exists", async () => {
    const cb = makeCb();
    const { context, getBySnapshotIdInOrg } = makeContext({
      latestSnapshot: makeCbs({ id: "cbs_running", status: "running" }),
      latestEvent: null,
    });

    const results = await getContextualBanditResultsForUi(context, cb);

    expect(getBySnapshotIdInOrg).not.toHaveBeenCalled();
    expect(results.contextualBanditSnapshot).toBeNull();
    expect(results.resultsRun).toBeNull();
    expect(results.health).toBeNull();
    expect(results.latestSnapshotSummary?.status).toBe("running");
  });
});
