import type Agenda from "agenda";
import type {
  SnapshotTriggeredBy,
  SnapshotType,
} from "shared/types/experiment-snapshot";
import expireOldQueries from "back-end/src/jobs/expireOldQueries";
import {
  dangerousFindStalledRunningSnapshotsFromAllOrgs,
  errorSnapshotIfStillRunning,
  findSnapshotById,
} from "back-end/src/models/ExperimentSnapshotModel";
import { recoverStalledSnapshot } from "back-end/src/queryRunners/rehydrate";
import {
  getQueryStatusesByIds,
  getStaleQueries,
  markPendingQueriesAsFailed,
} from "back-end/src/models/QueryModel";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  dangerousFindStalledRunningSnapshotsFromAllOrgs: jest.fn(),
  errorSnapshotIfStillRunning: jest.fn(),
  findRunningSnapshotsByQueryId: jest.fn().mockResolvedValue([]),
  findSnapshotById: jest.fn(),
  updateSnapshot: jest.fn(),
}));

jest.mock("back-end/src/queryRunners/rehydrate", () => ({
  recoverStalledSnapshot: jest.fn(),
}));

jest.mock("back-end/src/models/QueryModel", () => ({
  getQueryStatusesByIds: jest.fn(),
  getStaleQueries: jest.fn(),
  markPendingQueriesAsFailed: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
  updateExperiment: jest.fn(),
}));

jest.mock("back-end/src/models/MetricModel", () => ({
  findRunningMetricsByQueryId: jest.fn().mockResolvedValue([]),
  updateMetricQueriesAndStatus: jest.fn(),
}));

jest.mock("back-end/src/models/PastExperimentsModel", () => ({
  findRunningPastExperimentsByQueryId: jest.fn().mockResolvedValue([]),
  updatePastExperiments: jest.fn(),
}));

jest.mock("back-end/src/models/ReportModel", () => ({
  findReportsByQueryId: jest.fn().mockResolvedValue([]),
  updateReport: jest.fn(),
}));

jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgId: jest.fn(),
}));

