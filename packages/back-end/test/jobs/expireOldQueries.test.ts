import type Agenda from "agenda";
import type {
  ExperimentSnapshotInterface,
  SnapshotTriggeredBy,
  SnapshotType,
} from "shared/types/experiment-snapshot";
import type { QueryStatus } from "shared/types/query";
import expireOldQueries, {
  classifyStalledSnapshot,
  StalledQueryStatus,
  StalledSnapshotVerdict,
} from "back-end/src/jobs/expireOldQueries";
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

describe("classifyStalledSnapshot", () => {
  const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;

  function row(
    id: string,
    status: QueryStatus,
    {
      createdAgoMs,
      heartbeatAgoMs,
      finishedAgoMs,
    }: {
      createdAgoMs: number;
      heartbeatAgoMs?: number;
      finishedAgoMs?: number;
    },
  ): StalledQueryStatus {
    const createdAt = new Date(NOW - createdAgoMs);
    return {
      id,
      status,
      createdAt,
      heartbeat:
        heartbeatAgoMs === undefined
          ? createdAt
          : new Date(NOW - heartbeatAgoMs),
      ...(finishedAgoMs === undefined
        ? {}
        : { finishedAt: new Date(NOW - finishedAgoMs) }),
    };
  }

  const cases: {
    name: string;
    ageMs: number;
    queryStatuses: StalledQueryStatus[];
    expected: StalledSnapshotVerdict;
  }[] = [
    {
      name: "something is still running",
      ageMs: 3 * HOUR,
      queryStatuses: [
        row("qry_1", "running", { createdAgoMs: 3 * HOUR }),
        row("qry_2", "queued", {
          createdAgoMs: 3 * HOUR,
          heartbeatAgoMs: 6 * MIN,
        }),
        row("qry_3", "queued", { createdAgoMs: 3 * HOUR }),
      ],
      expected: "active",
    },
    {
      name: "never-heartbeated queued queries on a young snapshot",
      ageMs: 10 * MIN,
      queryStatuses: [
        row("qry_1", "queued", { createdAgoMs: 10 * MIN }),
        row("qry_2", "queued", { createdAgoMs: 10 * MIN }),
      ],
      expected: "active",
    },
    {
      name: "never-heartbeated queued queries past the legacy threshold",
      ageMs: 71 * MIN,
      queryStatuses: [
        row("qry_1", "queued", { createdAgoMs: 71 * MIN }),
        row("qry_2", "queued", { createdAgoMs: 71 * MIN }),
      ],
      expected: "orphaned-unknown",
    },
    {
      name: "fresh beats on an hours-old snapshot",
      ageMs: 3 * HOUR,
      queryStatuses: [
        row("qry_1", "queued", {
          createdAgoMs: 3 * HOUR,
          heartbeatAgoMs: 2 * MIN,
        }),
        row("qry_2", "queued", {
          createdAgoMs: 3 * HOUR,
          heartbeatAgoMs: 3 * MIN,
        }),
      ],
      expected: "active",
    },
    {
      name: "stale beats minutes after the runner died",
      ageMs: 12 * MIN,
      queryStatuses: [
        row("qry_1", "queued", {
          createdAgoMs: 12 * MIN,
          heartbeatAgoMs: 6 * MIN,
        }),
        row("qry_2", "queued", {
          createdAgoMs: 12 * MIN,
          heartbeatAgoMs: 7 * MIN,
        }),
      ],
      expected: "orphaned-dead",
    },
    {
      name: "one fresh beat alongside a never-heartbeated query",
      ageMs: 3 * HOUR,
      queryStatuses: [
        row("qry_1", "queued", {
          createdAgoMs: 3 * HOUR,
          heartbeatAgoMs: 1 * MIN,
        }),
        row("qry_2", "queued", { createdAgoMs: 3 * HOUR }),
      ],
      expected: "active",
    },
    {
      name: "stale beat with one query already succeeded",
      ageMs: 12 * MIN,
      queryStatuses: [
        row("qry_1", "succeeded", {
          createdAgoMs: 30 * MIN,
          finishedAgoMs: 20 * MIN,
        }),
        row("qry_2", "queued", {
          createdAgoMs: 12 * MIN,
          heartbeatAgoMs: 6 * MIN,
        }),
      ],
      expected: "orphaned-dead",
    },
    {
      name: "heartbeat only a millisecond past createdAt is not a real beat",
      ageMs: 3 * HOUR,
      queryStatuses: [
        row("qry_1", "queued", {
          createdAgoMs: 3 * HOUR,
          heartbeatAgoMs: 3 * HOUR - 1,
        }),
        row("qry_2", "queued", {
          createdAgoMs: 3 * HOUR,
          heartbeatAgoMs: 3 * HOUR - 1,
        }),
      ],
      expected: "orphaned-unknown",
    },
    {
      name: "all succeeded on a young snapshot",
      ageMs: 30 * MIN,
      queryStatuses: [
        row("qry_1", "succeeded", {
          createdAgoMs: 30 * MIN,
          finishedAgoMs: 25 * MIN,
        }),
        row("qry_2", "succeeded", {
          createdAgoMs: 30 * MIN,
          finishedAgoMs: 20 * MIN,
        }),
      ],
      expected: "active",
    },
    {
      name: "all succeeded but still inside the finalize grace window",
      ageMs: 2 * HOUR,
      queryStatuses: [
        row("qry_1", "succeeded", {
          createdAgoMs: 2 * HOUR,
          finishedAgoMs: 30 * MIN,
        }),
        row("qry_2", "succeeded", {
          createdAgoMs: 2 * HOUR,
          finishedAgoMs: 3 * MIN,
        }),
      ],
      expected: "active",
    },
    {
      name: "all succeeded and past the finalize grace window",
      ageMs: 2 * HOUR,
      queryStatuses: [
        row("qry_1", "succeeded", {
          createdAgoMs: 2 * HOUR,
          finishedAgoMs: 30 * MIN,
        }),
        row("qry_2", "succeeded", {
          createdAgoMs: 2 * HOUR,
          finishedAgoMs: 20 * MIN,
        }),
      ],
      expected: "stalled-terminal",
    },
    {
      name: "succeeded plus failed, past the finalize grace window",
      ageMs: 2 * HOUR,
      queryStatuses: [
        row("qry_1", "succeeded", {
          createdAgoMs: 2 * HOUR,
          finishedAgoMs: 20 * MIN,
        }),
        row("qry_2", "failed", {
          createdAgoMs: 2 * HOUR,
          finishedAgoMs: 20 * MIN,
        }),
      ],
      expected: "stalled-terminal",
    },
  ];

  it.each(cases)("$name -> $expected", ({ ageMs, queryStatuses, expected }) => {
    expect(
      classifyStalledSnapshot({
        queryStatuses,
        snapshotDateCreated: new Date(NOW - ageMs),
        now: NOW,
      }),
    ).toBe(expected);
  });
});

