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
  permissions: { canRunExperimentQueries: () => true },
  models: {
    incrementalRefresh: {
      releaseLock: jest.fn().mockResolvedValue(undefined),
      releaseLockAfterInterruptedRun: jest.fn().mockResolvedValue(true),
      updateByExperimentIdIfCurrentExecution: jest.fn().mockResolvedValue(true),
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
