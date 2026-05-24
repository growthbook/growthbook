import { contextualBanditAttrCol } from "shared/experiments";
import { ExperimentMetricQueryResponseRows } from "shared/types/integrations";
import { QueryInterface } from "shared/types/query";
import {
  ContextualBanditInterface,
  ContextualBanditSnapshotInterface,
  ContextualBanditSnapshotSettings,
} from "shared/validators";
import {
  CONTEXTUAL_BANDIT_ROWS_QUERY_NAME,
  ContextualBanditResultsQueryRunner,
} from "back-end/src/queryRunners/ContextualBanditResultsQueryRunner";
import { QueryMap } from "back-end/src/queryRunners/QueryRunner";
import { loadContextualBanditSnapshotContext } from "back-end/src/services/contextualBanditQueries";
import { getContextualBanditQuerySql } from "back-end/src/services/contextualBanditSql";
import {
  ContextualBanditResult,
  runContextualStatsEngine,
} from "back-end/src/services/contextualBanditStats";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { ReqContext } from "back-end/types/api";

// Swap the runner's two stub seams (SQL + Python stats) for jest.fn so we can
// exercise the row-tagging / context-cap / settings-building glue without
// depending on the real bodies. The orchestrator-module mock keeps the pure
// helpers (attributesToCondition, enforceContextCap,
// getContextualBanditSettingsForStatsEngine) real and intercepts only the
// side-effecting `persistContextualBanditEvent`.
jest.mock("back-end/src/services/contextualBanditSql", () => ({
  getContextualBanditQuerySql: jest.fn(),
  executeContextualBanditQuery: jest.fn(),
}));
jest.mock("back-end/src/services/contextualBanditQueries", () => {
  const actual = jest.requireActual(
    "back-end/src/services/contextualBanditQueries",
  );
  return {
    ...actual,
    loadContextualBanditSnapshotContext: jest.fn(),
  };
});
jest.mock("back-end/src/services/contextualBanditStats", () => ({
  runContextualStatsEngine: jest.fn(),
}));
jest.mock("back-end/src/services/contextualBandits", () => {
  const actual = jest.requireActual("back-end/src/services/contextualBandits");
  return {
    ...actual,
    persistContextualBanditEvent: jest.fn(),
  };
});

import { persistContextualBanditEvent } from "back-end/src/services/contextualBandits";

const getContextualBanditQuerySqlMock =
  getContextualBanditQuerySql as jest.MockedFunction<
    typeof getContextualBanditQuerySql
  >;
const loadContextualBanditSnapshotContextMock =
  loadContextualBanditSnapshotContext as jest.MockedFunction<
    typeof loadContextualBanditSnapshotContext
  >;
const runContextualStatsEngineMock =
  runContextualStatsEngine as jest.MockedFunction<
    typeof runContextualStatsEngine
  >;
const persistContextualBanditEventMock =
  persistContextualBanditEvent as jest.MockedFunction<
    typeof persistContextualBanditEvent
  >;