describe("expireOldQueries stalled snapshot reaper", () => {
  const releaseLock = jest.fn().mockResolvedValue(undefined);
  const context = {
    org: { id: "org_1" },
    models: {
      incrementalRefresh: { releaseLock },
      metricAnalysis: { update: jest.fn() },
    },
  };

  // Serve pages from a fixed candidate list the way the real query does:
  // oldest-first, honoring the caller's limit and exclusion list.
  function mockCandidates(candidates: ExperimentSnapshotInterface[]) {
    (
      dangerousFindStalledRunningSnapshotsFromAllOrgs as jest.Mock
    ).mockImplementation(
      async (_stalledBefore: Date, limit: number, excludeIds: string[] = []) =>
        candidates.filter((c) => !excludeIds.includes(c.id)).slice(0, limit),
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (getStaleQueries as jest.Mock).mockResolvedValue([]);
    mockCandidates([]);
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

  function runningSnapshot(
    id: string,
    snapshot: {
      type?: SnapshotType;
      triggeredBy?: SnapshotTriggeredBy;
      report?: string;
      ageMs?: number;
    },
  ): ExperimentSnapshotInterface {
    const dateCreated = new Date(
      Date.now() - (snapshot.ageMs ?? 2 * 60 * 60 * 1000),
    );
    return {
      id,
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
      queries: [{ name: "main", query: `qry_${id}`, status: "queued" }],
      unknownVariations: [],
      multipleExposures: 0,
      analyses: [],
    } as unknown as ExperimentSnapshotInterface;
  }

  function mockOrphanedSnapshot(snapshot: {
    type?: SnapshotType;
    triggeredBy?: SnapshotTriggeredBy;
    report?: string;
    ageMs?: number;
    statuses?: StalledQueryStatus[];
  }) {
    const candidate = runningSnapshot("snp_1", snapshot);
    candidate.queries = [{ name: "main", query: "qry_1", status: "queued" }];
    mockCandidates([candidate]);
    (getQueryStatusesByIds as jest.Mock).mockResolvedValue(
      snapshot.statuses ?? [{ id: "qry_1", status: "queued" }],
    );
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

  it("concludes an orphaned DAG whose queued heartbeats went stale, minutes after death", async () => {
    const now = Date.now();
    mockOrphanedSnapshot({
      type: "standard",
      triggeredBy: "manual",
      ageMs: 12 * 60 * 1000,
      statuses: [
        {
          id: "qry_1",
          status: "queued",
          createdAt: new Date(now - 12 * 60 * 1000),
          heartbeat: new Date(now - 6 * 60 * 1000),
        },
      ],
    });

    await runJob();

    expect(errorSnapshotIfStillRunning).toHaveBeenCalledWith(
      context,
      "snp_1",
      expect.objectContaining({
        error: expect.stringContaining("queries were never started"),
      }),
    );
    expect(markPendingQueriesAsFailed).toHaveBeenCalledWith(
      context,
      ["qry_1"],
      expect.any(String),
    );
    expect(updateExperiment).not.toHaveBeenCalled();
  });

  it("pages past a full page of live snapshots to reach a newer dead one", async () => {
    const now = Date.now();
    // 50 healthy long-running snapshots fill the first page; the orphaned
    // one is newer and only reachable on the second page.
    const live = Array.from({ length: 50 }, (_, i) =>
      runningSnapshot(`live_${i}`, { ageMs: (60 + i) * 60 * 1000 }),
    );
    const dead = runningSnapshot("dead", {
      type: "standard",
      triggeredBy: "manual",
      ageMs: 12 * 60 * 1000,
    });
    mockCandidates([...live, dead]);
    (getQueryStatusesByIds as jest.Mock).mockImplementation(
      async (_org: string, ids: string[]) =>
        ids.map((id) => ({
          id,
          status: "queued",
          createdAt: new Date(now - 60 * 60 * 1000),
          heartbeat: new Date(
            now - (id === "qry_dead" ? 6 * 60 * 1000 : 30 * 1000),
          ),
        })),
    );

    await runJob();

    expect(
      dangerousFindStalledRunningSnapshotsFromAllOrgs,
    ).toHaveBeenCalledTimes(3);
    expect(errorSnapshotIfStillRunning).toHaveBeenCalledTimes(1);
    expect(errorSnapshotIfStillRunning).toHaveBeenCalledWith(
      context,
      "dead",
      expect.objectContaining({
        error: expect.stringContaining("queries were never started"),
      }),
    );
  });

  it("leaves an orphaned DAG alone while its queued heartbeats are fresh, however old the snapshot is", async () => {
    const now = Date.now();
    mockOrphanedSnapshot({
      type: "standard",
      triggeredBy: "manual",
      ageMs: 3 * 60 * 60 * 1000,
      statuses: [
        {
          id: "qry_1",
          status: "queued",
          createdAt: new Date(now - 3 * 60 * 60 * 1000),
          heartbeat: new Date(now - 60 * 1000),
        },
      ],
    });

    await runJob();

    expect(errorSnapshotIfStillRunning).not.toHaveBeenCalled();
    expect(markPendingQueriesAsFailed).not.toHaveBeenCalled();
  });
});
