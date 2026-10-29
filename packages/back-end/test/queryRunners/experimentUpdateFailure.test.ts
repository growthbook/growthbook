import type { QueryRunnerFailureCause } from "shared/types/query";
import type { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ExperimentResultsQueryRunner } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { ExperimentIncrementalRefreshQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import { ExperimentIncrementalRefreshExploratoryQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshExploratoryQueryRunner";
import {
  errorSnapshotIfStillRunning,
  updateSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import {
  failQueuedQueries,
  getQueryStatusesByIds,
} from "back-end/src/models/QueryModel";
import type { SourceIntegrationInterface } from "back-end/src/types/Integration";
import type { OrderedWriter } from "back-end/src/queryRunners/orderedWriter";
import { RESULTS_NOT_COMMITTED_ERROR } from "back-end/src/jobs/interruptedRefresh";
import type { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  updateSnapshot: jest.fn(),
  errorSnapshotIfStillRunning: jest.fn(),
}));
jest.mock("back-end/src/models/QueryModel", () => ({
  ...jest.requireActual("back-end/src/models/QueryModel"),
  getQueryStatusesByIds: jest.fn(),
  failQueuedQueries: jest.fn(),
}));
const context = {
  org: { id: "org_test" },
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
  permissions: { canRunExperimentQueries: () => true },
  models: {
    incrementalRefresh: {
      releaseLock: jest.fn().mockResolvedValue(undefined),
      releaseLockAfterInterruptedRun: jest.fn().mockResolvedValue(true),
      updateByExperimentIdIfCurrentExecution: jest.fn().mockResolvedValue(true),
      commitRunResults: jest.fn().mockResolvedValue(true),
      cleanUpUnlockedPhase: jest.fn().mockResolvedValue(false),
      wasCleanedUpBy: jest.fn().mockResolvedValue(false),
      markMaterialized: jest.fn().mockResolvedValue(undefined),
    },
  },
} as unknown as ReqContext;
const snapshot = {
  id: "snap_test",
  experiment: "exp_test",
  organization: "org_test",
  type: "standard",
  queries: [],
} as unknown as ExperimentSnapshotInterface;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getQueryStatusesByIds).mockResolvedValue([]);
  jest.mocked(failQueuedQueries).mockImplementation(async (_, ids) => ids);
});

describe.each([
  ExperimentResultsQueryRunner,
  ExperimentIncrementalRefreshQueryRunner,
  ExperimentIncrementalRefreshExploratoryQueryRunner,
])("%s failure persistence", (Runner) => {
  it.each([
    "query",
    "analysis",
    "no-queries",
    "cancelled",
    "unknown",
  ] satisfies QueryRunnerFailureCause[])(
    "passes %s to the shared snapshot failure handler",
    async (failureCause) => {
      const runner = new Runner(context, snapshot, {
        datasource: {},
      } as SourceIntegrationInterface);
      await runner.updateModel({
        status: "failed",
        queries: [],
        error: "private SQL",
        failureCause,
      });
      expect(updateSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
          id: snapshot.id,
          failureCause,
          updates: expect.objectContaining({ status: "error" }),
          conclusion: { concludedBy: "runner" },
        }),
      );
    },
  );

  it("reports a recovery as the snapshot's conclusion once it finalizes", async () => {
    const runner = new Runner(context, snapshot, {
      datasource: {},
    } as SourceIntegrationInterface);
    await runner.finalizeFromPersistedResults();
    await runner.updateModel({ status: "failed", queries: [], error: "boom" });

    expect(updateSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: { concludedBy: "recovery" } }),
    );
  });
});

