import { Queries, QueryInterface, QueryStatus } from "shared/types/query";
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
  // Succeeded docs need a stored result for assertQueryMapComplete
  result: [],
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
    expect(error).toBe("Failed to run a majority of the database queries");
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

      checkPermissions() {
        return true;
      }

      async startQueries(params: { pointers: Queries }) {
        return params.pointers;
      }

      async runAnalysis() {
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
        (getQueriesByIds as jest.Mock).mockResolvedValue([
          createMockQuery("qry_a", "succeeded"),
          createMockQuery("qry_b", "succeeded"),
        ]);

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
        jest.advanceTimersByTime(120000);
        expect(runner.onHeartbeatSpy).toHaveBeenCalledTimes(0);
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });
  });

  describe("stall recovery", () => {
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

    class StallTestQueryRunner extends QueryRunner<
      InterfaceWithQueries,
      { pointers: Queries },
      { success: boolean }
    > {
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
      // Pointers all succeeded, but the doc read is incomplete.
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
      try {
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
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it("retries a dropped refresh via the watchdog and finalizes", async () => {
      jest.useFakeTimers();
      try {
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

        // First model re-fetch throws; later ones succeed.
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
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it("stands down (without an error) when the model is missing", async () => {
      // Cancel deletes the snapshot; stand down so waitForResults resolves
      // (rejecting would disable scheduled auto-updates).
      jest.useFakeTimers();
      try {
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
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it("fails loudly after repeated transient model re-fetch failures", async () => {
      // Transient failures must shut down via updateModel so locks release.
      jest.useFakeTimers();
      try {
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
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it("stands down when the query list was emptied by a cancel", async () => {
      // cancelQueries() on another instance writes queries: []; stand down.
      jest.useFakeTimers();
      try {
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
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it("routes the give-up error through the conditional-write hook", async () => {
      jest.useFakeTimers();
      try {
        class HookedRunner extends StallTestQueryRunner {
          public conditionalWriteSpy = jest.fn();
          protected override async writeErrorIfStillActive(
            error: string,
          ): Promise<void> {
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
        (getQueriesByIds as jest.Mock).mockRejectedValue(
          new Error("mongo down"),
        );

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
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it("waits for terminal error persistence before reporting completion", async () => {
      jest.useFakeTimers();
      let resolveWrite: () => void = () => {
        throw new Error("write promise was not initialized");
      };
      const writeFinished = new Promise<void>((resolve) => {
        resolveWrite = resolve;
      });
      try {
        class DeferredWriteRunner extends StallTestQueryRunner {
          public writeErrorSpy = jest.fn();

          protected override async writeErrorIfStillActive(
            error: string,
          ): Promise<void> {
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
        expect(runner.status).toBe("running");

        resolveWrite();

        await expect(completion).resolves.toBe("rejected");
        expect(runner.status).toBe("finished");
      } finally {
        resolveWrite();
        await Promise.resolve();
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it("persists the give-up error through updateModel by default", async () => {
      // Base writeErrorIfStillActive writes unconditionally; subclasses may not.
      jest.useFakeTimers();
      try {
        const runner = new StallTestQueryRunner(
          mockContext,
          makeModel([]),
          mockIntegration,
        );
        await runner.startAnalysis({
          pointers: [{ name: "a", query: "qry_a", status: "running" }],
        });
        runner.updateModelSpy.mockClear();
        (getQueriesByIds as jest.Mock).mockRejectedValue(
          new Error("mongo down"),
        );

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
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it("does not restart a finished runner on a late query completion", async () => {
      jest.useFakeTimers();
      try {
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
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it("re-queues a queued query when the concurrency retry throws", async () => {
      jest.useFakeTimers();
      try {
        const query = createMockQuery("qry_stuck", "queued");
        const runner = new TestQueryRunner(
          mockContext,
          makeModel([{ name: "stuck", query: "qry_stuck", status: "queued" }]),
          mockIntegration,
        );
        // First concurrency check throws; later ones pass
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
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
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
