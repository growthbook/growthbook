import { ExperimentInterface } from "shared/types/experiment";
import { ExposureQuery } from "shared/types/datasource";
import {
  ContextualBanditInterface,
  ContextualBanditSnapshotInterface,
  contextualBanditSnapshotSettingsValidator,
} from "shared/validators";
import { deriveContextId } from "shared/util";
import { CONTEXTUAL_BANDIT_COMBINED_ATTRIBUTE_VALUE } from "shared/constants";
import { contextualBanditAttrCol } from "shared/experiments";
import { ReqContext } from "back-end/types/api";
import {
  buildContextualBanditSnapshotSettings,
  enforceContextCap,
  getContextualBanditResultsForUi,
  leafWeightsFromContextualBanditResult,
  persistContextualBanditEvent,
  toContextualBanditSnapshotStatusSummary,
} from "back-end/src/enterprise/services/contextualBandits";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { ContextualBanditResult } from "back-end/src/enterprise/services/contextualBanditStats";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
  getPayloadKeys: jest
    .fn()
    .mockReturnValue([{ project: "", environment: "production" }]),
}));

jest.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: jest.fn(),
}));

const getExperimentByIdMock = getExperimentById as jest.MockedFunction<
  typeof getExperimentById
>;
const queueSDKPayloadRefreshMock =
  queueSDKPayloadRefresh as jest.MockedFunction<typeof queueSDKPayloadRefresh>;

function makeCb(
  overrides: Partial<ContextualBanditInterface> = {},
): ContextualBanditInterface {
  return {
    id: "cb_1",
    organization: "org_1",
    dateCreated: new Date("2025-01-01T00:00:00Z"),
    dateUpdated: new Date("2025-01-01T00:00:00Z"),
    experiment: "exp_1",
    datasourceId: "ds_1",
    exposureQueryId: "eq_1",
    contextualAttributes: ["country", "device"],
    maxContexts: 16,
    treeModel: "regression_tree",
    minUsersPerLeaf: 100,
    maxLeaves: 8,
    holdoutPercent: 0,
    stickyBucketing: false,
    canonicalFormVersion: 1,
    phases: [
      {
        dateStarted: new Date("2025-01-02T00:00:00Z"),
        dateEnded: null,
        currentLeafWeights: [
          { contextId: "ctx_catchall", weights: [0.5, 0.5] },
        ],
      },
    ],
    ...overrides,
  } as ContextualBanditInterface;
}

function makeExperiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    id: "exp_1",
    organization: "org_1",
    variations: [
      { id: "v0", name: "Control", key: "0", screenshots: [] },
      { id: "v1", name: "Treatment", key: "1", screenshots: [] },
    ],
    phases: [
      {
        dateStarted: new Date("2025-01-02T00:00:00Z"),
        variationWeights: [0.4, 0.6],
      },
    ],
    goalMetrics: ["met_g1"],
    secondaryMetrics: ["met_s1"],
    // CB must IGNORE this field — verified explicitly below.
    guardrailMetrics: ["met_guard"],
    metricOverrides: [],
    type: "contextual-bandit",
    ...overrides,
  } as unknown as ExperimentInterface;
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
    experiment: "exp_1",
    phase: 0,
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
        variationMeans: [0.1, 0.2],
        updatedWeights: [0.3, 0.7],
        bestArmProbabilities: [0.3, 0.7],
        updateMessage: "ok",
      },
      {
        context: { country: "CA" },
        sampleSizePerVariation: [30, 70],
        variationMeans: [0.05, 0.07],
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
  it("produces strict-valid settings with no `guardrailMetrics` even when the experiment has them", () => {
    const cb = makeCb();
    const exp = makeExperiment({ guardrailMetrics: ["met_guard"] });
    const eaq = makeExposureQuery();

    const settings = buildContextualBanditSnapshotSettings(cb, exp, 0, eaq);

    expect(settings).not.toHaveProperty("guardrailMetrics");
    expect(settings).not.toHaveProperty("activationMetric");
    expect(settings).not.toHaveProperty("regressionAdjustmentEnabled");

    // Strict validator must accept it (would reject any unknown key).
    expect(() =>
      contextualBanditSnapshotSettingsValidator.parse(settings),
    ).not.toThrow();

    // Spot-check the carried-over fields.
    expect(settings.experimentId).toBe("exp_1");
    expect(settings.contextualBanditId).toBe("cb_1");
    expect(settings.phase).toBe(0);
    expect(settings.goalMetrics).toEqual(["met_g1"]);
    expect(settings.secondaryMetrics).toEqual(["met_s1"]);
    expect(settings.variations).toEqual([
      { id: "v0", weight: 0.4 },
      { id: "v1", weight: 0.6 },
    ]);
    expect(settings.treeModel).toBe("regression_tree");
    expect(settings.contextualAttributes).toEqual(["country", "device"]);
  });

  it("falls back to CB.contextualAttributes when EAQ has no targeting columns", () => {
    const cb = makeCb({ contextualAttributes: ["plan_tier"] });
    const exp = makeExperiment();
    const eaq = makeExposureQuery({ targetingAttributeColumns: undefined });

    const settings = buildContextualBanditSnapshotSettings(cb, exp, 0, eaq);

    expect(settings.contextualAttributes).toEqual(["plan_tier"]);
  });

  it("defaults variation weights to uniform when the experiment phase has none", () => {
    const exp = makeExperiment({
      phases: [
        {
          // Intentionally missing variationWeights.
          dateStarted: new Date("2025-01-02T00:00:00Z"),
        },
      ] as unknown as ExperimentInterface["phases"],
      variations: [
        { id: "v0", name: "Control", key: "0", screenshots: [] },
        { id: "v1", name: "T1", key: "1", screenshots: [] },
        { id: "v2", name: "T2", key: "2", screenshots: [] },
      ] as unknown as ExperimentInterface["variations"],
    });

    const settings = buildContextualBanditSnapshotSettings(
      makeCb(),
      exp,
      0,
      makeExposureQuery(),
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
      makeExperiment(),
      0,
      makeExposureQuery(),
    );
    expect(settings.treeModel).toBe("regression_tree");
  });
});

describe("enforceContextCap", () => {
  const catchAllContextId = "ctx_catchall";

  it("is a no-op when distinct contexts already fit under the cap", () => {
    const rows = [
      { contextId: "a", x: 1 },
      { contextId: "a", x: 1 },
      { contextId: "b", x: 2 },
    ];
    const out = enforceContextCap(rows, 2, 2);
    expect(out.trimmed).toBe(false);
    expect(out.rows).toEqual(rows);
  });

  it("merges the smallest contexts into the catch-all when above the cap", () => {
    const rows = [
      { contextId: "a", x: 1 },
      { contextId: "a", x: 1 },
      { contextId: "a", x: 1 },
      { contextId: "b", x: 2 },
      { contextId: "b", x: 2 },
      { contextId: "c", x: 3 },
    ];
    const out = enforceContextCap(rows, 2, 2, catchAllContextId, ["x"]);
    expect(out.trimmed).toBe(true);
    const cMerged = out.rows.filter((r) => r.contextId === catchAllContextId);
    expect(cMerged.length).toBeGreaterThanOrEqual(1);
    expect(
      cMerged.every((r) => r.x === CONTEXTUAL_BANDIT_COMBINED_ATTRIBUTE_VALUE),
    ).toBe(true);
    expect(
      cMerged.every(
        (r) =>
          r[contextualBanditAttrCol("x")] ===
          CONTEXTUAL_BANDIT_COMBINED_ATTRIBUTE_VALUE,
      ),
    ).toBe(true);
    const aSurvivors = out.rows.filter((r) => r.x === 1);
    const bSurvivors = out.rows.filter((r) => r.x === 2);
    expect(aSurvivors).toHaveLength(3);
    expect(bSurvivors).toHaveLength(2);
  });
});

