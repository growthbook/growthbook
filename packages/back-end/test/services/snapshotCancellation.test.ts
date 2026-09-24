import mongoose from "mongoose";
import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotInterface,
} from "shared/types/experiment-snapshot";
import { Queries, QueryPointer, QueryStatus } from "shared/types/query";
import { buildAnalysisKey } from "shared/snapshot-analysis-chunks";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";
import { snapshotFactory } from "back-end/test/factories/Snapshot.factory";
import {
  cancelExperimentSnapshot,
  planSnapshotCancel,
  SNAPSHOT_CANCELLED_ERROR,
  SnapshotCancelAction,
} from "back-end/src/services/snapshotCancellation";
import {
  createExperimentSnapshotModel,
  findSnapshotById,
} from "back-end/src/models/ExperimentSnapshotModel";
import { ExperimentSnapshotAnalysisChunkModel } from "back-end/src/models/ExperimentSnapshotAnalysisChunkModel";
import {
  createCompletedQuery,
  createNewQuery,
  getQueriesByIds,
  markPendingQueriesAsFailed,
  setQueryExternalId,
} from "back-end/src/models/QueryModel";
import { createReport, getReportById } from "back-end/src/models/ReportModel";
import { QUERY_CANCELLED_BY_USER_ERROR } from "back-end/src/queryRunners/QueryRunner";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { BadRequestError } from "back-end/src/util/errors";
import { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/services/datasource", () => ({
  getIntegrationFromDatasourceId: jest.fn(),
}));

function pointer(query: string, status: QueryStatus): QueryPointer {
  return { name: `name_${query}`, query, status };
}

describe("planSnapshotCancel", () => {
  type Row = {
    title: string;
    status: ExperimentSnapshotInterface["status"];
    queries: Queries;
    docs: { id: string; status: QueryStatus }[];
    reportSnapshotId: string | null;
    action: SnapshotCancelAction;
    expected: Queries;
  };

  it.each<Row>([
    {
      title: "running and not pinned by a report is deleted",
      status: "running",
      queries: [pointer("q1", "running"), pointer("q2", "queued")],
      docs: [
        { id: "q1", status: "failed" },
        { id: "q2", status: "failed" },
      ],
      reportSnapshotId: null,
      action: "delete",
      expected: [pointer("q1", "failed"), pointer("q2", "failed")],
    },
    {
      title:
        "running while the report points at a different snapshot is deleted",
      status: "running",
      queries: [pointer("q1", "running")],
      docs: [{ id: "q1", status: "failed" }],
      reportSnapshotId: "snp_other",
      action: "delete",
      expected: [pointer("q1", "failed")],
    },
    {
      title: "running and pinned by report.snapshot is concluded",
      status: "running",
      queries: [pointer("q1", "succeeded"), pointer("q2", "running")],
      docs: [
        { id: "q1", status: "succeeded" },
        { id: "q2", status: "failed" },
      ],
      reportSnapshotId: "snp_1",
      action: "conclude",
      expected: [pointer("q1", "succeeded"), pointer("q2", "failed")],
    },
    {
      title: "zero-query running is deleted",
      status: "running",
      queries: [],
      docs: [],
      reportSnapshotId: null,
      action: "delete",
      expected: [],
    },
    {
      title: "zero-query running pinned by its report is concluded",
      status: "running",
      queries: [],
      docs: [],
      reportSnapshotId: "snp_1",
      action: "conclude",
      expected: [],
    },
    {
      title: "terminal with stale live pointers is reconciled",
      status: "error",
      queries: [pointer("q1", "failed"), pointer("q2", "queued")],
      docs: [
        { id: "q1", status: "failed" },
        { id: "q2", status: "failed" },
      ],
      reportSnapshotId: null,
      action: "reconcile",
      expected: [pointer("q1", "failed"), pointer("q2", "failed")],
    },
    {
      title: "terminal and coherent is left alone",
      status: "success",
      queries: [pointer("q1", "succeeded"), pointer("q2", "succeeded")],
      docs: [
        { id: "q1", status: "succeeded" },
        { id: "q2", status: "succeeded" },
      ],
      reportSnapshotId: "snp_1",
      action: "none",
      expected: [pointer("q1", "succeeded"), pointer("q2", "succeeded")],
    },
    {
      title: "a queued pointer takes its terminal doc's status",
      status: "success",
      queries: [pointer("q1", "succeeded"), pointer("q2", "queued")],
      docs: [
        { id: "q1", status: "succeeded" },
        { id: "q2", status: "succeeded" },
      ],
      reportSnapshotId: null,
      action: "reconcile",
      expected: [pointer("q1", "succeeded"), pointer("q2", "succeeded")],
    },
    {
      title: "a pointer whose doc is missing becomes failed",
      status: "error",
      queries: [pointer("q1", "running"), pointer("q2", "failed")],
      docs: [{ id: "q2", status: "failed" }],
      reportSnapshotId: null,
      action: "reconcile",
      expected: [pointer("q1", "failed"), pointer("q2", "failed")],
    },
    {
      title:
        "duplicate pointer ids all take the doc status, order and names kept",
      status: "error",
      queries: [
        { name: "first", query: "q1", status: "queued" },
        { name: "middle", query: "q2", status: "succeeded" },
        { name: "second", query: "q1", status: "running" },
      ],
      docs: [
        { id: "q1", status: "failed" },
        { id: "q2", status: "succeeded" },
      ],
      reportSnapshotId: null,
      action: "reconcile",
      expected: [
        { name: "first", query: "q1", status: "failed" },
        { name: "middle", query: "q2", status: "succeeded" },
        { name: "second", query: "q1", status: "failed" },
      ],
    },
  ])(
    "$title",
    ({ status, queries, docs, reportSnapshotId, action, expected }) => {
      expect(
        planSnapshotCancel({
          snapshot: { id: "snp_1", status, queries },
          docs,
          reportSnapshotId,
        }),
      ).toEqual({ action, queries: expected });
    },
  );
});

