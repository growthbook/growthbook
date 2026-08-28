import type Agenda from "agenda";
import type {
  SnapshotTriggeredBy,
  SnapshotType,
} from "shared/types/experiment-snapshot";
import expireOldQueries from "back-end/src/jobs/expireOldQueries";
import {
  dangerousFindStalledRunningSnapshotsFromAllOrgs,
  errorSnapshotIfStillRunning,
  findRunningSnapshotsByQueryId,
} from "back-end/src/models/ExperimentSnapshotModel";
import {
  failQueryRunnerRunQueries,
  failStaleQueries,
  findStaleRunningQueries,
  getQueryStatusesByIds,
  markPendingQueriesAsFailed,
} from "back-end/src/models/QueryModel";
import { QueryRunnerRunModel } from "back-end/src/models/QueryRunnerRunModel";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { getCollection } from "back-end/src/util/mongo.util";

const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn();

function makeCollectionMock(candidates: unknown[] = []) {
  return {
    find: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue(candidates),
    }),
    findOne: mockFindOne,
    updateOne: mockUpdateOne,
  };
}

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  dangerousFindStalledRunningSnapshotsFromAllOrgs: jest.fn(),
  errorSnapshotIfStillRunning: jest.fn(),
  findRunningSnapshotsByQueryId: jest.fn(),
}));

jest.mock("back-end/src/models/QueryModel", () => ({
  failQueryRunnerRunQueries: jest.fn(),
  failStaleQueries: jest.fn(),
  findStaleRunningQueries: jest.fn(),
  getQueryStatusesByIds: jest.fn(),
  markPendingQueriesAsFailed: jest.fn(),
}));

jest.mock("back-end/src/models/QueryRunnerRunModel", () => ({
  QueryRunnerRunModel: {
    dangerouslyFindActiveRuns: jest.fn(),
    dangerouslyFindStaleQueryRunnerRuns: jest.fn(),
  },
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: jest.fn(),
  updateExperiment: jest.fn(),
}));

jest.mock("back-end/src/models/MetricModel", () => ({
  findRunningMetricsByQueryId: jest.fn().mockResolvedValue([]),
}));

jest.mock("back-end/src/models/PastExperimentsModel", () => ({
  findRunningPastExperimentsByQueryId: jest.fn().mockResolvedValue([]),
}));

jest.mock("back-end/src/models/ReportModel", () => ({
  findReportsByQueryId: jest.fn().mockResolvedValue([]),
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
  getCollection: jest.fn(),
}));

