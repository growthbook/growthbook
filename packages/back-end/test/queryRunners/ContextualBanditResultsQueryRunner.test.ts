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
} from "back-end/src/enterprise/queryRunners/ContextualBanditResultsQueryRunner";
import {
  ContextualBanditResult,
  runContextualStatsEngine,
} from "back-end/src/enterprise/services/contextualBanditStats";
import { QueryMap } from "back-end/src/queryRunners/QueryRunner";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { ReqContext } from "back-end/types/api";

jest.mock("back-end/src/enterprise/services/contextualBanditStats", () => ({
  runContextualStatsEngine: jest.fn(),
}));
jest.mock("back-end/src/enterprise/services/contextualBandits", () => {
  const actual = jest.requireActual(
    "back-end/src/enterprise/services/contextualBandits",
  );
  return {
    ...actual,
    persistContextualBanditEvent: jest.fn(),
  };
});
jest.mock("back-end/src/models/MetricModel", () => ({
  getMetricMap: jest.fn().mockResolvedValue(
    new Map([
      [
        "fact__g1",
        {
          id: "fact__g1",
          name: "Goal",
          datasource: "ds_1",
          metricType: "mean",
        },
      ],
    ]),
  ),
}));
jest.mock("back-end/src/models/FactTableModel", () => ({
  getFactTableMap: jest.fn().mockResolvedValue(new Map()),
}));

import { persistContextualBanditEvent } from "back-end/src/enterprise/services/contextualBandits";

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
    trackingKey: "exp_1",
    contextualBanditId: "cb_1",

    datasourceId: "ds_1",
    contextualBanditQueryId: "cbq_1",
    query: "SELECT user_id, timestamp, experiment_id, variation_id FROM t",
    userIdType: "user_id",
    contextualAttributes: ["country"],

    decisionMetric: "fact__g1",
    metricSettings: {},

    variations: [
      { id: "v0", weight: 0.5 },
      { id: "v1", weight: 0.5 },
    ],

    minUsersPerLeaf: 100,
    maxLeaves: 8,
    banditModelVersion: 1,

    startDate: new Date("2025-01-01T00:00:00Z"),
    endDate: null,
    reweight: true,
    banditWeightsSeed: 0,
    regressionAdjustmentEnabled: false,
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
    datasource: "ds_1",
    contextualBanditQueryId: "cbq_1",
    contextualAttributes: ["country"],
    minUsersPerLeaf: 100,
    maxLeaves: 8,
    holdoutPercent: 0,
    stickyBucketing: false,
    banditModelVersion: 1,
    dateStarted: new Date("2025-01-02T00:00:00Z"),
    currentLeafWeights: [
      {
        leafId: 0,
        condition: { country: "US" },
        weights: [
          { variationId: "v0", weight: 0.5 },
          { variationId: "v1", weight: 0.5 },
        ],
      },
    ],
    banditVersion: 0,
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
    contextualBandit: "cb_1",
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
    getExperimentFactMetricsQuery: jest
      .fn()
      .mockReturnValue("-- contextual-bandit metric SQL"),
    runExperimentFactMetricsQuery: jest.fn().mockResolvedValue({ rows: [] }),
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
        getById: jest.fn().mockResolvedValue(cb),
        patchLeafWeights: jest.fn().mockResolvedValue(cb),
      },
      contextualBanditEvents: {
        getLatestForContextualBandit: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async (payload) => ({
          id: "cbe_new",
          organization: "org_1",
          dateCreated: new Date(),
          dateUpdated: new Date(),
          ...payload,
        })),
      },
      contextualBanditSnapshots: {
        getBySnapshotIdInOrg: jest.fn().mockResolvedValue(makeCbsModel()),
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
  integration: SourceIntegrationInterface = makeIntegration(),
): ContextualBanditResultsQueryRunner {
  return new ContextualBanditResultsQueryRunner(
    context,
    model,
    integration,
    false,
  );
}