describe("ExperimentIncrementalRefreshQueryRunner failing with queries still pending", () => {
  // The insert is still running when the run fails; its timestamp query has
  // not started.
  const incrementalSnapshot = {
    ...snapshot,
    runnerKind: "incremental-update",
    queries: [
      {
        name: "insert_metrics_source_data_g1",
        query: "q_insert",
        status: "running",
      },
      {
        name: "max_timestamp_metrics_source_g1",
        query: "q_max",
        status: "queued",
      },
    ],
  } as unknown as ExperimentSnapshotInterface;

  beforeEach(() => {
    jest.mocked(getQueryStatusesByIds).mockResolvedValue([
      { id: "q_insert", status: "running", createdAt: new Date() },
      { id: "q_max", status: "queued", createdAt: new Date() },
    ]);
  });

  function expectCleanedUp() {
    expect(failQueuedQueries).toHaveBeenCalledWith(
      context,
      ["q_max"],
      expect.any(String),
    );
    expect(
      context.models.incrementalRefresh.releaseLockAfterInterruptedRun,
    ).toHaveBeenCalledWith("exp_test", "snap_test", {
      metricGroupIdsToRebuild: ["g1"],
      forceFullRefresh: false,
    });
    expect(
      context.models.incrementalRefresh.releaseLock,
    ).not.toHaveBeenCalled();
  }

  it("drops what the run may have appended when its status rolls up to failed", async () => {
    const runner = new ExperimentIncrementalRefreshQueryRunner(
      context,
      incrementalSnapshot,
      { datasource: {} } as SourceIntegrationInterface,
    );
    await runner.updateModel({
      status: "failed",
      queries: incrementalSnapshot.queries,
      error: "Error running one or more database queries",
    });
    expectCleanedUp();
  });

  it("drops what the run may have appended when it shuts down with an error", async () => {
    jest.mocked(errorSnapshotIfStillRunning).mockResolvedValue(true);
    const runner = new ExperimentIncrementalRefreshQueryRunner(
      context,
      incrementalSnapshot,
      { datasource: {} } as SourceIntegrationInterface,
    );
    await (
      runner as unknown as {
        writeErrorIfStillActive: (error: string) => Promise<void>;
      }
    ).writeErrorIfStillActive("boom");
    expectCleanedUp();
  });

  it.each(["partially-succeeded", "failed"] as const)(
    "lands queued source-list writes before releasing the lock (%s)",
    async (status) => {
      jest.mocked(getQueryStatusesByIds).mockResolvedValue([]);
      const runner = new ExperimentIncrementalRefreshQueryRunner(
        context,
        incrementalSnapshot,
        { datasource: {} } as SourceIntegrationInterface,
      );
      const order: string[] = [];
      let landSlowWrite = () => {};
      const writeSourceLists = (
        runner as unknown as { writeSourceLists: OrderedWriter }
      ).writeSourceLists;
      // A slow covariate write, then a failed source's removal behind it.
      writeSourceLists(
        () =>
          new Promise<void>((resolve) => {
            landSlowWrite = () => {
              order.push("covariate write");
              resolve();
            };
          }),
      );
      writeSourceLists(async () => {
        order.push("source removal");
      });
      const release = jest.mocked(
        context.models.incrementalRefresh.releaseLockAfterInterruptedRun,
      );
      release.mockImplementationOnce(async () => {
        order.push("release");
        return true;
      });

      const updating = runner.updateModel({ status, queries: [] });
      await new Promise((resolve) => setImmediate(resolve));
      expect(release).not.toHaveBeenCalled();
      landSlowWrite();
      await updating;

      expect(order).toEqual(["covariate write", "source removal", "release"]);
    },
  );
});

describe("ExperimentIncrementalRefreshQueryRunner retrying its conclusion", () => {
  it("keeps its results when saving the snapshot failed once", async () => {
    const models = context.models.incrementalRefresh;
    const finished = {
      ...snapshot,
      runnerKind: "incremental-update",
      queries: [
        {
          name: "insert_metrics_source_data_g1",
          query: "q_insert",
          status: "succeeded",
        },
      ],
    } as unknown as ExperimentSnapshotInterface;
    jest.mocked(getQueryStatusesByIds).mockResolvedValue([]);
    // Committing again after the lock was released would miss.
    jest
      .mocked(models.commitRunResults)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    jest.mocked(updateSnapshot).mockRejectedValueOnce(new Error("save failed"));
    const runner = new ExperimentIncrementalRefreshQueryRunner(
      context,
      finished,
      { datasource: {} } as SourceIntegrationInterface,
    );

    const conclude = () =>
      runner.updateModel({ status: "succeeded", queries: finished.queries });
    await expect(conclude()).rejects.toThrow("save failed");
    await conclude();

    const saved = jest.mocked(updateSnapshot).mock.calls[1][0].updates;
    expect(saved.status).toBe("success");
    expect(saved.error ?? "").toBe("");
    expect(models.commitRunResults).toHaveBeenCalledTimes(1);
    jest.mocked(models.commitRunResults).mockResolvedValue(true);
  });
});

describe("ExperimentIncrementalRefreshQueryRunner saving its results", () => {
  const models = context.models.incrementalRefresh;
  const finished = {
    ...snapshot,
    runnerKind: "incremental-update",
    queries: [
      {
        name: "insert_metrics_source_data_g1",
        query: "q_insert",
        status: "succeeded",
      },
    ],
  } as unknown as ExperimentSnapshotInterface;
  const newRunner = () =>
    new ExperimentIncrementalRefreshQueryRunner(context, finished, {
      datasource: {},
    } as SourceIntegrationInterface);

  beforeEach(() => {
    jest.mocked(getQueryStatusesByIds).mockResolvedValue([]);
  });
  afterEach(() => {
    jest.mocked(models.commitRunResults).mockResolvedValue(true);
  });

  it("points the tables at the snapshot only once it is saved", async () => {
    jest.mocked(updateSnapshot).mockRejectedValueOnce(new Error("save failed"));
    await expect(
      newRunner().updateModel({
        status: "succeeded",
        queries: finished.queries,
      }),
    ).rejects.toThrow("save failed");
    expect(models.markMaterialized).not.toHaveBeenCalled();
  });

  it("saves refused results as a retryable error, not a query failure", async () => {
    jest.mocked(models.commitRunResults).mockResolvedValue(false);
    const runner = newRunner();

    await runner.updateModel({
      status: "succeeded",
      queries: finished.queries,
    });

    const saved = jest.mocked(updateSnapshot).mock.calls[0][0];
    expect(saved.updates.status).toBe("error");
    expect(saved.failureCause).toBe("cancelled");
    expect(models.markMaterialized).not.toHaveBeenCalled();
    expect(
      (
        runner as unknown as { refusedResultsError: () => string | null }
      ).refusedResultsError(),
    ).toContain(RESULTS_NOT_COMMITTED_ERROR);
  });
});
