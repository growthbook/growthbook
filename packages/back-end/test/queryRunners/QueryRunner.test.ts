import { Queries, QueryInterface, QueryStatus } from "shared/types/query";
import { QueryRunnerRunParentType } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import {
  QueryRunner,
  QueryMap,
  InterfaceWithQueries,
  assertQueryMapComplete,
  rollupQueryStatus,
  getQueryFailureError,
} from "back-end/src/queryRunners/QueryRunner";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import {
  countRunningQueries,
  getQueriesByIds,
  startQueryIfQueued,
  updateQuery,
  updateQueryIfRunning,
} from "back-end/src/models/QueryModel";

jest.mock("back-end/src/models/QueryModel");

class TestQueryRunner extends QueryRunner<
  InterfaceWithQueries,
  object,
  { success: boolean }
> {
  readonly parentType: QueryRunnerRunParentType = "experimentSnapshot";

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
  // Succeeded docs need a stored result for assertQueryMapComplete
  result: [],
});

const createMockIntegration = (): SourceIntegrationInterface =>
  ({
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
  }) as unknown as SourceIntegrationInterface;

const createMockContext = (): ReqContext =>
  ({
    org: { id: "test-org" },
    permissions: {
      canRunExperimentQueries: () => true,
      throwPermissionError: () => {
        throw new Error("Permission denied");
      },
    },
    models: {
      queryRunnerRuns: {
        createForRun: jest.fn().mockResolvedValue({
          id: "qrr_test",
          queryIds: [],
          lockToken: "tok",
          lockHeartbeatAt: new Date(),
        }),
        setQueryIds: jest.fn().mockResolvedValue(true),
        touchLockHeartbeat: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(undefined),
        acquireLock: jest.fn().mockResolvedValue(true),
      },
    },
  }) as unknown as ReqContext;

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
    expect(error).toBe("Failed to run a majority of the database queries");
  });
});

