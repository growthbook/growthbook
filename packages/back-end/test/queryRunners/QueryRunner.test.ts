import { Queries, QueryInterface, QueryStatus } from "shared/types/query";
import { ReqContext } from "back-end/types/request";
import {
  QueryRunner,
  QueryMap,
  InterfaceWithQueries,
  getQueryFailureError,
  getMetricAwareQueryStatus,
} from "back-end/src/queryRunners/QueryRunner";
import { TRAFFIC_QUERY_NAME } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { getUnitDimQueryName } from "back-end/src/queryRunners/unitDimensionQueryNaming";
import {
  getIncrementalCrossStatisticsQueryName,
  getIncrementalStatisticsQueryName,
} from "back-end/src/queryRunners/incrementalStatisticsQueryNaming";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import {
  countRunningQueries,
  createFailedQuery,
  createNewQuery,
  createNewQueryFromCached,
  getRecentQuery,
  getQueriesByIds,
  updateQuery,
} from "back-end/src/models/QueryModel";

jest.mock("back-end/src/models/QueryModel");

class TestQueryRunner extends QueryRunner<
  InterfaceWithQueries,
  object,
  { success: boolean }
> {
  checkPermissions() {
    return true;
  }

  async startQueries() {
    return [];
  }

  async runAnalysis() {
    return { success: true };
  }

  async getLatestModel() {
    return this.model;
  }

  async updateModel(_params: unknown) {
    return this.model;
  }

  public setQueuedQueryTimer(queryId: string, timer: NodeJS.Timeout) {
    // @ts-expect-error Setting private prop for testing
    this.pendingTimers[queryId] = timer;
  }

  public executeQuerySpy = jest.fn();

  async executeQuery(
    query: QueryInterface,
    {
      run,
      process,
      onFailure,
      onSuccess,
    }: {
      run: unknown;
      process?: unknown;
      onFailure: unknown;
      onSuccess?: unknown;
    },
  ) {
    this.executeQuerySpy(query, { run, process, onFailure, onSuccess });
    // Don't actually execute for tests
    return Promise.resolve();
  }
}

const createMockQuery = (
  id: string,
  status: QueryStatus,
  dependencies: string[] = [],
): QueryInterface => ({
  id,
  organization: "test-org",
  datasource: "test-ds",
  language: "sql",
  query: "SELECT 1",
  status,
  dependencies,
  createdAt: new Date(),
  heartbeat: new Date(),
  queryType: "",
});

const createMockIntegration = (): SourceIntegrationInterface => {
  return {
    datasource: {
      id: "test-ds",
      type: "postgres",
      settings: {
        maxConcurrentQueries: "5",
      },
    },
    context: {
      org: { id: "test-org" },
    },
    getSourceProperties: () => ({ queryLanguage: "sql" }),
  } as unknown as SourceIntegrationInterface;
};

const createMockContext = (): ReqContext => {
  return {
    org: { id: "test-org" },
    permissions: {
      canRunExperimentQueries: () => true,
      throwPermissionError: () => {
        throw new Error("Permission denied");
      },
    },
  } as unknown as ReqContext;
};

const makeFailedQueryMap = (
  ...entries: [string, { id: string; error?: string }][]
): QueryMap => {
  const map: QueryMap = new Map();
  for (const [name, { id, error }] of entries) {
    map.set(name, {
      ...createMockQuery(id, "failed"),
      ...(error ? { error } : {}),
    });
  }
  return map;
};

describe("getQueryFailureError", () => {
  it("prefers a root-cause error over a dependency cascade", () => {
    const error = getQueryFailureError(
      makeFailedQueryMap(
        ["insert", { id: "q1", error: "Syntax error: bad SQL" }],
        ["coverage", { id: "q2", error: "Dependencies failed: q1" }],
      ),
    );
    expect(error).toBe("Syntax error: bad SQL");
  });

  it("falls back to the first failed query when all errors are cascades", () => {
    const error = getQueryFailureError(
      makeFailedQueryMap(
        ["b", { id: "q2", error: "Dependencies failed: q1" }],
        ["a", { id: "q1", error: "Dependencies failed: q0" }],
      ),
    );
    expect(error).toBe("Dependencies failed: q1");
  });

  it("returns the generic message when no failed query has an error", () => {
    const error = getQueryFailureError(makeFailedQueryMap(["a", { id: "q1" }]));
    expect(error).toBe("Failed to run the database queries for this analysis");
  });
});