jest.mock("back-end/src/models/MetricAnalysisModel", () => ({
  MetricAnalysisModel: {
    findByQueryIds: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock("back-end/src/util/mongo.util", () => ({
  getCollection: jest.fn(() => {
    const cursor = {
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([]),
    };
    return {
      find: jest.fn().mockReturnValue(cursor),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    };
  }),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("expireOldQueries stalled snapshot reaper", () => {
  const releaseLock = jest.fn().mockResolvedValue(undefined);
  const hasFreshLockHeartbeat = jest.fn();
  const context = {
    org: { id: "org_1" },
    models: {
      incrementalRefresh: { releaseLock, hasFreshLockHeartbeat },
      metricAnalysis: { update: jest.fn() },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getStaleQueries as jest.Mock).mockResolvedValue([]);
    (
      dangerousFindStalledRunningSnapshotsFromAllOrgs as jest.Mock
    ).mockResolvedValue([]);
    (getQueryStatusesByIds as jest.Mock).mockResolvedValue([]);
    (errorSnapshotIfStillRunning as jest.Mock).mockResolvedValue(true);
    (markPendingQueriesAsFailed as jest.Mock).mockResolvedValue(1);
    (getExperimentById as jest.Mock).mockResolvedValue({
      id: "exp_1",
      organization: "org_1",
    });
    (updateExperiment as jest.Mock).mockResolvedValue({});
    (getContextForAgendaJobByOrgId as jest.Mock).mockResolvedValue(context);
    (findSnapshotById as jest.Mock).mockResolvedValue(null);
    (recoverStalledSnapshot as jest.Mock).mockResolvedValue(false);
    hasFreshLockHeartbeat.mockResolvedValue(false);
  });

  async function runJob() {
    const definitions: Record<string, () => Promise<void>> = {};
    const agenda = {
      define: jest.fn((name: string, fn: () => Promise<void>) => {
        definitions[name] = fn;
      }),
      create: jest.fn(() => ({
        unique: jest.fn(),
        repeatEvery: jest.fn(),
        save: jest.fn().mockResolvedValue(undefined),
      })),
    };

    await expireOldQueries(agenda as unknown as Agenda);
    await definitions.expireOldQueries();
  }

  function mockOrphanedSnapshot(snapshot: {
    type?: SnapshotType;
    triggeredBy?: SnapshotTriggeredBy;
    report?: string;
  }) {
    const dateCreated = new Date(Date.now() - 2 * 60 * 60 * 1000);
    (
      dangerousFindStalledRunningSnapshotsFromAllOrgs as jest.Mock
    ).mockResolvedValue([
      {
        id: "snp_1",
        organization: "org_1",
        experiment: "exp_1",
        phase: 0,
        dimension: null,
        type: snapshot.type,
        triggeredBy: snapshot.triggeredBy,
        report: snapshot.report,
        dateCreated,
        runStarted: dateCreated,
        status: "running",
        settings: {},
        queries: [{ name: "main", query: "qry_1", status: "queued" }],
        unknownVariations: [],
        multipleExposures: 0,
        analyses: [],
      },
    ]);
    (getQueryStatusesByIds as jest.Mock).mockResolvedValue([
      { id: "qry_1", status: "queued" },
    ]);
  }

  it("schedules a retry for orphaned scheduled standard snapshots", async () => {
    mockOrphanedSnapshot({ type: "standard", triggeredBy: "schedule" });

    await runJob();

    expect(updateExperiment).toHaveBeenCalledWith({
      context,
      experiment: expect.objectContaining({ id: "exp_1" }),
      changes: {
        nextSnapshotAttempt: expect.any(Date),
        autoSnapshots: true,
      },
      bypassWebhooks: true,
    });
    expect(errorSnapshotIfStillRunning).toHaveBeenCalledWith(
      context,
      "snp_1",
      expect.objectContaining({
        error: expect.stringContaining("A retry has been scheduled."),
      }),
    );
  });

  it("does not enable auto-refresh for orphaned manual snapshots", async () => {
    mockOrphanedSnapshot({ type: "standard", triggeredBy: "manual" });

    await runJob();

    expect(updateExperiment).not.toHaveBeenCalled();
    expect(errorSnapshotIfStillRunning).toHaveBeenCalledWith(
      context,
      "snp_1",
      expect.objectContaining({
        error: expect.stringContaining("Please try updating results again."),
      }),
    );
  });

  it("does not schedule the generic standard retry for exploratory snapshots", async () => {
    mockOrphanedSnapshot({ type: "exploratory", triggeredBy: "schedule" });

    await runJob();

    expect(updateExperiment).not.toHaveBeenCalled();
  });

  const oldFinishedAt = new Date(Date.now() - 30 * 60 * 1000);

  function mockStalledSnapshot(
    statuses: { id: string; status: string; finishedAt?: Date }[],
  ) {
    const dateCreated = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const candidate = {
      id: "snp_1",
      organization: "org_1",
      experiment: "exp_1",
      dateCreated,
      runStarted: dateCreated,
      status: "running",
      settings: { datasourceId: "ds_1" },
      queries: statuses.map((s) => ({
        name: s.id,
        query: s.id,
        status: "running",
      })),
    };
    (
      dangerousFindStalledRunningSnapshotsFromAllOrgs as jest.Mock
    ).mockResolvedValue([candidate]);
    (getQueryStatusesByIds as jest.Mock).mockResolvedValue(
      statuses.map((s) => ({ finishedAt: oldFinishedAt, ...s })),
    );
    (findSnapshotById as jest.Mock).mockResolvedValue(candidate);
    return candidate;
  }

  it("finalizes an all-succeeded stalled snapshot from persisted results", async () => {
    mockStalledSnapshot([
      { id: "qry_1", status: "succeeded" },
      { id: "qry_2", status: "succeeded" },
    ]);
    (recoverStalledSnapshot as jest.Mock).mockResolvedValue(true);

    await runJob();

    expect(recoverStalledSnapshot).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ id: "snp_1" }),
    );
    expect(errorSnapshotIfStillRunning).not.toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalledWith("exp_1", "snp_1");
  });

  it("leaves an all-succeeded snapshot alone while its runner still heartbeats the lock", async () => {
    mockStalledSnapshot([{ id: "qry_1", status: "succeeded" }]);
    hasFreshLockHeartbeat.mockResolvedValue(true);

    await runJob();

    expect(hasFreshLockHeartbeat).toHaveBeenCalledWith("exp_1", "snp_1");
    expect(recoverStalledSnapshot).not.toHaveBeenCalled();
    expect(errorSnapshotIfStillRunning).not.toHaveBeenCalled();
    expect(releaseLock).not.toHaveBeenCalled();
  });

  it("still errors a stalled snapshot with a mixed succeeded/failed roster", async () => {
    mockStalledSnapshot([
      { id: "qry_1", status: "succeeded" },
      { id: "qry_2", status: "failed" },
    ]);

    await runJob();

    expect(recoverStalledSnapshot).not.toHaveBeenCalled();
    expect(errorSnapshotIfStillRunning).toHaveBeenCalledWith(
      context,
      "snp_1",
      expect.objectContaining({
        error: expect.stringContaining(
          "queries finished but results were never finalized",
        ),
      }),
    );
  });

  it("errors the snapshot with the failure folded in when recovery throws", async () => {
    mockStalledSnapshot([{ id: "qry_1", status: "succeeded" }]);
    (recoverStalledSnapshot as jest.Mock).mockRejectedValue(
      new Error("analysis blew up"),
    );

    await runJob();

    expect(errorSnapshotIfStillRunning).toHaveBeenCalledWith(
      context,
      "snp_1",
      expect.objectContaining({
        error: expect.stringContaining(
          "Automatic recovery failed: analysis blew up",
        ),
      }),
    );
  });

  it("falls through to the generic error write when recovery returns false", async () => {
    mockStalledSnapshot([{ id: "qry_1", status: "succeeded" }]);
    (recoverStalledSnapshot as jest.Mock).mockResolvedValue(false);

    await runJob();

    expect(errorSnapshotIfStillRunning).toHaveBeenCalledWith(
      context,
      "snp_1",
      expect.objectContaining({
        error: expect.stringContaining(
          "queries finished but results were never finalized",
        ),
      }),
    );
    // Nothing threw, so the recovery suffix must not be appended.
    const { error } = (errorSnapshotIfStillRunning as jest.Mock).mock
      .calls[0][2];
    expect(error).not.toContain("Automatic recovery");
  });

  it("skips a still-running snapshot whose fresh DAG no longer matches", async () => {
    mockStalledSnapshot([{ id: "qry_1", status: "succeeded" }]);
    (findSnapshotById as jest.Mock).mockResolvedValue({
      id: "snp_1",
      status: "running",
      queries: [{ name: "other", query: "qry_9", status: "running" }],
    });

    await runJob();

    // The succeeded statuses describe a stale query set, so we neither finalize
    // nor error the live run; a later tick re-reads and re-evaluates it.
    expect(recoverStalledSnapshot).not.toHaveBeenCalled();
    expect(errorSnapshotIfStillRunning).not.toHaveBeenCalled();
  });

  it("errors a stalled snapshot the fresh read shows is no longer running", async () => {
    mockStalledSnapshot([{ id: "qry_1", status: "succeeded" }]);
    (findSnapshotById as jest.Mock).mockResolvedValue({
      id: "snp_1",
      status: "error",
      queries: [{ name: "qry_1", query: "qry_1", status: "running" }],
    });

    await runJob();

    // Not running on the fresh read, so recovery is skipped; the error write is
    // a no-op guarded by errorSnapshotIfStillRunning but still attempted.
    expect(recoverStalledSnapshot).not.toHaveBeenCalled();
    expect(errorSnapshotIfStillRunning).toHaveBeenCalled();
  });

  it("defers an all-succeeded snapshot still inside the finalize grace window", async () => {
    mockStalledSnapshot([
      { id: "qry_1", status: "succeeded", finishedAt: new Date() },
    ]);

    await runJob();

    expect(recoverStalledSnapshot).not.toHaveBeenCalled();
    expect(errorSnapshotIfStillRunning).not.toHaveBeenCalled();
  });
});
