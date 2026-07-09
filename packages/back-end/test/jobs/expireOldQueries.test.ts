import type Agenda from "agenda";
import type {
  SnapshotTriggeredBy,
  SnapshotType,
} from "shared/types/experiment-snapshot";
import expireOldQueries from "back-end/src/jobs/expireOldQueries";
import {
  dangerousFindStalledRunningSnapshotsFromAllOrgs,
  errorSnapshotIfStillRunning,
} from "back-end/src/models/ExperimentSnapshotModel";
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
  updateSnapshot: jest.fn(),
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
  const context = {
    org: { id: "org_1" },
    models: {
      incrementalRefresh: { releaseLock },
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
});