describe("cancelExperimentSnapshot", () => {
  const organization = "org_1";
  let context: ReqContext;
  let releaseLock: jest.Mock;
  let cancelQuery: jest.Mock;
  let canRunExperimentQueries: jest.Mock;

  beforeAll(async () => {
    await connectTestMongo();
  }, 60000);

  afterAll(async () => {
    await disconnectTestMongo();
  });

  beforeEach(() => {
    releaseLock = jest.fn().mockResolvedValue(undefined);
    cancelQuery = jest.fn().mockResolvedValue(undefined);
    canRunExperimentQueries = jest.fn().mockReturnValue(true);
    context = {
      org: { id: organization },
      populateForeignRefs: jest.fn().mockResolvedValue(undefined),
      permissions: {
        canRunExperimentQueries,
        throwPermissionError: () => {
          throw new Error("permission denied");
        },
      },
      models: { incrementalRefresh: { releaseLock } },
    } as unknown as ReqContext;
    context.models.experimentSnapshotAnalysisChunks =
      new ExperimentSnapshotAnalysisChunkModel(context);
    jest.mocked(getIntegrationFromDatasourceId).mockResolvedValue({
      datasource: { id: "ds_1" },
      cancelQuery,
    } as unknown as SourceIntegrationInterface);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  async function insertQuery(
    status: QueryStatus,
    externalId: string | null = null,
  ): Promise<string> {
    const base = {
      organization,
      datasource: "ds_1",
      language: "sql" as const,
      query: "SELECT 1",
      queryType: "experimentResults" as const,
    };
    const doc =
      status === "succeeded"
        ? await createCompletedQuery({ ...base, rawResult: [] })
        : await createNewQuery({
            ...base,
            dependencies: [],
            running: status === "running",
          });
    if (externalId !== null) {
      await setQueryExternalId(context, doc, externalId);
    }
    if (status === "failed") {
      await markPendingQueriesAsFailed(context, [doc.id], "Query timed out");
    }
    return doc.id;
  }

  async function queryStatuses(ids: string[]) {
    const docs = await getQueriesByIds(context, ids, false);
    const byId = new Map(docs.map((d) => [d.id, d]));
    return ids.map((id) => ({
      status: byId.get(id)?.status,
      error: byId.get(id)?.error,
    }));
  }

  function analysisWithResults(): ExperimentSnapshotAnalysis {
    return {
      analysisKey: buildAnalysisKey(),
      dateCreated: new Date("2025-01-01T00:00:00Z"),
      status: "success",
      settings: {
        dimensions: [],
        statsEngine: "bayesian",
        regressionAdjusted: false,
        sequentialTesting: false,
        differenceType: "relative",
        pValueCorrection: null,
        baselineVariationIndex: 0,
        numGoalMetrics: 1,
      },
      results: [
        {
          name: "",
          srm: 0.95,
          variations: [
            {
              users: 100,
              metrics: { met_1: { value: 10, cr: 0.1, users: 100 } },
            },
            {
              users: 120,
              metrics: { met_1: { value: 15, cr: 0.125, users: 120 } },
            },
          ],
        },
      ],
    };
  }

  async function insertReportSnapshot({
    id,
    status,
    queries,
    reportSnapshotId,
    error = "",
    withResults = false,
    existingReportId,
    dateCreated = new Date(),
  }: {
    id: string;
    status: ExperimentSnapshotInterface["status"];
    queries: Queries;
    reportSnapshotId: string;
    error?: string;
    withResults?: boolean;
    existingReportId?: string;
    dateCreated?: Date;
  }): Promise<{ snapshot: ExperimentSnapshotInterface; reportId: string }> {
    const reportId =
      existingReportId ??
      (
        await createReport(organization, {
          type: "experiment-snapshot",
          experimentId: "exp_1",
          snapshot: reportSnapshotId,
        })
      ).id;
    const snapshot = snapshotFactory.build({
      id,
      experiment: "exp_1",
      type: "report",
      report: reportId,
      status,
      queries,
      error,
      dateCreated,
    });
    snapshot.settings = {
      ...snapshot.settings,
      experimentId: "exp_1",
      goalMetrics: ["met_1"],
      variations: [
        { id: "0", weight: 0.5 },
        { id: "1", weight: 0.5 },
      ],
    };
    snapshot.analyses = withResults ? [analysisWithResults()] : [];
    return {
      snapshot: await createExperimentSnapshotModel({
        context,
        data: snapshot,
      }),
      reportId,
    };
  }

  async function reportSnapshotId(reportId: string) {
    const report = await getReportById(organization, reportId);
    return report?.type === "experiment-snapshot" ? report.snapshot : null;
  }

  it("deletes a running snapshot the report does not point at", async () => {
    const running = await insertQuery("running", "job_live");
    const queued = await insertQuery("queued");
    const { snapshot, reportId } = await insertReportSnapshot({
      id: "snp_run",
      status: "running",
      queries: [pointer(running, "running"), pointer(queued, "queued")],
      withResults: true,
      reportSnapshotId: "snp_prev",
    });
    expect(
      await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
        snapshot.id,
      ),
    ).toHaveLength(1);

    const result = await cancelExperimentSnapshot(context, snapshot);

    expect(result).toEqual({
      outcome: "deleted",
      cancelledQueryIds: [running, queued],
    });
    expect(await findSnapshotById(context, snapshot.id)).toBeNull();
    expect(
      await context.models.experimentSnapshotAnalysisChunks.getAllChunksForSnapshot(
        snapshot.id,
      ),
    ).toHaveLength(0);
    expect(releaseLock).toHaveBeenCalledWith("exp_1", snapshot.id);
    expect(await queryStatuses([running, queued])).toEqual([
      { status: "failed", error: QUERY_CANCELLED_BY_USER_ERROR },
      { status: "failed", error: QUERY_CANCELLED_BY_USER_ERROR },
    ]);
    expect(cancelQuery.mock.calls).toEqual([["job_live", undefined]]);
    expect(await reportSnapshotId(reportId)).toBe("snp_prev");
  });

  it("keeps a running snapshot pinned by report.snapshot as a cancelled error when the report has no successful snapshot", async () => {
    const done = await insertQuery("succeeded");
    const running = await insertQuery("running", "job_live");
    const { snapshot, reportId } = await insertReportSnapshot({
      id: "snp_pinned",
      status: "running",
      queries: [pointer(done, "succeeded"), pointer(running, "running")],
      reportSnapshotId: "snp_pinned",
    });

    const result = await cancelExperimentSnapshot(context, snapshot);

    expect(result).toEqual({
      outcome: "concluded",
      cancelledQueryIds: [running],
    });
    const stored = await findSnapshotById(context, snapshot.id);
    expect(stored?.status).toBe("error");
    expect(stored?.error).toBe(SNAPSHOT_CANCELLED_ERROR);
    expect(stored?.queries).toEqual([
      pointer(done, "succeeded"),
      pointer(running, "failed"),
    ]);
    expect(await reportSnapshotId(reportId)).toBe("snp_pinned");
    expect(releaseLock).toHaveBeenCalledWith("exp_1", snapshot.id);
    expect(cancelQuery.mock.calls).toEqual([["job_live", undefined]]);
  });

  it("moves the report from a cancelled pinned run to its latest successful snapshot", async () => {
    const running = await insertQuery("running", "job_live");
    const { snapshot, reportId } = await insertReportSnapshot({
      id: "snp_pinned",
      status: "running",
      queries: [pointer(running, "running")],
      reportSnapshotId: "snp_pinned",
      dateCreated: new Date("2025-01-04T00:00:00Z"),
    });
    for (const [id, status, day] of [
      ["snp_old_success", "success", "01"],
      ["snp_new_success", "success", "02"],
      ["snp_newer_error", "error", "03"],
    ] as const) {
      await insertReportSnapshot({
        id,
        status,
        queries: [],
        reportSnapshotId: "snp_pinned",
        existingReportId: reportId,
        dateCreated: new Date(`2025-01-${day}T00:00:00Z`),
      });
    }

    const result = await cancelExperimentSnapshot(context, snapshot);

    expect(result.outcome).toBe("concluded");
    expect(await findSnapshotById(context, snapshot.id)).toMatchObject({
      status: "error",
      error: SNAPSHOT_CANCELLED_ERROR,
    });
    expect(await reportSnapshotId(reportId)).toBe("snp_new_success");
  });

  it("fences stale live pointers on a terminal snapshot without touching its status or error", async () => {
    const failedWithJob = await insertQuery("failed", "job_old");
    const queued = await insertQuery("queued");
    const runningWithJob = await insertQuery("running", "job_live");
    const { snapshot, reportId } = await insertReportSnapshot({
      id: "snp_incident",
      status: "error",
      error: "Query timed out",
      queries: [
        pointer(failedWithJob, "failed"),
        pointer(queued, "queued"),
        pointer(runningWithJob, "queued"),
      ],
      reportSnapshotId: "snp_prev",
    });

    const result = await cancelExperimentSnapshot(context, snapshot);

    expect(result).toEqual({
      outcome: "reconciled",
      cancelledQueryIds: [queued, runningWithJob],
    });
    const stored = await findSnapshotById(context, snapshot.id);
    expect(stored?.status).toBe("error");
    expect(stored?.error).toBe("Query timed out");
    expect(stored?.queries).toEqual([
      pointer(failedWithJob, "failed"),
      pointer(queued, "failed"),
      pointer(runningWithJob, "failed"),
    ]);
    expect(
      await queryStatuses([failedWithJob, queued, runningWithJob]),
    ).toEqual([
      { status: "failed", error: "Query timed out" },
      { status: "failed", error: QUERY_CANCELLED_BY_USER_ERROR },
      { status: "failed", error: QUERY_CANCELLED_BY_USER_ERROR },
    ]);
    expect(cancelQuery.mock.calls).toEqual([["job_live", undefined]]);
    expect(releaseLock).toHaveBeenCalledWith("exp_1", snapshot.id);
    expect(await reportSnapshotId(reportId)).toBe("snp_prev");
  });

  it("moves the report from a stuck errored run to its latest successful snapshot", async () => {
    const queued = await insertQuery("queued");
    const { snapshot, reportId } = await insertReportSnapshot({
      id: "snp_stuck",
      status: "error",
      error: "Query timed out",
      queries: [pointer(queued, "queued")],
      reportSnapshotId: "snp_stuck",
      dateCreated: new Date("2025-01-02T00:00:00Z"),
    });
    await insertReportSnapshot({
      id: "snp_prev_success",
      status: "success",
      queries: [],
      reportSnapshotId: "snp_stuck",
      existingReportId: reportId,
      dateCreated: new Date("2025-01-01T00:00:00Z"),
    });

    const result = await cancelExperimentSnapshot(context, snapshot);

    expect(result).toEqual({
      outcome: "reconciled",
      cancelledQueryIds: [queued],
    });
    expect(await findSnapshotById(context, snapshot.id)).toMatchObject({
      status: "error",
      error: "Query timed out",
      queries: [pointer(queued, "failed")],
    });
    expect(await reportSnapshotId(reportId)).toBe("snp_prev_success");
  });

  it("keeps the results and status of a successful snapshot with a stale pointer", async () => {
    const done = await insertQuery("succeeded");
    const stale = await insertQuery("running");
    const { snapshot, reportId } = await insertReportSnapshot({
      id: "snp_success",
      status: "success",
      queries: [pointer(done, "succeeded"), pointer(stale, "running")],
      withResults: true,
      reportSnapshotId: "snp_success",
    });

    const result = await cancelExperimentSnapshot(context, snapshot);

    expect(result.outcome).toBe("reconciled");
    const stored = await findSnapshotById(context, snapshot.id);
    expect(stored?.status).toBe("success");
    expect(stored?.error).toBe("");
    expect(
      stored?.analyses[0].results[0].variations[0].metrics.met_1.value,
    ).toBe(10);
    expect(stored?.queries).toEqual([
      pointer(done, "succeeded"),
      pointer(stale, "failed"),
    ]);
    expect(await reportSnapshotId(reportId)).toBe("snp_success");
  });

  it("refuses to cancel a successful snapshot with nothing pending", async () => {
    const done = await insertQuery("succeeded");
    const { snapshot, reportId } = await insertReportSnapshot({
      id: "snp_done",
      status: "success",
      queries: [pointer(done, "succeeded")],
      withResults: true,
      reportSnapshotId: "snp_done",
    });

    await expect(cancelExperimentSnapshot(context, snapshot)).rejects.toThrow(
      new BadRequestError("Snapshot is not running"),
    );

    const stored = await findSnapshotById(context, snapshot.id);
    expect(stored?.status).toBe("success");
    expect(stored?.queries).toEqual([pointer(done, "succeeded")]);
    expect(await reportSnapshotId(reportId)).toBe("snp_done");
    expect(releaseLock).not.toHaveBeenCalled();
    expect(cancelQuery).not.toHaveBeenCalled();
  });

  it("deletes a zero-query running snapshot without calling the warehouse", async () => {
    const { snapshot } = await insertReportSnapshot({
      id: "snp_zombie",
      status: "running",
      queries: [],
      reportSnapshotId: "snp_prev",
    });

    const result = await cancelExperimentSnapshot(context, snapshot);

    expect(result).toEqual({ outcome: "deleted", cancelledQueryIds: [] });
    expect(await findSnapshotById(context, snapshot.id)).toBeNull();
    expect(cancelQuery).not.toHaveBeenCalled();
  });

  it("reconciles once when a runner concluded the snapshot before the cancel's write", async () => {
    const running = await insertQuery("running");
    const { snapshot } = await insertReportSnapshot({
      id: "snp_raced",
      status: "error",
      error: "Runner concluded first",
      queries: [pointer(running, "running")],
      reportSnapshotId: "snp_prev",
    });

    const result = await cancelExperimentSnapshot(context, {
      ...snapshot,
      status: "running",
    });

    expect(result.outcome).toBe("reconciled");
    const stored = await findSnapshotById(context, snapshot.id);
    expect(stored?.status).toBe("error");
    expect(stored?.error).toBe("Runner concluded first");
    expect(stored?.queries).toEqual([pointer(running, "failed")]);
  });

  it("moves the report back when a runner errored the pinned run before the cancel's write", async () => {
    const running = await insertQuery("running");
    const { snapshot, reportId } = await insertReportSnapshot({
      id: "snp_raced",
      status: "error",
      error: QUERY_CANCELLED_BY_USER_ERROR,
      queries: [pointer(running, "running")],
      reportSnapshotId: "snp_raced",
      dateCreated: new Date("2025-01-02T00:00:00Z"),
    });
    await insertReportSnapshot({
      id: "snp_prev_success",
      status: "success",
      queries: [],
      reportSnapshotId: "snp_raced",
      existingReportId: reportId,
      dateCreated: new Date("2025-01-01T00:00:00Z"),
    });

    const result = await cancelExperimentSnapshot(context, {
      ...snapshot,
      status: "running",
    });

    expect(result.outcome).toBe("reconciled");
    expect(await findSnapshotById(context, snapshot.id)).toMatchObject({
      status: "error",
      error: QUERY_CANCELLED_BY_USER_ERROR,
    });
    expect(await reportSnapshotId(reportId)).toBe("snp_prev_success");
  });

  it("keeps the report on a pinned run a runner finished successfully before the cancel's write", async () => {
    const done = await insertQuery("succeeded");
    const { snapshot, reportId } = await insertReportSnapshot({
      id: "snp_raced",
      status: "success",
      queries: [pointer(done, "succeeded")],
      withResults: true,
      reportSnapshotId: "snp_raced",
      dateCreated: new Date("2025-01-02T00:00:00Z"),
    });
    await insertReportSnapshot({
      id: "snp_prev_success",
      status: "success",
      queries: [],
      reportSnapshotId: "snp_raced",
      existingReportId: reportId,
      dateCreated: new Date("2025-01-01T00:00:00Z"),
    });

    const result = await cancelExperimentSnapshot(context, {
      ...snapshot,
      status: "running",
    });

    expect(result).toEqual({ outcome: "unchanged", cancelledQueryIds: [] });
    const stored = await findSnapshotById(context, snapshot.id);
    expect(stored?.status).toBe("success");
    expect(
      stored?.analyses[0].results[0].variations[0].metrics.met_1.value,
    ).toBe(10);
    expect(await reportSnapshotId(reportId)).toBe("snp_raced");
  });

  it("refuses a second cancel and leaves everything unchanged", async () => {
    const running = await insertQuery("running", "job_live");
    const { snapshot } = await insertReportSnapshot({
      id: "snp_twice",
      status: "running",
      queries: [pointer(running, "running")],
      reportSnapshotId: "snp_twice",
    });
    await cancelExperimentSnapshot(context, snapshot);
    const concluded = await findSnapshotById(context, snapshot.id);
    cancelQuery.mockClear();

    if (!concluded) throw new Error("expected the pinned snapshot to be kept");
    await expect(cancelExperimentSnapshot(context, concluded)).rejects.toThrow(
      new BadRequestError("Snapshot is not running"),
    );

    expect(await findSnapshotById(context, snapshot.id)).toMatchObject({
      status: "error",
      error: SNAPSHOT_CANCELLED_ERROR,
      queries: [pointer(running, "failed")],
    });
    expect(cancelQuery).not.toHaveBeenCalled();
  });

  it("returns unchanged when the snapshot was already deleted by an earlier cancel", async () => {
    const { snapshot } = await insertReportSnapshot({
      id: "snp_gone",
      status: "running",
      queries: [],
      reportSnapshotId: "snp_prev",
    });
    await cancelExperimentSnapshot(context, snapshot);

    const result = await cancelExperimentSnapshot(context, snapshot);

    expect(result).toEqual({ outcome: "unchanged", cancelledQueryIds: [] });
  });

  it("refuses without experiment-query permission before fencing anything", async () => {
    canRunExperimentQueries.mockReturnValue(false);
    const running = await insertQuery("running", "job_live");
    const { snapshot } = await insertReportSnapshot({
      id: "snp_denied",
      status: "running",
      queries: [pointer(running, "running")],
      reportSnapshotId: "snp_prev",
    });

    await expect(cancelExperimentSnapshot(context, snapshot)).rejects.toThrow(
      "permission denied",
    );

    expect(await queryStatuses([running])).toEqual([
      { status: "running", error: undefined },
    ]);
    expect(await findSnapshotById(context, snapshot.id)).not.toBeNull();
    expect(cancelQuery).not.toHaveBeenCalled();
  });
});
