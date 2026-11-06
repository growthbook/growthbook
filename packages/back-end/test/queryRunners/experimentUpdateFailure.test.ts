import type { QueryRunnerFailureCause } from "shared/types/query";
import type { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ExperimentResultsQueryRunner } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { ExperimentIncrementalRefreshQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import { ExperimentIncrementalRefreshExploratoryQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshExploratoryQueryRunner";
import { updateSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import {
  failQueuedQueries,
  getQueryStatusesByIds,
} from "back-end/src/models/QueryModel";
import { RESULTS_SUPERSEDED_ERROR } from "back-end/src/services/interruptedRefresh";
import type { OrderedWriter } from "back-end/src/queryRunners/orderedWriter";
import type { SourceIntegrationInterface } from "back-end/src/types/Integration";
import type { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  updateSnapshot: jest.fn(),
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
      commitRunResults: jest.fn().mockResolvedValue(true),
      markMaterialized: jest.fn().mockResolvedValue(true),
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

describe("ExperimentIncrementalRefreshQueryRunner concluding", () => {
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
      { name: "statistics_g1", query: "q_stats", status: "queued" },
    ],
  } as unknown as ExperimentSnapshotInterface;
  const newRunner = () =>
    new ExperimentIncrementalRefreshQueryRunner(context, finished, {
      datasource: {},
    } as SourceIntegrationInterface);

  afterEach(() => {
    jest.mocked(models.commitRunResults).mockResolvedValue(true);
  });

  it("commits, saves, then points the tables at the snapshot and releases", async () => {
    await newRunner().updateModel({
      status: "succeeded",
      queries: finished.queries,
    });

    const order = (fn: unknown) =>
      (fn as jest.Mock).mock.invocationCallOrder[0];
    expect(order(models.commitRunResults)).toBeLessThan(order(updateSnapshot));
    expect(order(updateSnapshot)).toBeLessThan(order(models.markMaterialized));
    expect(order(models.markMaterialized)).toBeLessThan(
      order(models.releaseLock),
    );
  });

  it("keeps the lock and its results when saving the snapshot failed once", async () => {
    jest.mocked(updateSnapshot).mockRejectedValueOnce(new Error("save failed"));
    const runner = newRunner();
    const conclude = () =>
      runner.updateModel({ status: "succeeded", queries: finished.queries });

    await expect(conclude()).rejects.toThrow("save failed");
    expect(models.markMaterialized).not.toHaveBeenCalled();
    expect(models.releaseLock).not.toHaveBeenCalled();
    await conclude();

    const saved = jest.mocked(updateSnapshot).mock.calls[1][0].updates;
    expect(saved.status).toBe("success");
    expect(models.markMaterialized).toHaveBeenCalledTimes(1);
  });

  it("saves results it could not commit as superseded, not as a query failure", async () => {
    jest.mocked(models.commitRunResults).mockResolvedValue(false);
    const runner = newRunner();

    await runner.updateModel({
      status: "succeeded",
      queries: finished.queries,
    });

    const saved = jest.mocked(updateSnapshot).mock.calls[0][0];
    expect(saved.updates.status).toBe("error");
    expect(saved.updates.error).toBe(RESULTS_SUPERSEDED_ERROR);
    expect(saved.failureCause).toBe("superseded");
    expect(models.markMaterialized).not.toHaveBeenCalled();
    expect(
      (
        runner as unknown as { refusedResultsError: () => string | null }
      ).refusedResultsError(),
    ).toBe(RESULTS_SUPERSEDED_ERROR);
  });

  it("stops queries that have not started before releasing a failed run", async () => {
    jest
      .mocked(getQueryStatusesByIds)
      .mockResolvedValue([
        { id: "q_stats", status: "queued", createdAt: new Date() },
      ]);

    await newRunner().updateModel({
      status: "failed",
      queries: finished.queries,
      error: "boom",
    });

    expect(failQueuedQueries).toHaveBeenCalledWith(
      context,
      ["q_stats"],
      expect.any(String),
    );
    expect(models.commitRunResults).not.toHaveBeenCalled();
    expect(models.releaseLock).toHaveBeenCalledWith("exp_test", "snap_test");
  });

  it("lands queued source-list writes before releasing the lock", async () => {
    const runner = newRunner();
    const order: string[] = [];
    let landSlowWrite = () => {};
    const writeSourceLists = (
      runner as unknown as { writeSourceLists: OrderedWriter }
    ).writeSourceLists;
    writeSourceLists(
      () =>
        new Promise<void>((resolve) => {
          landSlowWrite = () => {
            order.push("source-list write");
            resolve();
          };
        }),
    );
    jest.mocked(models.releaseLock).mockImplementationOnce(async () => {
      order.push("release");
    });

    const updating = runner.updateModel({ status: "failed", queries: [] });
    await new Promise((resolve) => setImmediate(resolve));
    expect(models.releaseLock).not.toHaveBeenCalled();
    landSlowWrite();
    await updating;

    expect(order).toEqual(["source-list write", "release"]);
  });
});