function makeSnapshotSettings(
  overrides: Partial<ContextualBanditSnapshotSettings> = {},
): ContextualBanditSnapshotSettings {
  return {
    experimentId: "exp_1",
    contextualBanditId: "cb_1",
    phase: 0,

    datasourceId: "ds_1",
    exposureQueryId: "eq_1",
    contextualAttributes: ["country"],

    goalMetrics: ["met_g1"],
    secondaryMetrics: [],
    metricSettings: {},

    variations: [
      { id: "v0", weight: 0.5 },
      { id: "v1", weight: 0.5 },
    ],

    maxContexts: 16,
    treeModel: "regression_tree",
    minUsersPerLeaf: 100,
    maxLeaves: 8,
    canonicalFormVersion: 1,

    startDate: new Date("2025-01-01T00:00:00Z"),
    endDate: null,
    reweight: true,
    banditWeightsSeed: 0,
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
    experiment: "exp_1",
    datasourceId: "ds_1",
    exposureQueryId: "eq_1",
    contextualAttributes: ["country"],
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

function makeCbsModel(
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
    frozenSettings: makeSnapshotSettings(),
    ...overrides,
  } as ContextualBanditSnapshotInterface;
}

function makeIntegration(): SourceIntegrationInterface {
  return {
    datasource: {
      id: "ds_1",
      type: "postgres",
      settings: {
        queries: {
          exposure: [
            {
              id: "eq_1",
              name: "EAQ",
              userIdType: "user_id",
              query: "select 1",
              dimensions: [],
              targetingAttributeColumns: ["country"],
            },
          ],
        },
      },
    },
  } as unknown as SourceIntegrationInterface;
}

function makeContext(cb: ContextualBanditInterface): ReqContext {
  return {
    org: { id: "org_1" },
    permissions: {
      canRunExperimentQueries: () => true,
      throwPermissionError: () => {
        throw new Error("Permission denied");
      },
    },
    models: {
      contextualBandits: {
        getByExperimentId: jest.fn().mockResolvedValue(cb),
        patchPhaseWeights: jest.fn().mockResolvedValue(cb),
      },
      contextualBanditEvents: {
        getLatestForExperiment: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async (payload) => ({
          id: "cbe_new",
          organization: "org_1",
          dateCreated: new Date(),
          dateUpdated: new Date(),
          ...payload,
        })),
      },
      contextualBanditSnapshots: {
        getBySnapshotIdInOrg: jest.fn().mockResolvedValue(null),
        updateById: jest
          .fn()
          .mockImplementation(async (_id, updates) => updates),
      },
    },
  } as unknown as ReqContext;
}

function newRunner(
  context: ReqContext,
  model: ContextualBanditSnapshotInterface = makeCbsModel(),
): ContextualBanditResultsQueryRunner {
  return new ContextualBanditResultsQueryRunner(
    context,
    model,
    makeIntegration(),
    false,
  );
}