describe("getMetricAwareQueryStatus", () => {
  const SNAPSHOT_ID = "snp_1";

  const pointer = (
    name: string,
    status: QueryStatus,
    metrics?: string[],
    metricScope?: "primary" | "dimension",
    metricScopeId?: string,
  ): Queries[number] => ({
    query: `qry_${name}`,
    name,
    status,
    metrics,
    metricScope,
    metricScopeId,
  });

  it("analyzes survivors when a majority of metric queries failed", () => {
    const status = getMetricAwareQueryStatus([
      pointer("query_a", "failed", ["met_a"]),
      pointer("query_b", "failed", ["met_b"]),
      pointer("query_c", "failed", ["met_c"]),
      pointer("query_d", "succeeded", ["met_d"]),
    ]);
    // The old rule (>= half failed) would have returned "failed" and skipped
    // analysis entirely, discarding met_d's results.
    expect(status).toBe("partially-succeeded");
  });

  it("fails only when no metric query survived", () => {
    const status = getMetricAwareQueryStatus([
      pointer("query_a", "failed", ["met_a"]),
      pointer("query_b", "failed", ["met_b"]),
    ]);
    expect(status).toBe("failed");
  });

  it("does not fail when only the traffic query failed", () => {
    const status = getMetricAwareQueryStatus([
      pointer("query_a", "succeeded", ["met_a"]),
      pointer(TRAFFIC_QUERY_NAME, "failed"),
    ]);
    expect(status).toBe("partially-succeeded");
  });

  it("does not fail when only the shared units table and its drop failed", () => {
    // These own no metric results directly; dependent metric queries cascade
    // and are counted as metric failures in their own right.
    const status = getMetricAwareQueryStatus([
      pointer("query_a", "succeeded", ["met_a"]),
      pointer(SNAPSHOT_ID, "failed"),
      pointer(`drop_${SNAPSHOT_ID}`, "failed"),
    ]);
    expect(status).toBe("partially-succeeded");
  });

  it("ignores unit-dimension queries, which belong to their own analyses", () => {
    const status = getMetricAwareQueryStatus([
      pointer("query_a", "succeeded", ["met_a"]),
      pointer(
        getUnitDimQueryName("dim_1", "met_a"),
        "failed",
        ["met_a"],
        "dimension",
        "dim_1",
      ),
    ]);
    expect(status).toBe("partially-succeeded");
  });

  it("waits while any query is still in flight", () => {
    const status = getMetricAwareQueryStatus([
      pointer("query_a", "failed", ["met_a"]),
      pointer("query_b", "running", ["met_b"]),
    ]);
    expect(status).toBe("running");
  });

  it("reports success when nothing failed", () => {
    const status = getMetricAwareQueryStatus([
      pointer("query_a", "succeeded", ["met_a"]),
      pointer(TRAFFIC_QUERY_NAME, "succeeded"),
    ]);
    expect(status).toBe("succeeded");
  });

  const statsA = getIncrementalStatisticsQueryName("ft_1_ab12340");
  const statsB = getIncrementalStatisticsQueryName("ft_2_ab12341");
  const statsCross = getIncrementalCrossStatisticsQueryName(
    "ft_1_ab12340",
    "ft_2_ab12341",
  );

  it("fails when every statistics query failed, even though the pipeline queries succeeded", () => {
    // The base 50% rule returned "partially-succeeded" here, so analysis ran
    // with no metric data and the snapshot carried no explanation.
    const status = getMetricAwareQueryStatus([
      pointer("create_metrics_source_ft_1_ab12340", "succeeded"),
      pointer("insert_metrics_source_data_ft_1_ab12340", "succeeded"),
      pointer("max_timestamp_metrics_source_ft_1_ab12340", "succeeded"),
      pointer(statsA, "failed", ["met_a"]),
    ]);
    expect(status).toBe("failed");
  });

  it("analyzes survivors when one statistics query of several failed", () => {
    const status = getMetricAwareQueryStatus([
      pointer(statsA, "failed", ["met_a"]),
      pointer(statsB, "succeeded", ["met_b"]),
      pointer(statsCross, "failed", ["met_c"]),
    ]);
    expect(status).toBe("partially-succeeded");
  });

  it("does not fail when only an infrastructure query failed", () => {
    const status = getMetricAwareQueryStatus([
      pointer(statsA, "succeeded", ["met_a"]),
      pointer("drop_metrics_covariate_table_ft_1_ab12340", "failed"),
    ]);
    expect(status).toBe("partially-succeeded");
  });

  it("waits while any query is still in flight", () => {
    const status = getMetricAwareQueryStatus([
      pointer(statsA, "failed", ["met_a"]),
      pointer(statsB, "running", ["met_b"]),
    ]);
    expect(status).toBe("running");
  });

  it("reports success when nothing failed", () => {
    const status = getMetricAwareQueryStatus([
      pointer(statsA, "succeeded", ["met_a"]),
      pointer("insert_metrics_source_data_ft_1_ab12340", "succeeded"),
    ]);
    expect(status).toBe("succeeded");
  });

  it("returns null for legacy pointers without ownership metadata", () => {
    expect(
      getMetricAwareQueryStatus([pointer("legacy_metric", "succeeded")]),
    ).toBeNull();
  });

  it("evaluates one unit-dimension scope independently", () => {
    expect(
      getMetricAwareQueryStatus(
        [
          pointer(
            "unitdim:country:met_a",
            "failed",
            ["met_a"],
            "dimension",
            "country",
          ),
          pointer(
            "unitdim:browser:met_a",
            "succeeded",
            ["met_a"],
            "dimension",
            "browser",
          ),
        ],
        "dimension",
        "country",
      ),
    ).toBe("failed");
  });
});

