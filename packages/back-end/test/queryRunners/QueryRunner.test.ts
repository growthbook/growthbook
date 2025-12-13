import {
  QueryRunner,
  QueryMap,
  InterfaceWithQueries,
} from "back-end/src/queryRunners/QueryRunner";
import { QueryInterface, QueryStatus } from "back-end/types/query";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { updateQuery } from "back-end/src/models/QueryModel";
import { ReqContext } from "back-end/types/request";

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
    this.queuedQueryTimers[queryId] = timer;
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
});
