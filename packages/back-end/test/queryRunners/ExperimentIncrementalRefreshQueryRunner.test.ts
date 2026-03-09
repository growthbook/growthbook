import { QueryPointer, QueryStatus, Queries } from "shared/types/query";
import {
  ExperimentSnapshotInterface,
  ExperimentSnapshotSettings,
} from "shared/types/experiment-snapshot";
import { IncrementalRefreshInterface } from "shared/validators";
import { ApiReqContext } from "back-end/types/api";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import {
  StartQueryParams,
  RowsType,
  ProcessedRowsType,
} from "back-end/src/queryRunners/QueryRunner";

// ===================================================================
// Mocks — must be declared before importing the module under test.
// We mock the entire transitive dependency graph that would otherwise
// require Mongoose or other heavy infrastructure.
// ===================================================================

// ExperimentResultsQueryRunner is imported for SnapshotResult and
// TRAFFIC_QUERY_NAME. Provide those exports here.
jest.mock("back-end/src/queryRunners/ExperimentResultsQueryRunner", () => ({
  TRAFFIC_QUERY_NAME: "traffic",
  SnapshotResult: {},
}));

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  findSnapshotById: jest.fn().mockResolvedValue(null),
  updateSnapshot: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("back-end/src/models/ReportModel", () => ({
  updateReport: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("back-end/src/services/stats", () => ({
  analyzeExperimentResults: jest.fn().mockResolvedValue({
    results: [],
    banditResult: null,
  }),
  analyzeExperimentTraffic: jest.fn().mockReturnValue({}),
}));

jest.mock("back-end/src/services/experimentTimeSeries", () => ({
  getExperimentSettingsHashForIncrementalRefresh: jest
    .fn()
    .mockReturnValue("hash_experiment"),
  getMetricSettingsHashForIncrementalRefresh: jest
    .fn()
    .mockReturnValue("hash_metric"),
}));

jest.mock("back-end/src/services/dataPipeline", () => ({
  validateIncrementalPipeline: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("back-end/src/services/dimensions", () => ({
  getExposureQueryEligibleDimensions: jest.fn().mockReturnValue({
    eligibleDimensions: [],
    eligibleDimensionsWithSlices: [],
    eligibleDimensionsWithSlicesUnderMaxCells: [],
  }),
}));

jest.mock("back-end/src/services/experimentQueries/experimentQueries", () => ({
  chunkMetrics: jest
    .fn()
    .mockImplementation(({ metrics }: { metrics: unknown[] }) => [
      metrics.map(
        (m: { metric: unknown }) => (m as { metric: unknown }).metric,
      ),
    ]),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn().mockResolvedValue({
    id: "exp_123",
    variations: [{ name: "Control" }, { name: "Variant" }],
  }),
}));

jest.mock("back-end/src/util/integration", () => ({
  applyMetricOverrides: jest.fn(),
}));

jest.mock("back-end/src/models/QueryModel", () => ({
  createNewQuery: jest.fn(),
  createNewQueryFromCached: jest.fn(),
  getQueriesByIds: jest.fn(),
  getRecentQuery: jest.fn(),
  updateQuery: jest.fn(),
  countRunningQueries: jest.fn().mockResolvedValue(0),
}));

// Now import the module under test — after all mocks are in place.
import {
  ExperimentIncrementalRefreshQueryParams,
  ExperimentIncrementalRefreshQueryRunner,
} from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import { FactTableMap } from "back-end/src/models/FactTableModel";

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

/**
 * Builds a minimal mock context with jest.fn() stubs for all model
 * methods used by the incremental refresh query runner.
 */
function createMockContext(
  overrides: {
    setCurrentExecutionId?: jest.Mock;
    getByExperimentId?: jest.Mock;
    upsertByExperimentId?: jest.Mock;
  } = {},
): ApiReqContext {
  return {
    org: {
      id: "org_123",
      settings: {
        runHealthTrafficQuery: false,
        disablePrecomputedDimensions: false,
      },
    },
    permissions: {
      canRunExperimentQueries: jest.fn().mockReturnValue(true),
    },
    logger: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    },
    models: {
      segments: {
        getById: jest.fn().mockResolvedValue(null),
      },
      incrementalRefresh: {
        getByExperimentId:
          overrides.getByExperimentId ?? jest.fn().mockResolvedValue(null),
        setCurrentExecutionId:
          overrides.setCurrentExecutionId ??
          jest.fn().mockResolvedValue(undefined),
        upsertByExperimentId:
          overrides.upsertByExperimentId ??
          jest.fn().mockResolvedValue(undefined),
      },
    },
  } as unknown as ApiReqContext;
}

/**
 * Creates a mock integration with stubs for all methods used by the
 * incremental refresh query runner.
 */
function createMockIntegration(): SourceIntegrationInterface {
  return {
    datasource: {
      id: "ds_123",
      type: "bigquery",
      settings: {
        queries: {
          exposure: [
            {
              id: "exposure_1",
              name: "Exposure Query",
              query: "SELECT * FROM exposures",
              dimensions: [],
            },
          ],
        },
        pipelineSettings: {
          writeDataset: "test_dataset",
          writeDatabase: "test_db",
        },
      },
    },
    context: { org: { id: "org_123" } },
    generateTablePath: jest
      .fn()
      .mockImplementation((name: string) => `project.dataset.${name}`),
    getSourceProperties: jest.fn().mockReturnValue({
      queryLanguage: "sql",
      maxColumns: 100,
    }),
    getDropOldIncrementalUnitsQuery: jest
      .fn()
      .mockReturnValue("DROP TABLE IF EXISTS ..."),
    getCreateExperimentIncrementalUnitsQuery: jest
      .fn()
      .mockReturnValue("CREATE TABLE ..."),
    getUpdateExperimentIncrementalUnitsQuery: jest
      .fn()
      .mockReturnValue("INSERT INTO ..."),
    getAlterNewIncrementalUnitsQuery: jest
      .fn()
      .mockReturnValue("ALTER TABLE ..."),
    getMaxTimestampIncrementalUnitsQuery: jest
      .fn()
      .mockReturnValue("SELECT MAX(ts) ..."),
    getCreateMetricSourceTableQuery: jest
      .fn()
      .mockReturnValue("CREATE TABLE metrics ..."),
    getInsertMetricSourceDataQuery: jest
      .fn()
      .mockReturnValue("INSERT INTO metrics ..."),
    getMaxTimestampMetricSourceQuery: jest
      .fn()
      .mockReturnValue("SELECT MAX(ts) FROM metrics ..."),
    getIncrementalRefreshStatisticsQuery: jest
      .fn()
      .mockReturnValue("SELECT stats ..."),
    getDropMetricSourceCovariateTableQuery: jest
      .fn()
      .mockReturnValue("DROP TABLE covariate ..."),
    getCreateMetricSourceCovariateTableQuery: jest
      .fn()
      .mockReturnValue("CREATE TABLE covariate ..."),
    getInsertMetricSourceCovariateDataQuery: jest
      .fn()
      .mockReturnValue("INSERT INTO covariate ..."),
    getExperimentAggregateUnitsQuery: jest
      .fn()
      .mockReturnValue("SELECT agg ..."),
    runDropTableQuery: jest.fn().mockResolvedValue({ rows: [] }),
    runIncrementalWithNoOutputQuery: jest.fn().mockResolvedValue({ rows: [] }),
    runMaxTimestampQuery: jest.fn().mockResolvedValue({ rows: [] }),
    runIncrementalRefreshStatisticsQuery: jest
      .fn()
      .mockResolvedValue({ rows: [] }),
    runExperimentAggregateUnitsQuery: jest.fn().mockResolvedValue({ rows: [] }),
  } as unknown as SourceIntegrationInterface;
}

/**
 * Creates the default params for startExperimentIncrementalRefreshQueries.
 */
function createDefaultParams(
  overrides: Partial<ExperimentIncrementalRefreshQueryParams> = {},
): ExperimentIncrementalRefreshQueryParams {
  const snapshotSettings: ExperimentSnapshotSettings = {
    activationMetric: null,
    segment: "",
    exposureQueryId: "exposure_1",
    metricSettings: [
      {
        id: "met_1",
        computedSettings: {
          windowSettings: {
            type: "none" as const,
            windowUnit: "days",
            windowValue: 0,
            delayUnit: "hours",
            delayValue: 0,
          },
          properMetricType: "mean",
          regressionAdjustmentDays: 0,
          regressionAdjustmentEnabled: false,
          regressionAdjustmentReason: "",
        },
      },
    ],
    variations: [
      { id: "v0", weight: 0.5 },
      { id: "v1", weight: 0.5 },
    ],
    datasourceId: "ds_123",
    startDate: new Date("2025-01-01"),
    endDate: new Date("2025-02-01"),
    experimentId: "exp_123",
    goalMetrics: ["met_1"],
    secondaryMetrics: [],
    guardrailMetrics: [],
    regressionAdjustmentEnabled: false,
    queryFilter: "",
    skipPartialData: false,
    dimensions: [],
  } as unknown as ExperimentSnapshotSettings;

  const metricMap = new Map();
  metricMap.set("met_1", {
    id: "met_1",
    type: "fact",
    metricType: "mean",
    numerator: { factTableId: "ft_1", column: "value", filters: [] },
    datasource: "ds_123",
    name: "Test Metric",
    cappingSettings: { type: "" },
    windowSettings: { type: "none" },
  });

  const factTableMap: FactTableMap = new Map();
  factTableMap.set("ft_1", {
    id: "ft_1",
    name: "Test Fact Table",
    organization: "org_123",
    datasource: "ds_123",
    columns: [],
    filters: [],
    eventName: "",
    sql: "SELECT * FROM facts",
    userIdTypes: ["user_id"],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    tags: [],
    projects: [],
    owner: "",
    managedBy: "",
  } as unknown as FactTableMap extends Map<string, infer V> ? V : never);

  return {
    snapshotType: "standard" as const,
    snapshotSettings,
    variationNames: ["Control", "Variant"],
    metricMap,
    factTableMap,
    queryParentId: "snap_123",
    experimentId: "exp_123",
    experimentQueryMetadata: null,
    fullRefresh: true,
    incrementalRefreshStartTime: new Date("2025-01-15"),
    ...overrides,
  };
}

/**
 * Creates a startQuery mock that tracks all calls (including onSuccess/
 * onFailure callbacks) and returns query pointer stubs.
 */
function createStartQueryMock(): {
  startQuery: jest.Mock;
  getOnSuccessCallbacks: () => Map<
    string,
    ((rows: RowsType) => void | Promise<void>) | undefined
  >;
  getOnFailureCallbacks: () => Map<string, (() => void) | undefined>;
} {
  const onSuccessCallbacks = new Map<
    string,
    ((rows: RowsType) => void | Promise<void>) | undefined
  >();
  const onFailureCallbacks = new Map<string, (() => void) | undefined>();
  let queryCounter = 0;

  const startQuery = jest
    .fn()
    .mockImplementation(
      async (
        params: StartQueryParams<RowsType, ProcessedRowsType>,
      ): Promise<QueryPointer> => {
        const id = `qry_${queryCounter++}`;
        onSuccessCallbacks.set(params.name, params.onSuccess);
        onFailureCallbacks.set(params.name, params.onFailure);
        return {
          name: params.name,
          query: id,
          status: "running" as const,
        };
      },
    );

  return {
    startQuery,
    getOnSuccessCallbacks: () => onSuccessCallbacks,
    getOnFailureCallbacks: () => onFailureCallbacks,
  };
}

/**
 * Helper to build a snapshot stub for the query runner constructor.
 */
function createSnapshotStub(
  snapshotSettings: ExperimentSnapshotSettings,
): ExperimentSnapshotInterface {
  return {
    id: "snap_123",
    organization: "org_123",
    queries: [],
    runStarted: null,
    settings: snapshotSettings,
    analyses: [],
    type: "standard",
    report: undefined,
  } as unknown as ExperimentSnapshotInterface;
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe("ExperimentIncrementalRefreshQueryRunner", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------
  // Execution fence
  // -----------------------------------------------------------------
  describe("execution fence", () => {
    it("records the current execution id at the start of query setup", async () => {
      const setCurrentExecutionId = jest.fn().mockResolvedValue(undefined);
      const getByExperimentId = jest.fn().mockResolvedValue(null);
      const context = createMockContext({
        setCurrentExecutionId,
        getByExperimentId,
      });
      const integration = createMockIntegration();
      const params = createDefaultParams({ fullRefresh: true });
      const { startQuery } = createStartQueryMock();

      const runner = new ExperimentIncrementalRefreshQueryRunner(
        context,
        createSnapshotStub(params.snapshotSettings),
        integration,
        false,
      );
      runner.startQuery = startQuery;

      await runner.startQueries(params);

      expect(setCurrentExecutionId).toHaveBeenCalledWith("exp_123", "snap_123");
      expect(setCurrentExecutionId).toHaveBeenCalledTimes(1);
    });

    it("skips upsert in units max-timestamp onSuccess when execution id does not match", async () => {
      const setCurrentExecutionId = jest.fn().mockResolvedValue(undefined);
      const upsertByExperimentId = jest.fn().mockResolvedValue(undefined);
      const getByExperimentId = jest.fn().mockResolvedValue({
        currentExecutionId: "snap_other",
        experimentId: "exp_123",
        unitsMaxTimestamp: null,
        metricSources: [],
        metricCovariateSources: [],
      } as unknown as IncrementalRefreshInterface);

      const context = createMockContext({
        setCurrentExecutionId,
        getByExperimentId,
        upsertByExperimentId,
      });
      const integration = createMockIntegration();
      const params = createDefaultParams({ fullRefresh: true });
      const { startQuery, getOnSuccessCallbacks } = createStartQueryMock();

      const runner = new ExperimentIncrementalRefreshQueryRunner(
        context,
        createSnapshotStub(params.snapshotSettings),
        integration,
        false,
      );
      runner.startQuery = startQuery;

      await runner.startQueries(params);

      const callbacks = getOnSuccessCallbacks();
      const maxTimestampCb = callbacks.get("max_timestamp_snap_123");
      expect(maxTimestampCb).toBeDefined();

      await maxTimestampCb!([{ max_timestamp: "2025-01-20T00:00:00Z" }]);

      expect(upsertByExperimentId).not.toHaveBeenCalled();
    });

    it("proceeds with upsert in units max-timestamp onSuccess when execution id matches", async () => {
      const setCurrentExecutionId = jest.fn().mockResolvedValue(undefined);
      const upsertByExperimentId = jest.fn().mockResolvedValue(undefined);
      const getByExperimentId = jest.fn().mockResolvedValue({
        currentExecutionId: "snap_123",
        experimentId: "exp_123",
        unitsMaxTimestamp: new Date("2025-01-10"),
        metricSources: [],
        metricCovariateSources: [],
      } as unknown as IncrementalRefreshInterface);

      const context = createMockContext({
        setCurrentExecutionId,
        getByExperimentId,
        upsertByExperimentId,
      });
      const integration = createMockIntegration();
      const params = createDefaultParams({ fullRefresh: true });
      const { startQuery, getOnSuccessCallbacks } = createStartQueryMock();

      const runner = new ExperimentIncrementalRefreshQueryRunner(
        context,
        createSnapshotStub(params.snapshotSettings),
        integration,
        false,
      );
      runner.startQuery = startQuery;

      await runner.startQueries(params);

      const callbacks = getOnSuccessCallbacks();
      const maxTimestampCb = callbacks.get("max_timestamp_snap_123");
      expect(maxTimestampCb).toBeDefined();

      await maxTimestampCb!([{ max_timestamp: "2025-01-20T00:00:00Z" }]);

      expect(upsertByExperimentId).toHaveBeenCalledWith(
        "exp_123",
        expect.objectContaining({
          unitsTableFullName: expect.any(String),
          unitsMaxTimestamp: expect.any(Date),
          experimentSettingsHash: expect.any(String),
        }),
      );
    });

    it("skips upsert in metric-source max-timestamp onSuccess when execution id does not match", async () => {
      const setCurrentExecutionId = jest.fn().mockResolvedValue(undefined);
      const upsertByExperimentId = jest.fn().mockResolvedValue(undefined);
      const getByExperimentId = jest.fn().mockResolvedValue({
        currentExecutionId: "snap_other",
        experimentId: "exp_123",
        unitsMaxTimestamp: null,
        metricSources: [],
        metricCovariateSources: [],
      } as unknown as IncrementalRefreshInterface);

      const context = createMockContext({
        setCurrentExecutionId,
        getByExperimentId,
        upsertByExperimentId,
      });
      const integration = createMockIntegration();
      const params = createDefaultParams({ fullRefresh: true });
      const { startQuery, getOnSuccessCallbacks } = createStartQueryMock();

      const runner = new ExperimentIncrementalRefreshQueryRunner(
        context,
        createSnapshotStub(params.snapshotSettings),
        integration,
        false,
      );
      runner.startQuery = startQuery;

      await runner.startQueries(params);

      const callbacks = getOnSuccessCallbacks();
      let metricCb: ((rows: RowsType) => void | Promise<void>) | undefined;
      for (const [name, cb] of callbacks) {
        if (name.startsWith("max_timestamp_metrics_source_")) {
          metricCb = cb;
          break;
        }
      }
      expect(metricCb).toBeDefined();

      await metricCb!([{ max_timestamp: "2025-01-20T00:00:00Z" }]);

      expect(upsertByExperimentId).not.toHaveBeenCalled();
    });

    it("proceeds with upsert in metric-source max-timestamp onSuccess when execution id matches", async () => {
      const setCurrentExecutionId = jest.fn().mockResolvedValue(undefined);
      const upsertByExperimentId = jest.fn().mockResolvedValue(undefined);
      const getByExperimentId = jest.fn().mockResolvedValue({
        currentExecutionId: "snap_123",
        experimentId: "exp_123",
        unitsMaxTimestamp: new Date("2025-01-10"),
        metricSources: [],
        metricCovariateSources: [],
      } as unknown as IncrementalRefreshInterface);

      const context = createMockContext({
        setCurrentExecutionId,
        getByExperimentId,
        upsertByExperimentId,
      });
      const integration = createMockIntegration();
      const params = createDefaultParams({ fullRefresh: true });
      const { startQuery, getOnSuccessCallbacks } = createStartQueryMock();

      const runner = new ExperimentIncrementalRefreshQueryRunner(
        context,
        createSnapshotStub(params.snapshotSettings),
        integration,
        false,
      );
      runner.startQuery = startQuery;

      await runner.startQueries(params);

      const callbacks = getOnSuccessCallbacks();
      let metricCb: ((rows: RowsType) => void | Promise<void>) | undefined;
      for (const [name, cb] of callbacks) {
        if (name.startsWith("max_timestamp_metrics_source_")) {
          metricCb = cb;
          break;
        }
      }
      expect(metricCb).toBeDefined();

      await metricCb!([{ max_timestamp: "2025-01-20T00:00:00Z" }]);

      expect(upsertByExperimentId).toHaveBeenCalledWith(
        "exp_123",
        expect.objectContaining({
          metricSources: expect.any(Array),
        }),
      );
    });

    it("skips upsert in metric-source onFailure when execution id does not match", async () => {
      const setCurrentExecutionId = jest.fn().mockResolvedValue(undefined);
      const upsertByExperimentId = jest.fn().mockResolvedValue(undefined);
      const getByExperimentId = jest.fn().mockResolvedValue({
        currentExecutionId: "snap_other",
        experimentId: "exp_123",
        unitsMaxTimestamp: null,
        metricSources: [],
        metricCovariateSources: [],
      } as unknown as IncrementalRefreshInterface);

      const context = createMockContext({
        setCurrentExecutionId,
        getByExperimentId,
        upsertByExperimentId,
      });
      const integration = createMockIntegration();
      const params = createDefaultParams({ fullRefresh: true });
      const { startQuery, getOnFailureCallbacks } = createStartQueryMock();

      const runner = new ExperimentIncrementalRefreshQueryRunner(
        context,
        createSnapshotStub(params.snapshotSettings),
        integration,
        false,
      );
      runner.startQuery = startQuery;

      await runner.startQueries(params);

      const callbacks = getOnFailureCallbacks();
      let failureCb: (() => void) | undefined;
      for (const [name, cb] of callbacks) {
        if (name.startsWith("max_timestamp_metrics_source_")) {
          failureCb = cb;
          break;
        }
      }
      expect(failureCb).toBeDefined();

      await failureCb!();

      expect(upsertByExperimentId).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------
  // updateModel
  // -----------------------------------------------------------------
  describe("updateModel", () => {
    it("writes success status to the snapshot on succeeded", async () => {
      const context = createMockContext();
      const integration = createMockIntegration();
      const params = createDefaultParams();

      const runner = new ExperimentIncrementalRefreshQueryRunner(
        context,
        createSnapshotStub(params.snapshotSettings),
        integration,
        false,
      );

      const { updateSnapshot } = jest.requireMock(
        "back-end/src/models/ExperimentSnapshotModel",
      );

      const result = await runner.updateModel({
        status: "succeeded" as QueryStatus,
        queries: [] as Queries,
        runStarted: new Date(),
      });

      expect(updateSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          organization: "org_123",
          id: "snap_123",
          updates: expect.objectContaining({
            status: "success",
          }),
        }),
      );
      expect(result.status).toBe("success");
    });

    it("writes error status to the snapshot on failed", async () => {
      const context = createMockContext();
      const integration = createMockIntegration();
      const params = createDefaultParams();

      const runner = new ExperimentIncrementalRefreshQueryRunner(
        context,
        createSnapshotStub(params.snapshotSettings),
        integration,
        false,
      );

      const { updateSnapshot } = jest.requireMock(
        "back-end/src/models/ExperimentSnapshotModel",
      );

      const result = await runner.updateModel({
        status: "failed" as QueryStatus,
        queries: [] as Queries,
        error: "Something went wrong",
      });

      expect(updateSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          updates: expect.objectContaining({
            status: "error",
            error: "Something went wrong",
          }),
        }),
      );
      expect(result.status).toBe("error");
    });
  });

  // -----------------------------------------------------------------
  // Query setup — full refresh vs incremental
  // -----------------------------------------------------------------
  describe("query setup", () => {
    it("creates drop + create queries on full refresh", async () => {
      const context = createMockContext();
      const integration = createMockIntegration();
      const params = createDefaultParams({ fullRefresh: true });
      const { startQuery } = createStartQueryMock();

      const runner = new ExperimentIncrementalRefreshQueryRunner(
        context,
        createSnapshotStub(params.snapshotSettings),
        integration,
        false,
      );
      runner.startQuery = startQuery;

      await runner.startQueries(params);

      const queryNames = startQuery.mock.calls.map(
        (call: [StartQueryParams<RowsType, ProcessedRowsType>]) => call[0].name,
      );

      expect(queryNames).toContain("drop_snap_123_old");
      expect(queryNames).toContain("create_snap_123");
      expect(queryNames).toContain("update_snap_123");
      expect(queryNames).toContain("drop_snap_123");
      expect(queryNames).toContain("alter_snap_123");
      expect(queryNames).toContain("max_timestamp_snap_123");
    });

    it("omits drop + create queries on incremental (non-full) refresh", async () => {
      const getByExperimentId = jest.fn().mockResolvedValue({
        currentExecutionId: "snap_123",
        experimentId: "exp_123",
        unitsMaxTimestamp: new Date("2025-01-10"),
        experimentSettingsHash: "hash_experiment",
        unitsDimensions: [],
        metricSources: [],
        metricCovariateSources: [],
      } as unknown as IncrementalRefreshInterface);

      const context = createMockContext({ getByExperimentId });
      const integration = createMockIntegration();
      const params = createDefaultParams({ fullRefresh: false });
      const { startQuery } = createStartQueryMock();

      const runner = new ExperimentIncrementalRefreshQueryRunner(
        context,
        createSnapshotStub(params.snapshotSettings),
        integration,
        false,
      );
      runner.startQuery = startQuery;

      await runner.startQueries(params);

      const queryNames = startQuery.mock.calls.map(
        (call: [StartQueryParams<RowsType, ProcessedRowsType>]) => call[0].name,
      );

      // Incremental: no drop_old or create
      expect(queryNames).not.toContain("drop_snap_123_old");
      expect(queryNames).not.toContain("create_snap_123");

      // Should still have update, drop, alter, max_timestamp
      expect(queryNames).toContain("update_snap_123");
      expect(queryNames).toContain("drop_snap_123");
      expect(queryNames).toContain("alter_snap_123");
      expect(queryNames).toContain("max_timestamp_snap_123");
    });
  });
});