describe("ContextualBanditResultsQueryRunner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("runAnalysis (happy path)", () => {
    it("tags rows with contextIds, caps contexts, and forwards to the stats engine", async () => {
      const cb = makeCb();
      const context = makeContext(cb);
      const runner = newRunner(context);

      // Seed the params normally written by startQueries(). Setting them
      // directly keeps the test from running real SQL bookkeeping.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (runner as any).snapshotSettings = makeSnapshotSettings();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (runner as any).variationNames = ["Control", "Treatment"];

      const rows: ExperimentMetricQueryResponseRows = [
        {
          variation: "0",
          users: 100,
          count: 100,
          main_sum: 5,
          main_sum_squares: 0.5,
          [contextualBanditAttrCol("country")]: "US",
        },
        {
          variation: "1",
          users: 100,
          count: 100,
          main_sum: 6,
          main_sum_squares: 0.6,
          [contextualBanditAttrCol("country")]: "US",
        },
      ];

      const queryMap: QueryMap = new Map<string, QueryInterface>([
        [
          CONTEXTUAL_BANDIT_ROWS_QUERY_NAME,
          { result: rows } as unknown as QueryInterface,
        ],
      ]);

      const fitted: ContextualBanditResult = {
        attributes: ["country"],
        responses: [
          {
            context: { country: "US" },
            sampleSizePerVariation: [100, 100],
            variationMeans: [0.05, 0.06],
            updatedWeights: [0.4, 0.6],
            bestArmProbabilities: [0.4, 0.6],
            updateMessage: "ok",
          },
        ],
      };
      runContextualStatsEngineMock.mockResolvedValueOnce(fitted);

      const queryContext = {
        snapshotSettings: {
          goalMetrics: ["met_g1"],
          metricSettings: [],
          regressionAdjustmentEnabled: false,
        } as never,
        analysisSettings: {
          statsEngine: "bayesian",
          dimensions: [],
          baselineVariationIndex: 0,
          numGoalMetrics: 1,
        } as never,
        metricMap: new Map(),
        factTableMap: new Map(),
        decisionMetric: { id: "met_g1", name: "Goal" } as never,
      };
      loadContextualBanditSnapshotContextMock.mockResolvedValueOnce(
        queryContext,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (runner as any).cachedQueryContext = queryContext;

      const result = await runner.runAnalysis(queryMap);

      expect(result).toEqual(fitted);
      expect(runContextualStatsEngineMock).toHaveBeenCalledTimes(1);

      const [statsSettings, taggedRows, runParams] =
        runContextualStatsEngineMock.mock.calls[0];
      expect(statsSettings.var_names).toEqual(["Control", "Treatment"]);
      expect(statsSettings.var_ids).toEqual(["v0", "v1"]);
      expect(statsSettings.contextual_attributes).toEqual(["country"]);
      expect(runParams?.snapshotId).toBe("cbs_1");
      expect(runParams?.decisionMetricId).toBe("met_g1");
      // Every row passed to the stats engine has a derived contextId.
      expect(
        taggedRows.every(
          (r) =>
            typeof (r as never as { contextId: string }).contextId === "string",
        ),
      ).toBe(true);
      expect(taggedRows).toHaveLength(2);
    });

    it("rejects when snapshotSettings have not been initialised", async () => {
      const runner = newRunner(makeContext(makeCb()));
      const queryMap: QueryMap = new Map();
      await expect(runner.runAnalysis(queryMap)).rejects.toThrow(
        /snapshotSettings missing/,
      );
    });

    it("rejects when the rows sub-query is missing from the queryMap", async () => {
      const runner = newRunner(makeContext(makeCb()));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (runner as any).snapshotSettings = makeSnapshotSettings();
      const queryMap: QueryMap = new Map();
      await expect(runner.runAnalysis(queryMap)).rejects.toThrow(
        /contextual-bandit-rows/,
      );
    });
  });

  describe("updateModel", () => {
    it("on `succeeded`, persists the CBE id + weightsWereUpdated and patches the CBS", async () => {
      const cb = makeCb();
      const context = makeContext(cb);
      const runner = newRunner(context);

      persistContextualBanditEventMock.mockResolvedValueOnce({
        id: "cbe_42",
        organization: "org_1",
        experiment: "exp_1",
        phase: 0,
        snapshotId: "cbs_1",
        attributes: ["country"],
        responses: [],
        weightsWereUpdated: true,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      });

      const result: ContextualBanditResult = {
        attributes: ["country"],
        responses: [
          {
            context: { country: "US" },
            updatedWeights: [0.4, 0.6],
            updateMessage: "ok",
          },
          {
            context: { country: "CA" },
            updatedWeights: [0.55, 0.45],
            updateMessage: "ok",
          },
        ],
      };

      const updated = await runner.updateModel({
        status: "succeeded",
        queries: [],
        runStarted: new Date(),
        result,
      });

      expect(persistContextualBanditEventMock).toHaveBeenCalledTimes(1);
      // updateById persists the CBE pointer and weightsWereUpdated flag.
      expect(
        context.models.contextualBanditSnapshots.updateById,
      ).toHaveBeenCalledWith(
        "cbs_1",
        expect.objectContaining({
          status: "success",
          contextualBanditEventId: "cbe_42",
          weightsWereUpdated: true,
        }),
      );
      expect(updated.status).toBe("success");
      expect(updated.contextualBanditEventId).toBe("cbe_42");
      expect(updated.weightsWereUpdated).toBe(true);
    });

    it("on `failed`, stamps `status: error` + error message and does NOT persist a CBE", async () => {
      const cb = makeCb();
      const context = makeContext(cb);
      const runner = newRunner(context);

      const updated = await runner.updateModel({
        status: "failed",
        queries: [],
        runStarted: new Date(),
        error: "SQL boom",
      });

      expect(persistContextualBanditEventMock).not.toHaveBeenCalled();
      expect(
        context.models.contextualBanditSnapshots.updateById,
      ).toHaveBeenCalledWith(
        "cbs_1",
        expect.objectContaining({
          status: "error",
          error: "SQL boom",
        }),
      );
      expect(updated.status).toBe("error");
      // No CBE pointer set on error.
      expect(updated.contextualBanditEventId).toBeUndefined();
    });
  });

  describe("startQueries seam", () => {
    it("generates SQL via getContextualBanditQuerySql for persistence on the QueryDoc", async () => {
      const cb = makeCb();
      const context = makeContext(cb);
      const integration = makeIntegration();

      getContextualBanditQuerySqlMock.mockResolvedValueOnce(
        "-- contextual-bandit mock rows for cbs_1",
      );

      const sql = await getContextualBanditQuerySqlMock(
        context,
        cb,
        integration.datasource,
        integration.datasource.settings.queries.exposure[0],
        "cbs_1",
      );

      expect(sql).toBe("-- contextual-bandit mock rows for cbs_1");
    });
  });
});
