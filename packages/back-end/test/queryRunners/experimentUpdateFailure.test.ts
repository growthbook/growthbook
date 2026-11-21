import type { QueryRunnerFailureCause } from "shared/types/query";
import type { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { ExperimentResultsQueryRunner } from "back-end/src/queryRunners/ExperimentResultsQueryRunner";
import { ExperimentIncrementalRefreshQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshQueryRunner";
import { ExperimentIncrementalRefreshExploratoryQueryRunner } from "back-end/src/queryRunners/ExperimentIncrementalRefreshExploratoryQueryRunner";
import { updateSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import type { SourceIntegrationInterface } from "back-end/src/types/Integration";
import type { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  updateSnapshot: jest.fn(),
}));
const context = {
  org: { id: "org_test" },
  permissions: { canRunExperimentQueries: () => true },
  models: {
    incrementalRefresh: {
      releaseLock: jest.fn().mockResolvedValue(undefined),
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

beforeEach(() => jest.clearAllMocks());

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

describe.each([
  ExperimentIncrementalRefreshQueryRunner,
  ExperimentIncrementalRefreshExploratoryQueryRunner,
])("%s lock release", (Runner) => {
  const { releaseLock } = context.models.incrementalRefresh;

  it.each(["succeeded", "partially-succeeded", "failed"] as const)(
    "releases the lock before the snapshot reads as %s",
    async (status) => {
      const runner = new Runner(context, snapshot, {
        datasource: {},
      } as SourceIntegrationInterface);
      await runner.updateModel({ status, queries: [] });

      // A client that polls status and starts the next update on a terminal
      // read must not hit this run's lock.
      expect(releaseLock).toHaveBeenCalledWith(
        snapshot.experiment,
        snapshot.id,
      );
      expect(jest.mocked(releaseLock).mock.invocationCallOrder[0]).toBeLessThan(
        jest.mocked(updateSnapshot).mock.invocationCallOrder[0],
      );
    },
  );

  it("keeps the lock while the snapshot is still running", async () => {
    const runner = new Runner(context, snapshot, {
      datasource: {},
    } as SourceIntegrationInterface);
    await runner.updateModel({ status: "running", queries: [] });

    expect(releaseLock).not.toHaveBeenCalled();
    expect(updateSnapshot).toHaveBeenCalled();
  });
});

describe("ExperimentIncrementalRefreshQueryRunner materialized snapshot", () => {
  const { releaseLock, updateByExperimentIdIfCurrentExecution } =
    context.models.incrementalRefresh;

  it("records the materializing snapshot while it still holds the lock", async () => {
    const runner = new ExperimentIncrementalRefreshQueryRunner(
      context,
      snapshot,
      { datasource: {} } as SourceIntegrationInterface,
    );
    await runner.updateModel({ status: "succeeded", queries: [] });

    expect(updateByExperimentIdIfCurrentExecution).toHaveBeenCalledWith(
      snapshot.experiment,
      snapshot.id,
      { materializedBySnapshotId: snapshot.id },
    );
    expect(
      jest.mocked(updateByExperimentIdIfCurrentExecution).mock
        .invocationCallOrder[0],
    ).toBeLessThan(jest.mocked(releaseLock).mock.invocationCallOrder[0]);
  });
});