describe("startQuery build-time isolation", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("records a terminal failed query when the SQL builder throws, instead of escaping", async () => {
    const model: InterfaceWithQueries = {
      id: "test-model",
      organization: "test-org",
      queries: [],
      runStarted: new Date(),
    };
    const runner = new TestQueryRunner(
      createMockContext(),
      model,
      createMockIntegration(),
    );

    (createFailedQuery as jest.Mock).mockResolvedValue({ id: "qry_failed" });

    const pointer = await runner.startQuery({
      name: "met_bad",
      metrics: ["met_bad"],
      query: () => {
        throw new Error("Unknown fact table");
      },
      dependencies: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      run: jest.fn() as any,
      queryType: "experimentMetric",
    });

    expect(pointer).toEqual({
      name: "met_bad",
      query: "qry_failed",
      status: "failed",
      error: "Failed to build query: Unknown fact table",
      metrics: ["met_bad"],
      metricScope: undefined,
      metricScopeId: undefined,
    });
    // The failure is persisted as a terminal failed Query doc, never executed.
    expect(createFailedQuery as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Failed to build query: Unknown fact table",
        queryType: "experimentMetric",
        organization: "test-org",
        datasource: "test-ds",
      }),
    );
    expect(runner.executeQuerySpy).not.toHaveBeenCalled();
  });

  it("preserves metric ownership on a cached query pointer", async () => {
    const runner = new TestQueryRunner(
      createMockContext(),
      {
        id: "test-model",
        organization: "test-org",
        queries: [],
        runStarted: new Date(),
      },
      createMockIntegration(),
    );
    (getRecentQuery as jest.Mock).mockResolvedValue(
      createMockQuery("qry_cached", "succeeded"),
    );
    (createNewQueryFromCached as jest.Mock).mockResolvedValue(
      createMockQuery("qry_copy", "succeeded"),
    );

    const pointer = await runner.startQuery({
      name: "unitdim:country:group_0",
      metrics: ["met_a", "met_b"],
      metricScope: "dimension",
      metricScopeId: "country",
      query: "SELECT 1",
      dependencies: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      run: jest.fn() as any,
      queryType: "experimentMultiMetric",
    });

    expect(pointer).toEqual({
      name: "unitdim:country:group_0",
      query: "qry_copy",
      status: "succeeded",
      metrics: ["met_a", "met_b"],
      metricScope: "dimension",
      metricScopeId: "country",
    });
  });

  it("preserves metric ownership on a fresh query pointer", async () => {
    const runner = new TestQueryRunner(
      createMockContext(),
      {
        id: "test-model",
        organization: "test-org",
        queries: [],
        runStarted: new Date(),
      },
      createMockIntegration(),
      false,
    );
    (countRunningQueries as jest.Mock).mockResolvedValue(0);
    (createNewQuery as jest.Mock).mockResolvedValue(
      createMockQuery("qry_fresh", "running"),
    );

    const pointer = await runner.startQuery({
      name: "statistics_group_0",
      metrics: ["met_a"],
      query: "SELECT 1",
      dependencies: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      run: jest.fn() as any,
      queryType: "experimentIncrementalRefreshStatistics",
    });

    expect(pointer).toEqual({
      name: "statistics_group_0",
      query: "qry_fresh",
      status: "running",
      metrics: ["met_a"],
      metricScope: undefined,
      metricScopeId: undefined,
    });
  });
});