describe("ContextualBanditResultsQueryRunner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("runAnalysis (happy path)", () => {
    it("forwards rows to the stats engine unchanged", async () => {
      const cb = makeCb();
      const context = makeContext(cb);
      const runner = newRunner(context);

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
            sampleMeans: [0.05, 0.06],
            updatedWeights: [0.4, 0.6],
            bestArmProbabilities: [0.4, 0.6],
            updateMessage: "ok",
          },
        ],
      };
      runContextualStatsEngineMock.mockResolvedValueOnce(fitted);

      const result = await runner.runAnalysis(queryMap);

      expect(result).toEqual(fitted);
      expect(runContextualStatsEngineMock).toHaveBeenCalledTimes(1);

      const [statsSettings, forwardedRows, runParams] =
        runContextualStatsEngineMock.mock.calls[0];
      expect(statsSettings.varIds).toEqual(["v0", "v1"]);
      expect(statsSettings.contextualAttributes).toEqual(["country"]);
      expect(runParams?.snapshotId).toBe("cbs_1");
      expect(runParams?.decisionMetricId).toBe("fact__g1");
      expect(forwardedRows).toHaveLength(2);
      expect(forwardedRows).toEqual(rows);
      expect(
        forwardedRows.every(
          (r) => !("contextId" in (r as Record<string, unknown>)),
        ),
      ).toBe(true);
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
        contextualBandit: "cb_1",
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

    it("on a repeat `succeeded` call, does NOT re-persist when the CBS already has a CBE", async () => {
      const cb = makeCb();
      const context = makeContext(cb);
      const runner = newRunner(context);

      (
        context.models.contextualBanditSnapshots
          .getBySnapshotIdInOrg as jest.Mock
      ).mockResolvedValue(
        makeCbsModel({ contextualBanditEventId: "cbe_existing" }),
      );

      const result: ContextualBanditResult = {
        attributes: ["country"],
        responses: [
          {
            context: { country: "US" },
            updatedWeights: [0.4, 0.6],
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

      expect(persistContextualBanditEventMock).not.toHaveBeenCalled();
      expect(
        context.models.contextualBanditSnapshots.updateById,
      ).toHaveBeenCalledWith(
        "cbs_1",
        expect.objectContaining({ status: "success" }),
      );
      expect(updated.contextualBanditEventId).toBeUndefined();
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
      expect(updated.contextualBanditEventId).toBeUndefined();
    });
  });

  describe("startQueries seam", () => {
    it("generates SQL via integration.getExperimentFactMetricsQuery and registers the query", async () => {
      const cb = makeCb();
      const context = makeContext(cb);
      const integration = makeIntegration();
      const runner = newRunner(context, makeCbsModel(), integration);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (runner as any).startQuery = jest
        .fn()
        .mockImplementation(async (q: { name: string; query: string }) => ({
          name: q.name,
          query: q.query,
        }));

      const queries = await runner.startQueries({
        snapshotSettings: makeSnapshotSettings(),
        variationNames: ["Control", "Treatment"],
      });

      expect(integration.getExperimentFactMetricsQuery).toHaveBeenCalledTimes(
        1,
      );
      const callArgs = (integration.getExperimentFactMetricsQuery as jest.Mock)
        .mock.calls[0][0];
      expect(callArgs.settings.experimentId).toBe("exp_1");
      expect(callArgs.settings.banditSettings.contextualBandit).toBe(true);
      expect(
        callArgs.settings.banditSettings.targetingAttributeColumns,
      ).toEqual(["country"]);
      expect(callArgs.metrics[0].id).toBe("fact__g1");
      expect(callArgs.unitsSource).toBe("exposureQuery");
      expect(queries).toHaveLength(1);
      expect(queries[0].name).toBe(CONTEXTUAL_BANDIT_ROWS_QUERY_NAME);
    });
  });
});