describe("QueryRunner", () => {
  let mockContext: ReqContext;
  let mockIntegration: SourceIntegrationInterface;

  beforeEach(() => {
    mockContext = createMockContext();
    mockIntegration = createMockIntegration();
    // getQueryMap() hydrates cached results through getQueriesByIds(); the
    // auto-mock returns undefined, which no caller tolerates.
    (getQueriesByIds as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe("startReadyQueries", () => {
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

      expect(runner.executeQuerySpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: "qry_A" }),
        expect.objectContaining({
          run: expect.any(Function),
          process: expect.any(Function),
          onFailure: expect.any(Function),
        }),
      );
      expect(runner.executeQuerySpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "qry_B" }),
        expect.objectContaining({
          run: expect.any(Function),
          process: expect.any(Function),
          onFailure: expect.any(Function),
        }),
      );
      expect(runner.executeQuerySpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "qry_C" }),
        expect.objectContaining({
          run: expect.any(Function),
          process: expect.any(Function),
          onFailure: expect.any(Function),
        }),
      );

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

      expect(updateQuery).toHaveBeenCalledWith(
        mockContext,
        expect.objectContaining({ id: "qry_A" }),
        expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("Dependencies failed"),
        }),
      );
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
      const queryD = createMockQuery("qry_D", "queued", []);

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

      expect(runner.executeQuerySpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "qry_A" }),
        expect.objectContaining({
          run: expect.any(Function),
          process: expect.any(Function),
          onFailure: expect.any(Function),
        }),
      );
      expect(runner.executeQuerySpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: "qry_B" }),
        expect.objectContaining({
          run: expect.any(Function),
          process: expect.any(Function),
          onFailure: expect.any(Function),
        }),
      );
      expect(updateQuery).toHaveBeenCalledWith(
        mockContext,
        expect.objectContaining({ id: "qry_C" }),
        expect.objectContaining({ status: "failed" }),
      );
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
    class RaceTestQueryRunner extends QueryRunner<
      InterfaceWithQueries,
      { pointers: Queries },
      { success: boolean }
    > {
      readonly parentType: QueryRunnerRunParentType = "experimentSnapshot";
      public persistedQueries: Queries = [];
      public updateModelSpy = jest.fn();
      public onQueryFinishSpy = jest.fn();
      public startQueriesImpl:
        | ((params: { pointers: Queries }) => Promise<Queries>)
        | null = null;

      checkPermissions() {
        return true;
      }

      async startQueries(params: { pointers: Queries }) {
        if (this.startQueriesImpl) return this.startQueriesImpl(params);
        return params.pointers;
      }

      async runAnalysis() {
        return { success: true };
      }

      /**
       * Simulates reading the model from the database: returns whatever has
       * been persisted via updateModel(), not the in-memory copy.
       */
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
      expect(
        mockContext.models.queryRunnerRuns.setQueryIds,
      ).toHaveBeenCalledWith("qrr_test", expect.any(String), [
        "qry_drop",
        "qry_create",
      ]);
      expect(
        (mockContext.models.queryRunnerRuns.setQueryIds as jest.Mock).mock
          .invocationCallOrder[0],
      ).toBeLessThan(runner.updateModelSpy.mock.invocationCallOrder[0]);
      expect(runner.onQueryFinishSpy).toHaveBeenLastCalledWith(pointers.length);
      expect(jest.getTimerCount()).toBeGreaterThan(0);
    });

    it("heartbeats while query creation is still in progress", async () => {
      jest.useFakeTimers();
      const runner = new RaceTestQueryRunner(
        mockContext,
        {
          id: "test-model",
          organization: "test-org",
          queries: [],
          runStarted: new Date(),
        },
        mockIntegration,
      );
      let finishCreatingQueries: (queries: Queries) => void = () => {};
      const queriesCreated = new Promise<Queries>((resolve) => {
        finishCreatingQueries = resolve;
      });
      let reportQueryCreationStarted: () => void = () => {};
      const queryCreationStarted = new Promise<void>((resolve) => {
        reportQueryCreationStarted = resolve;
      });
      runner.startQueriesImpl = async () => {
        reportQueryCreationStarted();
        return queriesCreated;
      };

      const start = runner.startAnalysis({
        pointers: [{ name: "a", query: "qry_a", status: "running" }],
      });
      await queryCreationStarted;
      await jest.advanceTimersByTimeAsync(30_000);

      expect(
        mockContext.models.queryRunnerRuns.touchLockHeartbeat,
      ).toHaveBeenCalledTimes(1);

      finishCreatingQueries([{ name: "a", query: "qry_a", status: "running" }]);
      await start;
      await runner.cancelQueries();
    });

    it("does not publish the parent when query ownership cannot be recorded", async () => {
      (
        mockContext.models.queryRunnerRuns.setQueryIds as jest.Mock
      ).mockResolvedValue(false);
      const runner = new RaceTestQueryRunner(
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
        pointers: [{ name: "a", query: "qry_a", status: "running" }],
      });

      expect(runner.updateModelSpy).not.toHaveBeenCalled();
      expect(runner.status).toBe("finished");
      expect(
        mockContext.models.queryRunnerRuns.releaseLock,
      ).toHaveBeenCalledTimes(1);
    });

    it("releases the lease when startup throws", async () => {
      jest.useFakeTimers();
      const runner = new RaceTestQueryRunner(
        mockContext,
        {
          id: "test-model",
          organization: "test-org",
          queries: [],
          runStarted: new Date(),
        },
        mockIntegration,
      );
      runner.startQueriesImpl = async () => {
        throw new Error("query creation failed");
      };

      await expect(runner.startAnalysis({ pointers: [] })).rejects.toThrow(
        "query creation failed",
      );

      expect(runner.status).toBe("finished");
      expect(jest.getTimerCount()).toBe(0);
      expect(
        mockContext.models.queryRunnerRuns.releaseLock,
      ).toHaveBeenCalledTimes(1);
    });

    it("does not re-arm the timer when queries are already finished (cached)", async () => {
      jest.useFakeTimers();
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
      (getQueriesByIds as jest.Mock).mockResolvedValue([
        createMockQuery("qry_a", "succeeded"),
        createMockQuery("qry_b", "succeeded"),
      ]);

      await runner.startAnalysis({ pointers });

      expect(runner.status).toBe("finished");
      expect(runner.onQueryFinishSpy).not.toHaveBeenCalled();
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
      (getQueriesByIds as jest.Mock).mockResolvedValue([
        createMockQuery("qry_a", "succeeded"),
        createMockQuery("qry_b", "succeeded"),
      ]);

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

    it("does not write a terminal parent after the lease was reclaimed", async () => {
      const runner = new RaceTestQueryRunner(
        mockContext,
        {
          id: "test-model",
          organization: "test-org",
          queries: [],
          runStarted: new Date(),
        },
        mockIntegration,
      );
      const pointers: Queries = [
        { name: "a", query: "qry_a", status: "succeeded" },
      ];
      (getQueriesByIds as jest.Mock).mockResolvedValue([
        createMockQuery("qry_a", "succeeded"),
      ]);
      (
        mockContext.models.queryRunnerRuns.touchLockHeartbeat as jest.Mock
      ).mockResolvedValue(false);

      await runner.startAnalysis({ pointers });

      expect(runner.updateModelSpy).not.toHaveBeenCalled();
      expect(runner.status).toBe("finished");
    });

    it("stands down instead of finalizing after an in-flight run loses its lease", async () => {
      const runner = new RaceTestQueryRunner(
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
        pointers: [{ name: "a", query: "qry_a", status: "running" }],
      });
      runner.updateModelSpy.mockClear();
      (getQueriesByIds as jest.Mock).mockResolvedValue([
        createMockQuery("qry_a", "succeeded"),
      ]);
      (
        mockContext.models.queryRunnerRuns.touchLockHeartbeat as jest.Mock
      ).mockResolvedValue(false);

      await runner.refreshQueryStatuses();

      expect(runner.updateModelSpy).not.toHaveBeenCalled();
      expect(runner.status).toBe("finished");
    });

    it("does not overwrite a reaper verdict when a query succeeds late", async () => {
      const runner = new RaceTestQueryRunner(
        mockContext,
        {
          id: "test-model",
          organization: "test-org",
          queries: [],
          runStarted: new Date(),
        },
        mockIntegration,
      );
      const query = createMockQuery("qry_a", "running");
      const onSuccess = jest.fn();
      jest.mocked(startQueryIfQueued).mockResolvedValue(true);
      jest.mocked(updateQueryIfRunning).mockResolvedValue(false);

      await runner.executeQuery(query, {
        run: jest.fn().mockResolvedValue({ rows: [{ value: 1 }] }),
        onFailure: jest.fn(),
        onSuccess,
      });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(updateQueryIfRunning).toHaveBeenCalledWith(
        mockContext,
        query,
        expect.objectContaining({ status: "succeeded" }),
      );
      expect(updateQuery).not.toHaveBeenCalledWith(
        mockContext,
        query,
        expect.objectContaining({ status: "succeeded" }),
      );
      expect(onSuccess).not.toHaveBeenCalled();
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

    // A refresh that lands while the runner is already failed must still report
    // the real query error: a model persisting `error ?? null` would otherwise
    // write null over the recorded failure.
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
    /**
     * Reaches the "running" state without executing any query, so the only
     * timer in play is the runner-level heartbeat interval. That isolates the
     * guarantee under test: the lock heartbeat keeps firing for as long as the
     * runner is "running", including the gaps between sequential queries.
     */
    class HeartbeatTestQueryRunner extends QueryRunner<
      InterfaceWithQueries,
      { pointers: Queries },
      { success: boolean }
    > {
      readonly parentType: QueryRunnerRunParentType = "experimentSnapshot";
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

      /** Neutralized so the fake clock only ever advances the heartbeat. */
      async onQueryFinish() {}

      protected override async onHeartbeat(): Promise<void> {
        this.onHeartbeatSpy();
      }
    }

    const runningPointers: Queries = [
      { name: "drop_old", query: "qry_drop", status: "running" },
      { name: "create", query: "qry_create", status: "queued" },
    ];

    it("fires onHeartbeat every ~30s while running even when no query is executing", async () => {
      jest.useFakeTimers();
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
      // The lease is created eagerly, before any query work.
      expect(
        mockContext.models.queryRunnerRuns.createForRun,
      ).toHaveBeenCalledTimes(1);
      expect(runner.onHeartbeatSpy).toHaveBeenCalledTimes(0);
      (
        mockContext.models.queryRunnerRuns.touchLockHeartbeat as jest.Mock
      ).mockClear();

      await jest.advanceTimersByTimeAsync(30000);
      expect(runner.onHeartbeatSpy).toHaveBeenCalledTimes(1);
      expect(
        mockContext.models.queryRunnerRuns.touchLockHeartbeat,
      ).toHaveBeenCalledTimes(1);

      // Spans the inter-query gap: still firing with zero query activity.
      await jest.advanceTimersByTimeAsync(60000);
      expect(runner.onHeartbeatSpy).toHaveBeenCalledTimes(3);
      expect(
        mockContext.models.queryRunnerRuns.touchLockHeartbeat,
      ).toHaveBeenCalledTimes(3);
    });

    it("stops firing onHeartbeat once the runner finishes", async () => {
      jest.useFakeTimers();
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
      (
        mockContext.models.queryRunnerRuns.touchLockHeartbeat as jest.Mock
      ).mockClear();
      await jest.advanceTimersByTimeAsync(30000);
      expect(runner.onHeartbeatSpy).toHaveBeenCalledTimes(1);

      await runner.cancelQueries();
      expect(runner.status).toBe("finished");
      expect(
        mockContext.models.queryRunnerRuns.releaseLock,
      ).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(120000);
      expect(runner.onHeartbeatSpy).toHaveBeenCalledTimes(1);
    });

    it("stops the heartbeat before its first tick when the runner finishes immediately", async () => {
      jest.useFakeTimers();
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

      (getQueriesByIds as jest.Mock).mockResolvedValue([
        createMockQuery("qry_a", "succeeded"),
        createMockQuery("qry_b", "succeeded"),
      ]);
      await runner.startAnalysis({
        pointers: [
          { name: "a", query: "qry_a", status: "succeeded" },
          { name: "b", query: "qry_b", status: "succeeded" },
        ],
      });

      expect(runner.status).toBe("finished");
      // Eager creation arms the timer, but the cached terminal path releases
      // the lease before the first interval fires.
      expect(
        mockContext.models.queryRunnerRuns.createForRun,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockContext.models.queryRunnerRuns.releaseLock,
      ).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(120000);
      expect(runner.onHeartbeatSpy).toHaveBeenCalledTimes(0);
      expect(
        mockContext.models.queryRunnerRuns.touchLockHeartbeat,
      ).toHaveBeenCalledTimes(1);
    });

    it("stands down when the lease heartbeat reports it was reclaimed", async () => {
      jest.useFakeTimers();
      (mockContext.models.queryRunnerRuns.touchLockHeartbeat as jest.Mock)
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false);
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
      expect(runner.onHeartbeatSpy).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(30000);

      expect(runner.status).toBe("finished");
      expect(runner.onHeartbeatSpy).not.toHaveBeenCalled();
      expect(
        mockContext.models.queryRunnerRuns.releaseLock,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe("stall recovery", () => {
    class StallTestQueryRunner extends QueryRunner<
      InterfaceWithQueries,
      { pointers: Queries },
      { success: boolean }
    > {
      readonly parentType: QueryRunnerRunParentType = "experimentSnapshot";
      public runAnalysisSpy = jest.fn();
      public updateModelSpy = jest.fn();
      public getLatestModelImpl: () => Promise<InterfaceWithQueries> = () =>
        Promise.resolve(this.model);

      checkPermissions() {
        return true;
      }

      async startQueries(params: { pointers: Queries }) {
        return params.pointers;
      }

      async runAnalysis(queryMap: QueryMap) {
        this.runAnalysisSpy(queryMap);
        return { success: true };
      }

      async getLatestModel() {
        return this.getLatestModelImpl();
      }

      public markDagPersisted() {
        // @ts-expect-error Setting private prop for testing
        this.dagPersisted = true;
      }

      public hasDebounceTimer(): boolean {
        // @ts-expect-error Reading private prop for testing
        return this.timer !== null;
      }

      async updateModel(params: {
        status: QueryStatus;
        queries: Queries;
      }): Promise<InterfaceWithQueries> {
        this.updateModelSpy(params);
        return { ...this.model, queries: params.queries };
      }
    }

    const makeModel = (queries: Queries): InterfaceWithQueries => ({
      id: "test-model",
      organization: "test-org",
      queries,
      runStarted: new Date(),
    });

    it("finalizes from persisted results when the persisted pointers are already terminal", async () => {
      // All-terminal pointers with hasChanges=false must still finalize.
      const runner = new StallTestQueryRunner(
        mockContext,
        makeModel([
          { name: "a", query: "qry_a", status: "succeeded" },
          { name: "b", query: "qry_b", status: "succeeded" },
        ]),
        mockIntegration,
      );
      runner.status = "running";
      (getQueriesByIds as jest.Mock).mockResolvedValue([
        createMockQuery("qry_a", "succeeded"),
        createMockQuery("qry_b", "succeeded"),
      ]);

      await runner.refreshQueryStatuses();

      expect(runner.runAnalysisSpy).toHaveBeenCalledTimes(1);
      expect(runner.updateModelSpy).toHaveBeenCalledWith(
        expect.objectContaining({ status: "succeeded" }),
      );
      expect(runner.status).toBe("finished");
    });

    it("does not finalize from a fresh (pending) runner instance", async () => {
      // Pending runners (status-polling endpoints) keep the no-change fast path.
      const runner = new StallTestQueryRunner(
        mockContext,
        makeModel([
          { name: "a", query: "qry_a", status: "succeeded" },
          { name: "b", query: "qry_b", status: "succeeded" },
        ]),
        mockIntegration,
      );
      expect(runner.status).toBe("pending");
      (getQueriesByIds as jest.Mock).mockResolvedValue([
        createMockQuery("qry_a", "succeeded"),
        createMockQuery("qry_b", "succeeded"),
      ]);

      await runner.refreshQueryStatuses();

      expect(runner.runAnalysisSpy).not.toHaveBeenCalled();
      expect(runner.updateModelSpy).not.toHaveBeenCalled();
    });

    it("refuses to run the analysis when query docs are missing from the read", async () => {
      const runner = new StallTestQueryRunner(
        mockContext,
        makeModel([
          { name: "a", query: "qry_a", status: "succeeded" },
          { name: "b", query: "qry_b", status: "succeeded" },
        ]),
        mockIntegration,
      );
      runner.status = "running";
      (getQueriesByIds as jest.Mock).mockResolvedValue([
        createMockQuery("qry_a", "succeeded"),
      ]);

      await expect(runner.refreshQueryStatuses()).rejects.toThrow(
        "incomplete query results",
      );
      expect(runner.runAnalysisSpy).not.toHaveBeenCalled();
      expect(runner.updateModelSpy).not.toHaveBeenCalled();
    });

    it("restores cached query statuses after an incomplete refresh reloads stale pointers", async () => {
      jest.useFakeTimers();
      const persistedQueries: Queries = [
        { name: "a", query: "qry_a", status: "running" },
        { name: "b", query: "qry_b", status: "running" },
        { name: "c", query: "qry_c", status: "succeeded" },
      ];
      const runner = new StallTestQueryRunner(
        mockContext,
        makeModel([]),
        mockIntegration,
      );
      await runner.startAnalysis({
        pointers: persistedQueries.map((pointer) => ({ ...pointer })),
      });
      runner.updateModelSpy.mockClear();
      runner.getLatestModelImpl = () =>
        Promise.resolve(
          makeModel(persistedQueries.map((pointer) => ({ ...pointer }))),
        );

      const getQueriesByIdsMock = jest.mocked(getQueriesByIds);
      getQueriesByIdsMock
        .mockResolvedValueOnce([
          createMockQuery("qry_a", "succeeded"),
          createMockQuery("qry_b", "succeeded"),
        ])
        .mockResolvedValueOnce([createMockQuery("qry_c", "succeeded")]);

      await jest.advanceTimersByTimeAsync(1000);

      expect(runner.status).toBe("running");
      expect(runner.runAnalysisSpy).not.toHaveBeenCalled();
      expect(runner.updateModelSpy).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(300000);

      expect(getQueriesByIdsMock).toHaveBeenNthCalledWith(2, mockContext, [
        "qry_c",
      ]);
      expect(runner.runAnalysisSpy).toHaveBeenCalledTimes(1);
      expect(runner.updateModelSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "succeeded",
          queries: expect.arrayContaining([
            expect.objectContaining({ name: "a", status: "succeeded" }),
            expect.objectContaining({ name: "b", status: "succeeded" }),
            expect.objectContaining({ name: "c", status: "succeeded" }),
          ]),
        }),
      );
      expect(runner.status).toBe("finished");
    });

    it("retries a dropped refresh via the watchdog and finalizes", async () => {
      jest.useFakeTimers();
      const runner = new StallTestQueryRunner(
        mockContext,
        makeModel([]),
        mockIntegration,
      );
      // startAnalysis so the refresh watchdog is started.
      await runner.startAnalysis({
        pointers: [{ name: "a", query: "qry_a", status: "running" }],
      });
      expect(runner.status).toBe("running");

      let failures = 1;
      runner.getLatestModelImpl = () => {
        if (failures > 0) {
          failures--;
          return Promise.reject(new Error("transient mongo error"));
        }
        return Promise.resolve(runner.model);
      };
      (getQueriesByIds as jest.Mock).mockResolvedValue([
        createMockQuery("qry_a", "succeeded"),
      ]);

      // Debounce fires; re-fetch fails (bounded retry)
      await jest.advanceTimersByTimeAsync(1000);
      expect(runner.runAnalysisSpy).not.toHaveBeenCalled();
      expect(runner.status).toBe("running");

      // Watchdog re-arms and finalizes
      await jest.advanceTimersByTimeAsync(302000);
      expect(runner.runAnalysisSpy).toHaveBeenCalledTimes(1);
      expect(runner.status).toBe("finished");
    });

    it("stands down (without an error) when the model is missing", async () => {
      // Cancel deletes the snapshot; stand down so waitForResults resolves
      // (rejecting would disable scheduled auto-updates).
      jest.useFakeTimers();
      const runner = new StallTestQueryRunner(
        mockContext,
        makeModel([]),
        mockIntegration,
      );
      await runner.startAnalysis({
        pointers: [{ name: "a", query: "qry_a", status: "running" }],
      });
      expect(runner.status).toBe("running");
      runner.updateModelSpy.mockClear();
      runner.getLatestModelImpl = () =>
        Promise.reject(new Error("Could not load snapshot model: snp_1"));

      // 5 failures (debounce + 4 watchdog) plus one tick proving stand-down.
      for (let i = 0; i < 5; i++) {
        await jest.advanceTimersByTimeAsync(302000);
      }

      expect(runner.status).toBe("finished");
      expect(runner.error).toBe("");
      expect(runner.runAnalysisSpy).not.toHaveBeenCalled();
      expect(runner.updateModelSpy).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
      await expect(runner.waitForResults()).resolves.toBeUndefined();
    });

    it("fails loudly after repeated transient model re-fetch failures", async () => {
      // Transient failures must shut down via updateModel so locks release.
      jest.useFakeTimers();
      const runner = new StallTestQueryRunner(
        mockContext,
        makeModel([]),
        mockIntegration,
      );
      await runner.startAnalysis({
        pointers: [{ name: "a", query: "qry_a", status: "running" }],
      });
      expect(runner.status).toBe("running");
      runner.updateModelSpy.mockClear();
      runner.getLatestModelImpl = () =>
        Promise.reject(new Error("transient mongo error"));

      for (let i = 0; i < 5; i++) {
        await jest.advanceTimersByTimeAsync(302000);
      }

      expect(runner.status).toBe("finished");
      expect(runner.error).toContain("transient mongo error");
      expect(runner.runAnalysisSpy).not.toHaveBeenCalled();
      expect(runner.updateModelSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("transient mongo error"),
        }),
      );
      expect(jest.getTimerCount()).toBe(0);
    });

    it("stands down when the query list was emptied by a cancel", async () => {
      // cancelQueries() on another instance writes queries: []; stand down.
      jest.useFakeTimers();
      const runner = new StallTestQueryRunner(
        mockContext,
        makeModel([]),
        mockIntegration,
      );
      await runner.startAnalysis({
        pointers: [{ name: "a", query: "qry_a", status: "running" }],
      });
      expect(runner.status).toBe("running");
      runner.updateModelSpy.mockClear();
      runner.getLatestModelImpl = () =>
        Promise.resolve({ ...runner.model, queries: [] });

      await jest.advanceTimersByTimeAsync(1000);

      expect(runner.status).toBe("finished");
      expect(runner.error).toBe("");
      expect(runner.runAnalysisSpy).not.toHaveBeenCalled();
      expect(runner.updateModelSpy).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });

    it("routes the give-up error through the conditional-write hook", async () => {
      jest.useFakeTimers();
      class HookedRunner extends StallTestQueryRunner {
        public conditionalWriteSpy = jest.fn();
        protected override async writeErrorIfStillActive(error: string) {
          this.conditionalWriteSpy(error);
        }
      }
      const runner = new HookedRunner(
        mockContext,
        makeModel([]),
        mockIntegration,
      );
      await runner.startAnalysis({
        pointers: [{ name: "a", query: "qry_a", status: "running" }],
      });
      runner.updateModelSpy.mockClear();
      (getQueriesByIds as jest.Mock).mockRejectedValue(new Error("mongo down"));

      for (let i = 0; i < 5; i++) {
        await jest.advanceTimersByTimeAsync(302000);
      }

      expect(runner.status).toBe("finished");
      expect(runner.error).toContain("mongo down");
      expect(runner.conditionalWriteSpy).toHaveBeenCalledTimes(1);
      expect(runner.conditionalWriteSpy).toHaveBeenCalledWith(
        expect.stringContaining("mongo down"),
      );
      // Give-up must not use the unconditional updateModel path
      expect(
        runner.updateModelSpy.mock.calls
          .map((c) => c[0])
          .filter((p) => p.status === "failed").length,
      ).toBe(0);
    });

    it("waits for terminal error persistence before reporting completion", async () => {
      jest.useFakeTimers();
      let resolveWrite: () => void = () => {};
      const writeFinished = new Promise<void>((resolve) => {
        resolveWrite = resolve;
      });

      class DeferredWriteRunner extends StallTestQueryRunner {
        public writeErrorSpy = jest.fn();

        protected override async writeErrorIfStillActive(error: string) {
          this.writeErrorSpy(error);
          await writeFinished;
        }
      }

      const runner = new DeferredWriteRunner(
        mockContext,
        makeModel([]),
        mockIntegration,
      );
      await runner.startAnalysis({
        pointers: [{ name: "a", query: "qry_a", status: "running" }],
      });
      jest.mocked(getQueriesByIds).mockRejectedValue(new Error("mongo down"));
      const completion = runner.waitForResults().then(
        () => "resolved",
        () => "rejected",
      );

      for (let i = 0; i < 5; i++) {
        await jest.advanceTimersByTimeAsync(302000);
      }

      expect(runner.writeErrorSpy).toHaveBeenCalledTimes(1);
      expect(runner.status).toBe("finishing");

      resolveWrite();

      await expect(completion).resolves.toBe("rejected");
      expect(runner.status).toBe("finished");
    });

    it("does not start a queued query after error shutdown begins", async () => {
      jest.useFakeTimers();
      let resolveCount: (count: number) => void = () => {};
      let resolveWrite: () => void = () => {};
      const countFinished = new Promise<number>((resolve) => {
        resolveCount = resolve;
      });
      const writeFinished = new Promise<void>((resolve) => {
        resolveWrite = resolve;
      });
      jest.spyOn(Math, "random").mockReturnValue(0);

      class DeferredShutdownRunner extends StallTestQueryRunner {
        public writeErrorSpy = jest.fn();

        protected override async writeErrorIfStillActive(error: string) {
          this.writeErrorSpy(error);
          await writeFinished;
        }
      }

      const query = createMockQuery("qry_late", "queued");
      const run = jest.fn().mockResolvedValue({ rows: [] });
      const runner = new DeferredShutdownRunner(
        mockContext,
        makeModel([]),
        mockIntegration,
      );
      await runner.startAnalysis({
        pointers: [{ name: "late", query: query.id, status: query.status }],
      });
      runner.runCallbacks[query.id] = { run, onFailure: jest.fn() };
      jest.mocked(countRunningQueries).mockReturnValue(countFinished);
      jest.mocked(startQueryIfQueued).mockResolvedValue(true);
      jest.mocked(updateQueryIfRunning).mockResolvedValue(true);
      jest.mocked(getQueriesByIds).mockRejectedValue(new Error("mongo down"));

      runner.queueQueryExecution(query);
      await jest.advanceTimersByTimeAsync(250);
      for (let i = 0; i < 5; i++) {
        await jest.advanceTimersByTimeAsync(302000);
      }

      expect(runner.writeErrorSpy).toHaveBeenCalledTimes(1);
      expect(runner.status).toBe("finishing");

      resolveCount(0);
      await jest.advanceTimersByTimeAsync(0);

      expect(run).not.toHaveBeenCalled();
      expect(updateQueryIfRunning).toHaveBeenCalledWith(
        mockContext,
        query,
        expect.objectContaining({ status: "failed" }),
      );

      resolveWrite();
      await Promise.resolve();
    });

    it("persists the give-up error through updateModel by default", async () => {
      // Base writeErrorIfStillActive writes unconditionally; subclasses may not.
      jest.useFakeTimers();
      const runner = new StallTestQueryRunner(
        mockContext,
        makeModel([]),
        mockIntegration,
      );
      await runner.startAnalysis({
        pointers: [{ name: "a", query: "qry_a", status: "running" }],
      });
      runner.updateModelSpy.mockClear();
      (getQueriesByIds as jest.Mock).mockRejectedValue(new Error("mongo down"));

      for (let i = 0; i < 5; i++) {
        await jest.advanceTimersByTimeAsync(302000);
      }

      expect(runner.status).toBe("finished");
      expect(runner.updateModelSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("mongo down"),
        }),
      );
    });

    it("does not restart a finished runner on a late query completion", async () => {
      jest.useFakeTimers();
      const runner = new StallTestQueryRunner(
        mockContext,
        makeModel([{ name: "a", query: "qry_a", status: "succeeded" }]),
        mockIntegration,
      );
      // So onQueryFinish reaches the finished-status guard.
      runner.markDagPersisted();
      runner.status = "finished";

      await runner.onQueryFinish();

      expect(runner.hasDebounceTimer()).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    });

    it("re-queues a queued query when the concurrency retry throws", async () => {
      jest.useFakeTimers();
      const query = createMockQuery("qry_stuck", "queued");
      const runner = new TestQueryRunner(
        mockContext,
        makeModel([{ name: "stuck", query: "qry_stuck", status: "queued" }]),
        mockIntegration,
      );
      (countRunningQueries as jest.Mock)
        .mockRejectedValueOnce(new Error("mongo down"))
        .mockResolvedValue(0);

      runner.runCallbacks[query.id] = {
        run: jest.fn(),
        onFailure: jest.fn(),
      };

      runner.queueQueryExecution(query);
      await jest.advanceTimersByTimeAsync(600);
      await jest.advanceTimersByTimeAsync(2000);
      expect(runner.executeQuerySpy).toHaveBeenCalled();
    });
  });

  describe("assertQueryMapComplete", () => {
    const pointers: Queries = [
      { name: "a", query: "qry_a", status: "succeeded" },
      { name: "b", query: "qry_b", status: "succeeded" },
    ];

    it("passes when every pointer has a doc with a stored result", () => {
      const queryMap: QueryMap = new Map([
        ["a", createMockQuery("qry_a", "succeeded")],
        ["b", createMockQuery("qry_b", "succeeded")],
      ]);
      expect(() => assertQueryMapComplete(pointers, queryMap)).not.toThrow();
    });

    it("throws when a doc is missing from the map", () => {
      const queryMap: QueryMap = new Map([
        ["a", createMockQuery("qry_a", "succeeded")],
      ]);
      expect(() => assertQueryMapComplete(pointers, queryMap)).toThrow(
        "1 of 2 query docs are missing",
      );
    });

    it("throws when a succeeded doc has no stored result", () => {
      const resultless = createMockQuery("qry_b", "succeeded");
      delete resultless.result;
      const queryMap: QueryMap = new Map([
        ["a", createMockQuery("qry_a", "succeeded")],
        ["b", resultless],
      ]);
      expect(() => assertQueryMapComplete(pointers, queryMap)).toThrow(
        "incomplete query results",
      );
    });

    it("does not require results on failed docs", () => {
      const failed = createMockQuery("qry_b", "failed");
      delete failed.result;
      const queryMap: QueryMap = new Map([
        ["a", createMockQuery("qry_a", "succeeded")],
        ["b", failed],
      ]);
      expect(() => assertQueryMapComplete(pointers, queryMap)).not.toThrow();
    });
  });

  describe("rollupQueryStatus", () => {
    const q = (id: string, status: QueryStatus): Queries[number] => ({
      name: id,
      query: id,
      status,
    });

    it("rolls up statuses the same way the runner does", () => {
      // Empty list rolls up to failed (0 >= 0/2)
      expect(rollupQueryStatus([])).toBe("failed");
      expect(rollupQueryStatus([q("a", "succeeded")])).toBe("succeeded");
      expect(rollupQueryStatus([q("a", "succeeded"), q("b", "running")])).toBe(
        "running",
      );
      expect(rollupQueryStatus([q("a", "succeeded"), q("b", "queued")])).toBe(
        "running",
      );
      expect(
        rollupQueryStatus([
          q("a", "succeeded"),
          q("b", "succeeded"),
          q("c", "failed"),
        ]),
      ).toBe("partially-succeeded");
      expect(rollupQueryStatus([q("a", "failed"), q("b", "succeeded")])).toBe(
        "failed",
      );
    });
  });
});