jest.mock("back-end/src/util/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("expireOldQueries", () => {
  const releaseLock = jest.fn().mockResolvedValue(undefined);
  const qrrAcquireLock = jest.fn();
  const qrrReleaseLock = jest.fn().mockResolvedValue(undefined);
  const qrrGetActiveByTarget = jest.fn();
  const context = {
    org: { id: "org_1" },
    models: {
      incrementalRefresh: { releaseLock },
      metricAnalysis: { update: jest.fn() },
      queryRunnerRuns: {
        acquireLock: qrrAcquireLock,
        releaseLock: qrrReleaseLock,
        getActiveByTarget: qrrGetActiveByTarget,
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (findStaleRunningQueries as jest.Mock).mockResolvedValue([]);
    (failQueryRunnerRunQueries as jest.Mock).mockResolvedValue(1);
    (failStaleQueries as jest.Mock).mockResolvedValue(undefined);
    (findRunningSnapshotsByQueryId as jest.Mock).mockResolvedValue([]);
    (
      QueryRunnerRunModel.dangerouslyFindActiveRuns as jest.Mock
    ).mockResolvedValue([]);
    (
      QueryRunnerRunModel.dangerouslyFindStaleQueryRunnerRuns as jest.Mock
    ).mockResolvedValue([]);
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
    mockFindOne.mockResolvedValue(null);
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    qrrAcquireLock.mockResolvedValue(true);
    qrrGetActiveByTarget.mockResolvedValue(null);
    (getCollection as jest.Mock).mockImplementation(() => makeCollectionMock());
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

  describe("stale query runner lease reaper", () => {
    const staleLease = {
      id: "qrr_1",
      organization: "org_1",
      targetType: "metricAnalysis",
      targetId: "ma_1",
      queryIds: ["qry_1"],
    };

    it("claims a stale lease and fails its DAG", async () => {
      (
        QueryRunnerRunModel.dangerouslyFindStaleQueryRunnerRuns as jest.Mock
      ).mockResolvedValue([staleLease]);
      mockFindOne.mockResolvedValue({
        id: "ma_1",
        organization: "org_1",
        queries: [{ name: "a", query: "qry_1", status: "running" }],
      });

      await runJob();

      expect(qrrAcquireLock).toHaveBeenCalledWith("qrr_1", expect.any(String));
      expect(failQueryRunnerRunQueries).toHaveBeenCalledWith(
        context,
        ["qry_1"],
        expect.stringContaining("stopped unexpectedly"),
      );
      expect(qrrGetActiveByTarget).not.toHaveBeenCalled();
      expect(mockUpdateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "ma_1",
          status: "running",
          queries: [{ name: "a", query: "qry_1", status: "running" }],
        }),
        expect.anything(),
      );
      expect(qrrReleaseLock).toHaveBeenCalledWith("qrr_1", expect.any(String));
    });

    it("leaves a fresh lease alone when the claim fails", async () => {
      (
        QueryRunnerRunModel.dangerouslyFindStaleQueryRunnerRuns as jest.Mock
      ).mockResolvedValue([staleLease]);
      qrrAcquireLock.mockResolvedValue(false);

      await runJob();

      expect(mockFindOne).not.toHaveBeenCalled();
      expect(markPendingQueriesAsFailed).not.toHaveBeenCalled();
      expect(mockUpdateOne).not.toHaveBeenCalled();
      expect(qrrReleaseLock).not.toHaveBeenCalled();
    });

    it("releases the lease when the target is already terminal", async () => {
      (
        QueryRunnerRunModel.dangerouslyFindStaleQueryRunnerRuns as jest.Mock
      ).mockResolvedValue([staleLease]);
      mockFindOne.mockResolvedValue({
        id: "ma_1",
        organization: "org_1",
        queries: [{ name: "a", query: "qry_1", status: "running" }],
      });
      mockUpdateOne.mockResolvedValue({ modifiedCount: 0 });

      await runJob();

      expect(mockUpdateOne).toHaveBeenCalledWith(
        expect.objectContaining({ status: "running" }),
        expect.anything(),
      );
      expect(qrrReleaseLock).toHaveBeenCalledWith("qrr_1", expect.any(String));
    });

    it("keeps the incremental lock when the snapshot error CAS does not apply", async () => {
      (
        QueryRunnerRunModel.dangerouslyFindStaleQueryRunnerRuns as jest.Mock
      ).mockResolvedValue([
        {
          ...staleLease,
          targetType: "experimentSnapshot",
          targetId: "snp_1",
        },
      ]);
      mockFindOne.mockResolvedValue({
        id: "snp_1",
        organization: "org_1",
        experiment: "exp_1",
        queries: [{ name: "a", query: "qry_1", status: "running" }],
      });
      (errorSnapshotIfStillRunning as jest.Mock).mockResolvedValue(false);

      await runJob();

      expect(errorSnapshotIfStillRunning).toHaveBeenCalled();
      expect(releaseLock).not.toHaveBeenCalled();
      expect(qrrReleaseLock).toHaveBeenCalledWith("qrr_1", expect.any(String));
    });

    it("does not infer query ownership when the run has no registered query ids", async () => {
      (
        QueryRunnerRunModel.dangerouslyFindStaleQueryRunnerRuns as jest.Mock
      ).mockResolvedValue([
        {
          ...staleLease,
          targetType: "report",
          targetId: "rep_1",
          queryIds: [],
        },
      ]);
      mockFindOne.mockResolvedValue({
        id: "rep_1",
        organization: "org_1",
        queries: [
          { name: "a", query: "qry_a", status: "queued" },
          { name: "b", query: "qry_b", status: "queued" },
        ],
      });

      await runJob();

      expect(failQueryRunnerRunQueries).not.toHaveBeenCalled();
      expect(mockUpdateOne).not.toHaveBeenCalled();
      expect(qrrReleaseLock).toHaveBeenCalledWith("qrr_1", expect.any(String));
    });

    it("errors a never-published target when the run dies during SQL generation", async () => {
      (
        QueryRunnerRunModel.dangerouslyFindStaleQueryRunnerRuns as jest.Mock
      ).mockResolvedValue([
        {
          ...staleLease,
          targetType: "metricAnalysis",
          targetId: "ma_1",
          queryIds: [],
        },
      ]);
      mockFindOne.mockResolvedValue({
        id: "ma_1",
        organization: "org_1",
        queries: [],
      });

      await runJob();

      expect(failQueryRunnerRunQueries).not.toHaveBeenCalled();
      expect(mockUpdateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "ma_1",
          status: "running",
          queries: [],
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            status: "error",
            error: expect.stringContaining("stopped unexpectedly"),
          }),
        }),
      );
      expect(qrrReleaseLock).toHaveBeenCalledWith("qrr_1", expect.any(String));
    });

    it("errors a target whose DAG was never published", async () => {
      (
        QueryRunnerRunModel.dangerouslyFindStaleQueryRunnerRuns as jest.Mock
      ).mockResolvedValue([
        { ...staleLease, targetType: "report", targetId: "rep_1" },
      ]);
      mockFindOne.mockResolvedValue({
        id: "rep_1",
        organization: "org_1",
        queries: [],
      });

      await runJob();

      expect(failQueryRunnerRunQueries).toHaveBeenCalledWith(
        context,
        ["qry_1"],
        expect.any(String),
      );
      expect(mockUpdateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "rep_1",
          queries: [],
        }),
        expect.anything(),
      );
    });

    it("leaves an all-terminal target for resume", async () => {
      (
        QueryRunnerRunModel.dangerouslyFindStaleQueryRunnerRuns as jest.Mock
      ).mockResolvedValue([staleLease]);
      mockFindOne.mockResolvedValue({
        id: "ma_1",
        organization: "org_1",
        queries: [{ name: "a", query: "qry_1", status: "succeeded" }],
      });

      await runJob();

      expect(failQueryRunnerRunQueries).toHaveBeenCalled();
      expect(mockUpdateOne).not.toHaveBeenCalled();
      expect(qrrReleaseLock).toHaveBeenCalledWith("qrr_1", expect.any(String));
    });

    it("does not finalize a target that now points at another run", async () => {
      (
        QueryRunnerRunModel.dangerouslyFindStaleQueryRunnerRuns as jest.Mock
      ).mockResolvedValue([
        { ...staleLease, targetType: "report", targetId: "rep_1" },
      ]);
      mockFindOne.mockResolvedValue({
        id: "rep_1",
        organization: "org_1",
        queries: [{ name: "a", query: "qry_new", status: "running" }],
      });

      await runJob();

      expect(failQueryRunnerRunQueries).toHaveBeenCalledWith(
        context,
        ["qry_1"],
        expect.any(String),
      );
      expect(mockUpdateOne).not.toHaveBeenCalled();
      expect(qrrReleaseLock).toHaveBeenCalledWith("qrr_1", expect.any(String));
    });

    it("releases a claimed lease when cleanup throws", async () => {
      (
        QueryRunnerRunModel.dangerouslyFindStaleQueryRunnerRuns as jest.Mock
      ).mockResolvedValue([staleLease]);
      (failQueryRunnerRunQueries as jest.Mock).mockRejectedValueOnce(
        new Error("query cleanup failed"),
      );

      await runJob();

      expect(qrrReleaseLock).toHaveBeenCalledWith("qrr_1", expect.any(String));
    });

    it("concludes an all-queued target through the pending-pointer guard", async () => {
      (
        QueryRunnerRunModel.dangerouslyFindStaleQueryRunnerRuns as jest.Mock
      ).mockResolvedValue([
        { ...staleLease, targetType: "report", targetId: "rep_1" },
      ]);
      mockFindOne.mockResolvedValue({
        id: "rep_1",
        organization: "org_1",
        queries: [{ name: "a", query: "qry_1", status: "queued" }],
      });

      await runJob();

      expect(mockUpdateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "rep_1",
          queries: [{ name: "a", query: "qry_1", status: "queued" }],
        }),
        expect.anything(),
      );
      expect(qrrReleaseLock).toHaveBeenCalledWith("qrr_1", expect.any(String));
    });
  });

  describe("live lease interlock on the stale-heartbeat sweep", () => {
    const staleQueryDoc = { _id: "oid_1", id: "qry_1", organization: "org_1" };
    const snapshotDoc = {
      id: "snp_1",
      organization: "org_1",
      experiment: "exp_1",
      queries: [{ name: "main", query: "qry_1", status: "running" }],
    };

    it("shields a stale query and skips the parent when a fresh lease is held", async () => {
      (findStaleRunningQueries as jest.Mock).mockResolvedValue([staleQueryDoc]);
      (findRunningSnapshotsByQueryId as jest.Mock).mockResolvedValue([
        snapshotDoc,
      ]);
      qrrGetActiveByTarget.mockResolvedValue({ id: "qrr_9" });

      await runJob();

      expect(errorSnapshotIfStillRunning).not.toHaveBeenCalled();
      expect(releaseLock).not.toHaveBeenCalled();
      expect(failStaleQueries).toHaveBeenCalledWith([]);
    });

    it("errors the parent and fails the stale query when no lease is held", async () => {
      (findStaleRunningQueries as jest.Mock).mockResolvedValue([staleQueryDoc]);
      (findRunningSnapshotsByQueryId as jest.Mock).mockResolvedValue([
        snapshotDoc,
      ]);
      qrrGetActiveByTarget.mockResolvedValue(null);

      await runJob();

      expect(errorSnapshotIfStillRunning).toHaveBeenCalledWith(
        context,
        "snp_1",
        expect.objectContaining({
          error: expect.stringContaining("interupted"),
        }),
        snapshotDoc.queries,
      );
      expect(releaseLock).toHaveBeenCalledWith("exp_1", "snp_1");
      expect(failStaleQueries).toHaveBeenCalledWith([staleQueryDoc]);
    });

    it("continues to the query failure pass when one parent cannot load its org", async () => {
      (findStaleRunningQueries as jest.Mock).mockResolvedValue([staleQueryDoc]);
      (findRunningSnapshotsByQueryId as jest.Mock).mockResolvedValue([
        snapshotDoc,
      ]);
      (getContextForAgendaJobByOrgId as jest.Mock).mockRejectedValueOnce(
        new Error("Organization not found"),
      );

      await runJob();

      expect(errorSnapshotIfStillRunning).not.toHaveBeenCalled();
      expect(failStaleQueries).toHaveBeenCalledWith([staleQueryDoc]);
    });
  });

  describe("stalled snapshot backstop reaper", () => {
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

    it("does not reap an orphaned snapshot with a fresh run lease", async () => {
      mockOrphanedSnapshot({ type: "standard", triggeredBy: "schedule" });
      (
        QueryRunnerRunModel.dangerouslyFindActiveRuns as jest.Mock
      ).mockResolvedValue([
        {
          organization: "org_1",
          targetType: "experimentSnapshot",
          targetId: "snp_1",
        },
      ]);

      await runJob();

      expect(errorSnapshotIfStillRunning).not.toHaveBeenCalled();
      expect(markPendingQueriesAsFailed).not.toHaveBeenCalled();
      expect(updateExperiment).not.toHaveBeenCalled();
      expect(getQueryStatusesByIds).not.toHaveBeenCalled();
    });
  });

  it("does not reap contextual bandit or aggregated runs with fresh leases", async () => {
    const dateCreated = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const contextualBanditSnapshot = {
      id: "cbs_1",
      organization: "org_1",
      contextualBandit: "cb_1",
      dateCreated,
      status: "running",
      queries: [{ name: "main", query: "qry_cb", status: "queued" }],
    };
    const aggregatedFactTableRun = {
      id: "aftr_1",
      organization: "org_1",
      datasourceId: "ds_1",
      factTableId: "ft_1",
      idType: "user_id",
      executionId: "exec_1",
      dateCreated,
      finishedAt: null,
      queries: [{ name: "main", query: "qry_aft", status: "queued" }],
    };
    (getCollection as jest.Mock).mockImplementation(
      (collectionName: string) => {
        if (collectionName === "contextualbanditsnapshots") {
          return makeCollectionMock([contextualBanditSnapshot]);
        }
        if (collectionName === "aggregatedfacttableruns") {
          return makeCollectionMock([aggregatedFactTableRun]);
        }
        return makeCollectionMock();
      },
    );
    (
      QueryRunnerRunModel.dangerouslyFindActiveRuns as jest.Mock
    ).mockResolvedValue([
      {
        organization: "org_1",
        targetType: "contextualBanditSnapshot",
        targetId: "cbs_1",
      },
      {
        organization: "org_1",
        targetType: "aggregatedFactTableRun",
        targetId: "aftr_1",
      },
    ]);

    await runJob();

    expect(getQueryStatusesByIds).not.toHaveBeenCalled();
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });
});