describe("persistContextualBanditEvent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a CBE with N leaves and patches CB phase weights to match", async () => {
    const cb = makeCb();
    const cbs = makeCbs();
    const result = makeResult();

    const createCbeMock = jest.fn().mockResolvedValue({
      id: "cbe_1",
      organization: "org_1",
      experiment: cbs.experiment,
      phase: cbs.phase,
      snapshotId: cbs.id,
      attributes: result.attributes,
      responses: result.responses,
      weightsWereUpdated: true,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    const patchPhaseWeightsMock = jest.fn().mockResolvedValue(cb);
    const getByExperimentIdMock = jest.fn().mockResolvedValue(cb);

    const context = {
      org: { id: "org_1" },
      models: {
        contextualBandits: {
          getByExperimentId: getByExperimentIdMock,
          patchPhaseWeights: patchPhaseWeightsMock,
        },
        contextualBanditEvents: {
          create: createCbeMock,
        },
      },
    } as unknown as ReqContext;

    const experiment = makeExperiment();
    getExperimentByIdMock.mockResolvedValueOnce(experiment);

    const cbe = await persistContextualBanditEvent(context, cbs, result);

    expect(cbe.id).toBe("cbe_1");
    expect(getByExperimentIdMock).toHaveBeenCalledWith(cbs.experiment);
    expect(getExperimentByIdMock).toHaveBeenCalledWith(context, cbs.experiment);

    // CBE create payload mirrors the result.
    expect(createCbeMock).toHaveBeenCalledWith({
      experiment: cbs.experiment,
      phase: cbs.phase,
      snapshotId: cbs.id,
      attributes: result.attributes,
      responses: result.responses,
      leaf_map: result.leaf_map,
      weightsWereUpdated: true,
    });

    // CB doc's phase weights get the per-leaf weights — same cardinality as responses.
    expect(patchPhaseWeightsMock).toHaveBeenCalledTimes(1);
    const [cbIdArg, phaseArg, leafWeightsArg] =
      patchPhaseWeightsMock.mock.calls[0];
    expect(cbIdArg).toBe(cb.id);
    expect(phaseArg).toBe(cbs.phase);
    expect(leafWeightsArg).toHaveLength(2);
    const expectedLeafWeights = leafWeightsFromContextualBanditResult(
      cbs.experiment,
      result,
    );
    expect(leafWeightsArg).toEqual(expectedLeafWeights);
    expect(leafWeightsArg[0].contextId).toBe(
      deriveContextId(cbs.experiment, { country: "US" }),
    );

    // SDK payload refresh fired with the CB-specific audit event.
    expect(queueSDKPayloadRefreshMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context,
        auditContext: expect.objectContaining({
          event: "contextual-bandit.refresh",
          model: "experiment",
          id: cbs.experiment,
        }),
      }),
    );
  });

  it("throws when the CB doc is missing", async () => {
    const context = {
      org: { id: "org_1" },
      models: {
        contextualBandits: {
          getByExperimentId: jest.fn().mockResolvedValue(null),
          patchPhaseWeights: jest.fn(),
        },
        contextualBanditEvents: { create: jest.fn() },
      },
    } as unknown as ReqContext;

    await expect(
      persistContextualBanditEvent(context, makeCbs(), makeResult()),
    ).rejects.toThrow(/No CB doc/);
  });

  it("throws when the experiment is missing", async () => {
    const cb = makeCb();
    const context = {
      org: { id: "org_1" },
      models: {
        contextualBandits: {
          getByExperimentId: jest.fn().mockResolvedValue(cb),
          patchPhaseWeights: jest.fn(),
        },
        contextualBanditEvents: { create: jest.fn() },
      },
    } as unknown as ReqContext;

    getExperimentByIdMock.mockResolvedValueOnce(null);

    await expect(
      persistContextualBanditEvent(context, makeCbs(), makeResult()),
    ).rejects.toThrow(/No experiment doc/);
  });
});

describe("getContextualBanditResultsForUi", () => {
  it("returns latest CBE payload and CBS status summary", async () => {
    const experiment = makeExperiment();
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
          getLatestForExperiment: jest.fn().mockResolvedValue(cbs),
        },
        contextualBanditEvents: {
          getLatestForExperiment: jest.fn().mockResolvedValue(cbe),
        },
      },
    } as unknown as ReqContext;

    const results = await getContextualBanditResultsForUi(context, experiment);

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