describe("QueryRunner", () => {
  describe("startReadyQueries", () => {
    let mockContext: ReqContext;
    let mockIntegration: SourceIntegrationInterface;

    beforeEach(() => {
      mockContext = createMockContext();
      mockIntegration = createMockIntegration();
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it("should process all queued queries even when some have existing timers", async () => {
      const queryA = createMockQuery("qry_A", "queued", []);
      const queryB = createMockQuery("qry_B", "queued", []);
      const queryC = createMockQuery("qry_C", "queued", []);

      const model: InterfaceWithQueries = {
        id: "test-model",
        organization: "test-org",
        queries: [
          { name: "A", query: "qry_A", status: "queued" },
          { name: "B", query: "qry_B", status: "queued" },
          { name: "C", query: "qry_C", status: "queued" },
        ],
        runStarted: new Date(),
      };

      const runner = new TestQueryRunner(mockContext, model, mockIntegration);

      const timerA = setTimeout(() => {}, 10000);
      runner.setQueuedQueryTimer("qry_A", timerA);

      const mockRun = jest.fn().mockResolvedValue({ rows: [], statistics: {} });
      const mockProcess = jest.fn((rows) => rows);
      const mockFailure = jest.fn();

      runner.runCallbacks["qry_A"] = {
        run: mockRun,
        process: mockProcess,
        onFailure: mockFailure,
      };
      runner.runCallbacks["qry_B"] = {
        run: mockRun,
        process: mockProcess,
        onFailure: mockFailure,
      };
      runner.runCallbacks["qry_C"] = {
        run: mockRun,
        process: mockProcess,
        onFailure: mockFailure,
      };

      const queryMap: QueryMap = new Map([
        ["A", queryA],
        ["B", queryB],
        ["C", queryC],
      ]);

      await runner.startReadyQueries(queryMap);

      // Query A should NOT execute (has timer)
      expect(runner.executeQuerySpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: "qry_A" }),
        expect.objectContaining({
          run: expect.any(Function),
          process: expect.any(Function),
          onFailure: expect.any(Function),
        }),
      );

      // Query B SHOULD execute (no timer, no dependencies)
      expect(runner.executeQuerySpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "qry_B" }),
        expect.objectContaining({
          run: expect.any(Function),
          process: expect.any(Function),
          onFailure: expect.any(Function),
        }),
      );

      // Query C SHOULD execute (no timer, no dependencies)
      expect(runner.executeQuerySpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "qry_C" }),
        expect.objectContaining({
          run: expect.any(Function),
          process: expect.any(Function),
          onFailure: expect.any(Function),
        }),
      );

      // Clean up timer
      clearTimeout(timerA);
    });

    it("processes ready non-runAtEnd queries even when a runAtEnd query is iterated first", async () => {
      const queryEnd = createMockQuery("qry_end", "queued", []);
      queryEnd.runAtEnd = true;
      const queryB = createMockQuery("qry_B", "queued", []);

      const model: InterfaceWithQueries = {
        id: "test-model",
        organization: "test-org",
        queries: [
          { name: "end", query: "qry_end", status: "queued" },
          { name: "B", query: "qry_B", status: "queued" },
        ],
        runStarted: new Date(),
      };

      const runner = new TestQueryRunner(mockContext, model, mockIntegration);

      const cb = {
        run: jest.fn().mockResolvedValue({ rows: [], statistics: {} }),
        process: jest.fn((rows) => rows),
        onFailure: jest.fn(),
      };
      runner.runCallbacks["qry_end"] = cb;
      runner.runCallbacks["qry_B"] = cb;

      const queryMap: QueryMap = new Map([
        ["end", queryEnd],
        ["B", queryB],
      ]);

      await runner.startReadyQueries(queryMap);

      expect(runner.executeQuerySpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: "qry_end" }),
        expect.anything(),
      );
      expect(runner.executeQuerySpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "qry_B" }),
        expect.anything(),
      );
    });

    it("should not execute queries with pending dependencies", async () => {
      const depPending = createMockQuery("qry_dep_pending", "running", []);
      const queryA = createMockQuery("qry_A", "queued", ["qry_dep_pending"]);

      const model: InterfaceWithQueries = {
        id: "test-model",
        organization: "test-org",
        queries: [
          { name: "dep_pending", query: "qry_dep_pending", status: "running" },
          { name: "A", query: "qry_A", status: "queued" },
        ],
        runStarted: new Date(),
      };

      const runner = new TestQueryRunner(mockContext, model, mockIntegration);

      runner.runCallbacks["qry_A"] = {
        run: jest.fn().mockResolvedValue({ rows: [], statistics: {} }),
        process: jest.fn((rows) => rows),
        onFailure: jest.fn(),
      };

      const queryMap: QueryMap = new Map([
        ["dep_pending", depPending],
        ["A", queryA],
      ]);

      await runner.startReadyQueries(queryMap);

      // Query A should NOT execute (dependency is still running)
      expect(runner.executeQuerySpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: "qry_A" }),
        expect.objectContaining({
          run: expect.any(Function),
          process: expect.any(Function),
          onFailure: expect.any(Function),
        }),
      );
    });

    it("should mark queries as failed when dependencies fail", async () => {
      const depFailed = createMockQuery("qry_dep_failed", "failed", []);
      const queryA = createMockQuery("qry_A", "queued", ["qry_dep_failed"]);

      const model: InterfaceWithQueries = {
        id: "test-model",
        organization: "test-org",
        queries: [
          { name: "dep_failed", query: "qry_dep_failed", status: "failed" },
          { name: "A", query: "qry_A", status: "queued" },
        ],
        runStarted: new Date(),
      };

      const runner = new TestQueryRunner(mockContext, model, mockIntegration);

      runner.runCallbacks["qry_A"] = {
        run: jest.fn().mockResolvedValue({ rows: [], statistics: {} }),
        process: jest.fn((rows) => rows),
        onFailure: jest.fn(),
      };

      const queryMap: QueryMap = new Map([
        ["dep_failed", depFailed],
        ["A", queryA],
      ]);

      await runner.startReadyQueries(queryMap);

      // Query A should be marked as failed
      expect(updateQuery).toHaveBeenCalledWith(
        mockContext,
        expect.objectContaining({ id: "qry_A" }),
        expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("Dependencies failed"),
        }),
      );

      // Query A should NOT execute
      expect(runner.executeQuerySpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: "qry_A" }),
        expect.objectContaining({
          run: expect.any(Function),
          process: expect.any(Function),
          onFailure: expect.any(Function),
          onSuccess: expect.any(Function),
        }),
      );
    });

    it("should execute queries when all dependencies succeed", async () => {
      const depSucceeded = createMockQuery("qry_dep_ok", "succeeded", []);
      const queryA = createMockQuery("qry_A", "queued", ["qry_dep_ok"]);

      const model: InterfaceWithQueries = {
        id: "test-model",
        organization: "test-org",
        queries: [
          { name: "dep_ok", query: "qry_dep_ok", status: "succeeded" },
          { name: "A", query: "qry_A", status: "queued" },
        ],
        runStarted: new Date(),
      };

      const runner = new TestQueryRunner(mockContext, model, mockIntegration);

      runner.runCallbacks["qry_A"] = {
        run: jest.fn().mockResolvedValue({ rows: [], statistics: {} }),
        process: jest.fn((rows) => rows),
        onFailure: jest.fn(),
      };

      const queryMap: QueryMap = new Map([
        ["dep_ok", depSucceeded],
        ["A", queryA],
      ]);

      await runner.startReadyQueries(queryMap);

      // Query A SHOULD execute (dependency succeeded)
      expect(runner.executeQuerySpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "qry_A" }),
        expect.objectContaining({
          run: expect.any(Function),
          process: expect.any(Function),
          onFailure: expect.any(Function),
        }),
      );
    });

    it("should handle multiple queries with mixed dependency states", async () => {
      const depOk = createMockQuery("qry_dep_ok", "succeeded", []);
      const depPending = createMockQuery("qry_dep_pending", "running", []);
      const depFailed = createMockQuery("qry_dep_failed", "failed", []);

      const queryA = createMockQuery("qry_A", "queued", ["qry_dep_ok"]);
      const queryB = createMockQuery("qry_B", "queued", ["qry_dep_pending"]);
      const queryC = createMockQuery("qry_C", "queued", ["qry_dep_failed"]);
      const queryD = createMockQuery("qry_D", "queued", []); // No dependencies

      const model: InterfaceWithQueries = {
        id: "test-model",
        organization: "test-org",
        queries: [
          { name: "dep_ok", query: "qry_dep_ok", status: "succeeded" },
          { name: "dep_pending", query: "qry_dep_pending", status: "running" },
          { name: "dep_failed", query: "qry_dep_failed", status: "failed" },
          { name: "A", query: "qry_A", status: "queued" },
          { name: "B", query: "qry_B", status: "queued" },
          { name: "C", query: "qry_C", status: "queued" },
          { name: "D", query: "qry_D", status: "queued" },
        ],
        runStarted: new Date(),
      };

      const runner = new TestQueryRunner(mockContext, model, mockIntegration);

      const mockRun = jest.fn().mockResolvedValue({ rows: [], statistics: {} });
      const mockProcess = jest.fn((rows) => rows);
      const mockFailure = jest.fn();

      runner.runCallbacks["qry_A"] = {
        run: mockRun,
        process: mockProcess,
        onFailure: mockFailure,
      };
      runner.runCallbacks["qry_B"] = {
        run: mockRun,
        process: mockProcess,
        onFailure: mockFailure,
      };
      runner.runCallbacks["qry_C"] = {
        run: mockRun,
        process: mockProcess,
        onFailure: mockFailure,
      };
      runner.runCallbacks["qry_D"] = {
        run: mockRun,
        process: mockProcess,
        onFailure: mockFailure,
      };

      const queryMap: QueryMap = new Map([
        ["dep_ok", depOk],
        ["dep_pending", depPending],
        ["dep_failed", depFailed],
        ["A", queryA],
        ["B", queryB],
        ["C", queryC],
        ["D", queryD],
      ]);

      await runner.startReadyQueries(queryMap);

      // Query A should execute (dependency succeeded)
      expect(runner.executeQuerySpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "qry_A" }),
        expect.objectContaining({
          run: expect.any(Function),
          process: expect.any(Function),
          onFailure: expect.any(Function),
        }),
      );

      // Query B should NOT execute (dependency pending)
      expect(runner.executeQuerySpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: "qry_B" }),
        expect.objectContaining({
          run: expect.any(Function),
          process: expect.any(Function),
          onFailure: expect.any(Function),
        }),
      );

      // Query C should be marked failed (dependency failed)
      expect(updateQuery).toHaveBeenCalledWith(
        mockContext,
        expect.objectContaining({ id: "qry_C" }),
        expect.objectContaining({ status: "failed" }),
      );

      // Query D should execute (no dependencies)
      expect(runner.executeQuerySpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "qry_D" }),
        expect.objectContaining({
          run: expect.any(Function),
          process: expect.any(Function),
          onFailure: expect.any(Function),
        }),
      );
    });
  });

  describe("startAnalysis", () => {
    let mockContext: ReqContext;
    let mockIntegration: SourceIntegrationInterface;

    beforeEach(() => {
      mockContext = createMockContext();
      mockIntegration = createMockIntegration();
      // getQueryMap() calls getQueriesByIds() to hydrate cached-query results.
      // The auto-mock returns undefined; make it return an empty array so the
      // cached path in startAnalysis() is exercisable without real DB access.
      (getQueriesByIds as jest.Mock).mockResolvedValue([]);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    class RaceTestQueryRunner extends QueryRunner<
      InterfaceWithQueries,
      { pointers: Queries },
      { success: boolean }
    > {
      public persistedQueries: Queries = [];
      public updateModelSpy = jest.fn();
      public onQueryFinishSpy = jest.fn();
      public runAnalysisSpy = jest.fn();

      checkPermissions() {
        return true;
      }

      async startQueries(params: { pointers: Queries }) {
        return params.pointers;
      }

      async runAnalysis() {
        this.runAnalysisSpy();
        return { success: true };
      }

      // Simulates reading the model from the database: returns whatever has
      // been persisted via updateModel(), not the in-memory copy.
      async getLatestModel() {
        return {
          ...this.model,
          queries: this.persistedQueries,
        };
      }

      async updateModel(params: {
        status: QueryStatus;
        queries: Queries;
      }): Promise<InterfaceWithQueries> {
        this.updateModelSpy(params);
        this.persistedQueries = params.queries;
        return { ...this.model, queries: params.queries };
      }

      async onQueryFinish() {
        this.onQueryFinishSpy(this.persistedQueries.length);
        return super.onQueryFinish();
      }
    }

    it("gates onQueryFinish until the query DAG is persisted, then drives once", async () => {
      jest.useFakeTimers();
      try {
        const model: InterfaceWithQueries = {
          id: "test-model",
          organization: "test-org",
          queries: [],
          runStarted: new Date(),
        };
        const runner = new RaceTestQueryRunner(
          mockContext,
          model,
          mockIntegration,
        );

        await runner.onQueryFinish();
        expect(jest.getTimerCount()).toBe(0);
        expect(runner.onQueryFinishSpy).toHaveBeenLastCalledWith(0);

        const pointers: Queries = [
          { name: "drop_old", query: "qry_drop", status: "running" },
          { name: "create", query: "qry_create", status: "queued" },
        ];

        await runner.startAnalysis({ pointers });

        expect(runner.updateModelSpy).toHaveBeenCalledWith(
          expect.objectContaining({ status: "running", queries: pointers }),
        );
        expect(runner.onQueryFinishSpy).toHaveBeenLastCalledWith(
          pointers.length,
        );
        expect(jest.getTimerCount()).toBeGreaterThan(0);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it("does not re-arm the timer when queries are already finished (cached)", async () => {
      jest.useFakeTimers();
      try {
        const model: InterfaceWithQueries = {
          id: "test-model",
          organization: "test-org",
          queries: [],
          runStarted: new Date(),
        };
        const runner = new RaceTestQueryRunner(
          mockContext,
          model,
          mockIntegration,
        );

        const pointers: Queries = [
          { name: "a", query: "qry_a", status: "succeeded" },
          { name: "b", query: "qry_b", status: "succeeded" },
        ];

        await runner.startAnalysis({ pointers });

        // Runner should be finished (analysis ran synchronously on cached
        // results) and no follow-up refresh should have been scheduled.
        expect(runner.status).toBe("finished");
        expect(runner.onQueryFinishSpy).not.toHaveBeenCalled();
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it("analyzes cached partial results immediately", async () => {
      const model: InterfaceWithQueries = {
        id: "test-model",
        organization: "test-org",
        queries: [],
        runStarted: new Date(),
      };
      const runner = new RaceTestQueryRunner(
        mockContext,
        model,
        mockIntegration,
      );
      const pointers: Queries = [
        { name: "a", query: "qry_a", status: "failed" },
        { name: "b", query: "qry_b", status: "succeeded" },
        { name: "c", query: "qry_c", status: "succeeded" },
      ];

      await runner.startAnalysis({ pointers });

      expect(runner.runAnalysisSpy).toHaveBeenCalledTimes(1);
      expect(runner.updateModelSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "partially-succeeded",
          result: { success: true },
        }),
      );
    });

    class FailingAnalysisQueryRunner extends RaceTestQueryRunner {
      async runAnalysis(): Promise<{ success: boolean }> {
        throw new Error("stats engine blew up");
      }

      async onQueryFinish() {}
    }

    it("persists a failed status when analysis throws on cached results", async () => {
      const model: InterfaceWithQueries = {
        id: "test-model",
        organization: "test-org",
        queries: [],
        runStarted: new Date(),
      };
      const runner = new FailingAnalysisQueryRunner(
        mockContext,
        model,
        mockIntegration,
      );

      const pointers: Queries = [
        { name: "a", query: "qry_a", status: "succeeded" },
        { name: "b", query: "qry_b", status: "succeeded" },
      ];

      await runner.startAnalysis({ pointers });

      expect(runner.updateModelSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("stats engine blew up"),
        }),
      );
      expect(runner.status).toBe("finished");
      await expect(runner.waitForResults()).rejects.toThrow(
        "stats engine blew up",
      );
    });

    it("persists a failed status when analysis throws after queries finish", async () => {
      const pointers: Queries = [
        { name: "a", query: "qry_a", status: "running" },
      ];
      const model: InterfaceWithQueries = {
        id: "test-model",
        organization: "test-org",
        queries: [],
        runStarted: new Date(),
      };
      const runner = new FailingAnalysisQueryRunner(
        mockContext,
        model,
        mockIntegration,
      );

      await runner.startAnalysis({ pointers });
      expect(runner.status).toBe("running");
      runner.updateModelSpy.mockClear();

      const succeededQuery = createMockQuery("qry_a", "succeeded");
      (getQueriesByIds as jest.Mock).mockResolvedValue([succeededQuery]);

      await runner.refreshQueryStatuses();

      expect(runner.updateModelSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("stats engine blew up"),
        }),
      );
      expect(runner.status).toBe("finished");
      await expect(runner.waitForResults()).rejects.toThrow(
        "stats engine blew up",
      );
    });

    class CascadeFailureQueryRunner extends RaceTestQueryRunner {
      async onQueryFinish() {}
    }

    // Reproduces the swallowed-error bug in the aggregated fact table pipeline.
    // A multi-query DAG (insert + a dependent coverage query) fails when the
    // insert hits invalid SQL. The first refresh flips the runner to failed; a
    // later refresh observes the dependent query cascading to failed while the
    // runner is ALREADY failed. The error must be reported on every failed
    // refresh — and must be the real query error — otherwise a model that
    // persists `error ?? null` writes null over the recorded failure.
    it("reports the real failing query error on every failed refresh, even a cascade", async () => {
      const model: InterfaceWithQueries = {
        id: "test-model",
        organization: "test-org",
        queries: [],
        runStarted: new Date(),
      };
      const runner = new CascadeFailureQueryRunner(
        mockContext,
        model,
        mockIntegration,
      );

      await runner.startAnalysis({
        pointers: [
          { name: "insert", query: "qry_insert", status: "running" },
          { name: "coverage", query: "qry_coverage", status: "queued" },
        ],
      });
      expect(runner.status).toBe("running");
      runner.updateModelSpy.mockClear();

      const insertFailed: QueryInterface = {
        ...createMockQuery("qry_insert", "failed"),
        error: "Syntax error: unexpected keyword INSERT",
      };

      (getQueriesByIds as jest.Mock).mockResolvedValue([
        insertFailed,
        createMockQuery("qry_coverage", "queued", ["qry_insert"]),
      ]);
      await runner.refreshQueryStatuses();

      (getQueriesByIds as jest.Mock).mockResolvedValue([
        insertFailed,
        {
          ...createMockQuery("qry_coverage", "failed", ["qry_insert"]),
          error: "Dependencies failed: qry_insert",
        },
      ]);
      await runner.refreshQueryStatuses();

      const failedCalls = runner.updateModelSpy.mock.calls
        .map((c) => c[0])
        .filter((p) => p.status === "failed");
      expect(failedCalls.length).toBeGreaterThanOrEqual(2);
      for (const call of failedCalls) {
        expect(call.error).toContain("unexpected keyword INSERT");
      }
    });
  });

  describe("onHeartbeat lifecycle", () => {
    let mockContext: ReqContext;
    let mockIntegration: SourceIntegrationInterface;

    beforeEach(() => {
      mockContext = createMockContext();
      mockIntegration = createMockIntegration();
      (getQueriesByIds as jest.Mock).mockResolvedValue([]);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    // Drives the runner into the "running" state with a DAG that still has
    // queued/running queries, but never actually executes any query (no
    // executeQuery, no per-query timers). onQueryFinish is neutralized so the
    // only timer in play is the runner-level heartbeat interval. This isolates
    // the guarantee in question: the lock heartbeat must keep firing for the
    // whole time the runner is "running" — including the gaps between
    // sequentially-dependent queries when no single query is executing.
    class HeartbeatTestQueryRunner extends QueryRunner<
      InterfaceWithQueries,
      { pointers: Queries },
      { success: boolean }
    > {
      public onHeartbeatSpy = jest.fn();

      checkPermissions() {
        return true;
      }

      async startQueries(params: { pointers: Queries }) {
        return params.pointers;
      }

      async runAnalysis() {
        return { success: true };
      }

      async getLatestModel() {
        return this.model;
      }

      async updateModel(params: {
        status: QueryStatus;
        queries: Queries;
      }): Promise<InterfaceWithQueries> {
        return { ...this.model, queries: params.queries };
      }

      // Neutralize the per-query follow-up timer so the heartbeat interval is
      // the only thing the fake clock advances.
      async onQueryFinish() {}

      protected override onHeartbeat(): void {
        this.onHeartbeatSpy();
      }
    }

    const runningPointers: Queries = [
      { name: "drop_old", query: "qry_drop", status: "running" },
      { name: "create", query: "qry_create", status: "queued" },
    ];

    it("fires onHeartbeat every ~30s while running even when no query is executing", async () => {
      jest.useFakeTimers();
      try {
        const runner = new HeartbeatTestQueryRunner(
          mockContext,
          {
            id: "test-model",
            organization: "test-org",
            queries: [],
            runStarted: new Date(),
          },
          mockIntegration,
        );

        await runner.startAnalysis({ pointers: runningPointers });

        expect(runner.status).toBe("running");
        // Not yet — interval hasn't elapsed.
        expect(runner.onHeartbeatSpy).toHaveBeenCalledTimes(0);

        jest.advanceTimersByTime(30000);
        expect(runner.onHeartbeatSpy).toHaveBeenCalledTimes(1);

        // Spans the inter-query gap: still firing with zero query activity.
        jest.advanceTimersByTime(60000);
        expect(runner.onHeartbeatSpy).toHaveBeenCalledTimes(3);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it("stops firing onHeartbeat once the runner finishes", async () => {
      jest.useFakeTimers();
      try {
        const runner = new HeartbeatTestQueryRunner(
          mockContext,
          {
            id: "test-model",
            organization: "test-org",
            queries: [],
            runStarted: new Date(),
          },
          mockIntegration,
        );

        await runner.startAnalysis({ pointers: runningPointers });
        jest.advanceTimersByTime(30000);
        expect(runner.onHeartbeatSpy).toHaveBeenCalledTimes(1);

        await runner.cancelQueries();
        expect(runner.status).toBe("finished");

        // Interval must be cleared — no further beats no matter how long we wait.
        jest.advanceTimersByTime(120000);
        expect(runner.onHeartbeatSpy).toHaveBeenCalledTimes(1);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it("never starts the heartbeat when the runner finishes immediately (cached)", async () => {
      jest.useFakeTimers();
      try {
        const runner = new HeartbeatTestQueryRunner(
          mockContext,
          {
            id: "test-model",
            organization: "test-org",
            queries: [],
            runStarted: new Date(),
          },
          mockIntegration,
        );

        await runner.startAnalysis({
          pointers: [
            { name: "a", query: "qry_a", status: "succeeded" },
            { name: "b", query: "qry_b", status: "succeeded" },
          ],
        });

        expect(runner.status).toBe("finished");
        jest.advanceTimersByTime(120000);
        expect(runner.onHeartbeatSpy).toHaveBeenCalledTimes(0);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });
  });
});
