import Agenda from "agenda";
import { Queries } from "shared/types/query";
import {
  AggregatedFactTableInterface,
  AggregatedFactTableRunInterface,
  ContextualBanditSnapshotInterface,
  SafeRolloutSnapshotInterface,
} from "shared/validators";
import {
  errorSnapshotIfStillRunning,
  findRunningSnapshotsByQueryId,
  dangerousFindStalledRunningSnapshotsFromAllOrgs,
  updateSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import {
  findRunningMetricsByQueryId,
  updateMetricQueriesAndStatus,
} from "back-end/src/models/MetricModel";
import {
  findRunningPastExperimentsByQueryId,
  updatePastExperiments,
} from "back-end/src/models/PastExperimentsModel";
import {
  getQueryStatusesByIds,
  getStaleQueries,
  markPendingQueriesAsFailed,
} from "back-end/src/models/QueryModel";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  findReportsByQueryId,
  updateReport,
} from "back-end/src/models/ReportModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { MetricAnalysisModel } from "back-end/src/models/MetricAnalysisModel";
import { getCollection } from "back-end/src/util/mongo.util";
const JOB_NAME = "expireOldQueries";

// The time after which a snapshot is considered stalled
const STALLED_SNAPSHOT_THRESHOLD_MS = 60 * 60 * 1000;
// The allowable time between the last query finishing and the snapshot being finalized
const STALLED_FINALIZE_GRACE_MS = 10 * 60 * 1000;
const STALLED_SNAPSHOT_REAP_LIMIT = 50;

// Accessed via raw collections (not context-scoped BaseModel) so this cross-org reaper needs no per-run org context.
const AGGREGATED_FACT_TABLE_RUN_COLLECTION = "aggregatedfacttableruns";
const AGGREGATED_FACT_TABLE_COLLECTION = "aggregatedfacttables";

function updateQueryStatus(queries: Queries, ids: Set<string>) {
  queries.forEach((q) => {
    if (ids.has(q.query)) {
      q.status = "failed";
    }
  });
}

const expireOldQueries = async () => {
  const queries = await getStaleQueries();
  const queryIds = new Set(queries.map((q) => q.id));
  const orgIds = new Set(queries.map((q) => q.organization));

  if (queryIds.size > 0) {
    logger.info("Found " + queryIds.size + " stale queries");
  } else {
    logger.debug("Found no stale queries");
  }

  // Look for matching snapshots and update the status
  const snapshots = await findRunningSnapshotsByQueryId([...queryIds]);
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    logger.info("Updating status of snapshot " + snapshot.id);
    updateQueryStatus(snapshot.queries, queryIds);
    const context = await getContextForAgendaJobByOrgId(snapshot.organization);
    await updateSnapshot({
      context,
      id: snapshot.id,
      updates: {
        error: "Queries were interupted. Please try updating results again.",
        status: "error",
        queries: snapshot.queries,
      },
    });

    // Release the incremental refresh lock if this snapshot held it.
    // This is safe because releaseLock filters on currentExecutionSnapshotId,
    // so it only releases the lock if this specific snapshot still holds it.
    await context.models.incrementalRefresh
      .releaseLock(snapshot.experiment, snapshot.id)
      .catch((e) =>
        logger.warn(
          e,
          "Failed to release incremental lock for expired snapshot",
        ),
      );
  }

  // Look for matching reports and update the status
  const reports = await findReportsByQueryId([...queryIds]);
  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    if (report.type !== "experiment") continue;
    logger.info("Updating status of report " + report.id);
    updateQueryStatus(report.queries, queryIds);
    await updateReport(report.organization, report.id, {
      error: "Queries were interupted. Please try updating results again.",
      queries: report.queries,
    });
  }

  // Look for matching metrics and update the status
  const metrics = await findRunningMetricsByQueryId([...orgIds], [...queryIds]);
  for (let i = 0; i < metrics.length; i++) {
    const metric = metrics[i];
    logger.info("Updating status of metric " + metric.id);
    updateQueryStatus(metric.queries, queryIds);
    await updateMetricQueriesAndStatus(metric, {
      queries: metric.queries,
      analysisError:
        "Queries were interupted. Please try re-running the analysis.",
    });
  }

  // Look for matching pastExperiments and update the status
  const pastExperiments = await findRunningPastExperimentsByQueryId(
    [...orgIds],
    [...queryIds],
  );
  for (let i = 0; i < pastExperiments.length; i++) {
    const pastExperiment = pastExperiments[i];
    logger.info("Updating status of pastExperiment " + pastExperiment.id);
    updateQueryStatus(pastExperiment.queries, queryIds);
    await updatePastExperiments(pastExperiment, {
      queries: pastExperiment.queries,
      error: "Queries were interupted. Please try refreshing the list.",
    });
  }

  const metricAnalyses = await MetricAnalysisModel.findByQueryIds(
    [...orgIds],
    [...queryIds],
  );
  for (const metricAnalysis of metricAnalyses) {
    logger.info("Updating status of metricAnalysis " + metricAnalysis.id);
    const context = await getContextForAgendaJobByOrgId(
      metricAnalysis.organization,
    );
    updateQueryStatus(metricAnalysis.queries, queryIds);
    await context.models.metricAnalysis.update(metricAnalysis, {
      queries: metricAnalysis.queries,
      error: "Queries were interupted. Please try refreshing the results.",
    });
  }

  // Look for matching safe rollout snapshots and update the status
  const srSnapshots = await findRunningSafeRolloutSnapshotsByQueryId([
    ...queryIds,
  ]);
  for (const srSnapshot of srSnapshots) {
    logger.info("Updating status of safe rollout snapshot " + srSnapshot.id);
    updateQueryStatus(srSnapshot.queries, queryIds);
    await getCollection<SafeRolloutSnapshotInterface>(
      "saferolloutsnapshots",
    ).updateOne(
      { id: srSnapshot.id },
      {
        $set: {
          error: "Queries were interrupted. Please try updating results again.",
          status: "error",
          queries: srSnapshot.queries,
        },
      },
    );
  }

  const cbSnapshots = await findRunningContextualBanditSnapshotsByQueryId([
    ...queryIds,
  ]);
  for (const cbSnapshot of cbSnapshots) {
    logger.info(
      "Updating status of contextual bandit snapshot " + cbSnapshot.id,
    );
    updateQueryStatus(cbSnapshot.queries, queryIds);
    await getCollection<ContextualBanditSnapshotInterface>(
      "contextualbanditsnapshots",
    ).updateOne(
      { id: cbSnapshot.id },
      {
        $set: {
          error: "Queries were interrupted. Please try updating results again.",
          status: "error",
          queries: cbSnapshot.queries,
        },
      },
    );
  }

  // Finalize matching aggregated runs: driven only by an in-memory QueryRunner
  // (no client polling), so a dead process leaves run pointers stuck even though
  // the query docs were flipped to failed.
  const aggregatedRuns = await findRunningAggregatedFactTableRunsByQueryId([
    ...queryIds,
  ]);
  for (const run of aggregatedRuns) {
    logger.info("Updating status of aggregated fact table run " + run.id);
    updateQueryStatus(run.queries, queryIds);
    await finalizeStuckAggregatedFactTableRun(run, {
      queries: run.queries,
      error: "Queries were interupted. Please try refreshing the results.",
    });
  }

  try {
    await reapStalledSnapshots();
  } catch (e) {
    logger.error(e, "Failed to reap stalled snapshots");
  }

  try {
    await reapStalledContextualBanditSnapshots();
  } catch (e) {
    logger.error(e, "Failed to reap stalled contextual bandit snapshots");
  }

  try {
    await reapStalledAggregatedFactTableRuns();
  } catch (e) {
    logger.error(e, "Failed to reap stalled aggregated fact table runs");
  }
};

async function reapStalledSnapshots() {
  const stalledBefore = new Date(Date.now() - STALLED_SNAPSHOT_THRESHOLD_MS);
  const candidates = await dangerousFindStalledRunningSnapshotsFromAllOrgs(
    stalledBefore,
    STALLED_SNAPSHOT_REAP_LIMIT,
  );

  for (const snapshot of candidates) {
    const queryIds = [...new Set(snapshot.queries.map((q) => q.query))];
    if (!queryIds.length) continue;

    const statuses = await getQueryStatusesByIds(
      snapshot.organization,
      queryIds,
    );
    if (statuses.length !== queryIds.length) continue;

    const running = statuses.filter((q) => q.status === "running");
    const queued = statuses.filter((q) => q.status === "queued");
    const allTerminal = statuses.every(
      (q) => q.status === "succeeded" || q.status === "failed",
    );

    // Queued queries have no heartbeat. If the in-memory runner disappears
    // before starting them, the normal stale-query path will never see them.
    const orphanedDag = running.length === 0 && queued.length > 0;

    if (!allTerminal && !orphanedDag) continue;

    const latestFinishedAt = Math.max(
      0,
      ...statuses.map((s) => s.finishedAt?.getTime() ?? 0),
    );
    // Orphaned DAGs may have no finished queries, so fall back to snapshot age.
    const lastActivityAt =
      latestFinishedAt > 0 ? latestFinishedAt : snapshot.dateCreated.getTime();
    if (Date.now() - lastActivityAt < STALLED_FINALIZE_GRACE_MS) continue;

    const statusById = new Map(statuses.map((s) => [s.id, s.status]));
    snapshot.queries.forEach((q) => {
      q.status = statusById.get(q.query) ?? q.status;
    });

    const shouldScheduleSnapshotRetry =
      orphanedDag &&
      !snapshot.report &&
      snapshot.type === "standard" &&
      snapshot.triggeredBy === "schedule";

    const error = orphanedDag
      ? shouldScheduleSnapshotRetry
        ? "Snapshot stalled: queries were never started. This can happen when the server restarts mid-refresh. A retry has been scheduled."
        : "Snapshot stalled: queries were never started. This can happen when the server restarts mid-refresh. Please try updating results again."
      : "Snapshot stalled: queries finished but results were never finalized. This usually means the analysis step failed (check server logs) or the process was restarted.";

    const context = await getContextForAgendaJobByOrgId(snapshot.organization);
    const reaped = await errorSnapshotIfStillRunning(context, snapshot.id, {
      queries: snapshot.queries,
      error,
    });
    if (!reaped) continue;

    logger.info(
      orphanedDag
        ? `Reaped orphaned snapshot ${snapshot.id} (experiment ${snapshot.experiment}): ${queued.length} of ${queryIds.length} queries stuck in "queued" with nothing running`
        : `Reaped stalled snapshot ${snapshot.id} (experiment ${snapshot.experiment}): all ${queryIds.length} queries terminal but status still running`,
    );

    if (orphanedDag) {
      await markPendingQueriesAsFailed(
        context,
        queued.map((q) => q.id),
        "Query was never started: the snapshot driving it was reaped as stalled.",
      ).catch((e) =>
        logger.warn(e, "Failed to mark orphaned queued queries as failed"),
      );

      // Only scheduled standard snapshots can be retried by bumping the
      // generic experiment refresh schedule.
      if (shouldScheduleSnapshotRetry) {
        try {
          const experiment = await getExperimentById(
            context,
            snapshot.experiment,
          );
          if (experiment) {
            await updateExperiment({
              context,
              experiment,
              changes: {
                nextSnapshotAttempt: new Date(),
                autoSnapshots: true,
              },
              bypassWebhooks: true,
            });
          }
        } catch (e) {
          logger.warn(
            e,
            "Failed to schedule retry snapshot after orphaned-DAG reap",
          );
        }
      }
    }

    await context.models.incrementalRefresh
      .releaseLock(snapshot.experiment, snapshot.id)
      .catch((e) =>
        logger.warn(
          e,
          "Failed to release incremental lock for stalled snapshot",
        ),
      );
  }
}

export default async function (agenda: Agenda) {
  agenda.define(JOB_NAME, expireOldQueries);

  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery("1 minute");
  await job.save();
}

async function findRunningSafeRolloutSnapshotsByQueryId(
  ids: string[],
): Promise<SafeRolloutSnapshotInterface[]> {
  const earliestDate = new Date();
  earliestDate.setDate(earliestDate.getDate() - 1);

  return getCollection<SafeRolloutSnapshotInterface>("saferolloutsnapshots")
    .find({
      status: "running",
      dateCreated: { $gt: earliestDate },
      queries: { $elemMatch: { query: { $in: ids }, status: "running" } },
    })
    .toArray();
}

async function findRunningContextualBanditSnapshotsByQueryId(
  ids: string[],
): Promise<ContextualBanditSnapshotInterface[]> {
  const earliestDate = new Date();
  earliestDate.setDate(earliestDate.getDate() - 1);

  return getCollection<ContextualBanditSnapshotInterface>(
    "contextualbanditsnapshots",
  )
    .find({
      status: "running",
      dateCreated: { $gt: earliestDate },
      queries: { $elemMatch: { query: { $in: ids }, status: "running" } },
    })
    .toArray();
}

// In-flight runs with a still-"running" pointer to a now-failed query. Mirrors findRunningSnapshotsByQueryId.
async function findRunningAggregatedFactTableRunsByQueryId(
  ids: string[],
): Promise<AggregatedFactTableRunInterface[]> {
  if (!ids.length) return [];
  const earliestDate = new Date();
  earliestDate.setDate(earliestDate.getDate() - 1);

  return getCollection<AggregatedFactTableRunInterface>(
    AGGREGATED_FACT_TABLE_RUN_COLLECTION,
  )
    .find({
      finishedAt: null,
      dateCreated: { $gt: earliestDate },
      queries: { $elemMatch: { query: { $in: ids }, status: "running" } },
    })
    .toArray();
}

async function reapStalledContextualBanditSnapshots() {
  const stalledBefore = new Date(Date.now() - STALLED_SNAPSHOT_THRESHOLD_MS);
  const earliestDate = new Date();
  earliestDate.setDate(earliestDate.getDate() - 1);

  const cbsCollection = getCollection<ContextualBanditSnapshotInterface>(
    "contextualbanditsnapshots",
  );

  const candidates = await cbsCollection
    .find({
      status: "running",
      dateCreated: { $gt: earliestDate, $lt: stalledBefore },
    })
    .limit(STALLED_SNAPSHOT_REAP_LIMIT)
    .toArray();

  for (const snapshot of candidates) {
    const queryIds = [...new Set(snapshot.queries.map((q) => q.query))];
    if (!queryIds.length) continue;

    const statuses = await getQueryStatusesByIds(
      snapshot.organization,
      queryIds,
    );
    if (statuses.length !== queryIds.length) continue;

    const running = statuses.filter((q) => q.status === "running");
    const queued = statuses.filter((q) => q.status === "queued");
    const allTerminal = statuses.every(
      (q) => q.status === "succeeded" || q.status === "failed",
    );

    const orphanedDag = running.length === 0 && queued.length > 0;
    if (!allTerminal && !orphanedDag) continue;

    const latestFinishedAt = Math.max(
      0,
      ...statuses.map((s) => s.finishedAt?.getTime() ?? 0),
    );
    const lastActivityAt =
      latestFinishedAt > 0 ? latestFinishedAt : snapshot.dateCreated.getTime();
    if (Date.now() - lastActivityAt < STALLED_FINALIZE_GRACE_MS) continue;

    const statusById = new Map(statuses.map((s) => [s.id, s.status]));
    snapshot.queries.forEach((q) => {
      q.status = statusById.get(q.query) ?? q.status;
    });

    const error = orphanedDag
      ? "Snapshot stalled: queries were never started. This can happen when the server restarts mid-refresh. Please try updating results again."
      : "Snapshot stalled: queries finished but results were never finalized. This usually means the analysis step failed (check server logs) or the process was restarted.";

    const res = await cbsCollection.updateOne(
      { id: snapshot.id, status: "running" },
      {
        $set: {
          status: "error",
          error,
          queries: snapshot.queries,
        },
      },
    );
    if (res.modifiedCount === 0) continue;

    logger.info(
      orphanedDag
        ? `Reaped orphaned contextual bandit snapshot ${snapshot.id} (cb ${snapshot.contextualBandit}): ${queued.length} of ${queryIds.length} queries stuck in "queued" with nothing running`
        : `Reaped stalled contextual bandit snapshot ${snapshot.id} (cb ${snapshot.contextualBandit}): all ${queryIds.length} queries terminal but status still running`,
    );
  }
}

// In-flight runs old enough to be considered stalled. Mirrors dangerousFindStalledRunningSnapshotsFromAllOrgs.
async function dangerousFindStalledAggregatedFactTableRunsFromAllOrgs(
  stalledBefore: Date,
  limit: number,
): Promise<AggregatedFactTableRunInterface[]> {
  const earliestDate = new Date();
  earliestDate.setDate(earliestDate.getDate() - 1);

  return getCollection<AggregatedFactTableRunInterface>(
    AGGREGATED_FACT_TABLE_RUN_COLLECTION,
  )
    .find({
      finishedAt: null,
      dateCreated: { $gt: earliestDate, $lt: stalledBefore },
    })
    .limit(limit)
    .toArray();
}

// Finalize a stalled/orphaned run and release its lock. The run-doc write is
// guarded on finishedAt:null so a live runner that just finished wins the race;
// the registry write is guarded on currentExecutionId so we never clobber a
// newer run that reacquired the lock. Returns true if this call finalized it.
async function finalizeStuckAggregatedFactTableRun(
  run: AggregatedFactTableRunInterface,
  { queries, error }: { queries: Queries; error: string },
): Promise<boolean> {
  const now = new Date();
  const res = await getCollection<AggregatedFactTableRunInterface>(
    AGGREGATED_FACT_TABLE_RUN_COLLECTION,
  ).updateOne(
    { id: run.id, finishedAt: null },
    { $set: { queries, error, finishedAt: now, dateUpdated: now } },
  );
  if (res.modifiedCount === 0) return false;

  await getCollection<AggregatedFactTableInterface>(
    AGGREGATED_FACT_TABLE_COLLECTION,
  ).updateOne(
    {
      organization: run.organization,
      datasourceId: run.datasourceId,
      factTableId: run.factTableId,
      idType: run.idType,
      currentExecutionId: run.executionId,
    },
    {
      $set: {
        lastError: error,
        lastRunId: run.id,
        currentExecutionId: null,
        lockHeartbeatAt: null,
        dateUpdated: now,
        // Deliberately does NOT touch inFlightExecutionId: a reaped run may have
        // committed an insert without durably advancing the watermark, so the
        // marker must stay set to force the next run to restate instead of
        // re-appending the same window (only an observed atomic insert failure
        // or a durable watermark advance clears it).
      },
    },
  );

  return true;
}

// Catches stalled runs the stale-query fan-out can't: an orphaned DAG (a query
// stuck "queued" with nothing running) or all-terminal queries whose run was
// never finalized. Mirrors reapStalledSnapshots.
async function reapStalledAggregatedFactTableRuns() {
  const stalledBefore = new Date(Date.now() - STALLED_SNAPSHOT_THRESHOLD_MS);
  const candidates =
    await dangerousFindStalledAggregatedFactTableRunsFromAllOrgs(
      stalledBefore,
      STALLED_SNAPSHOT_REAP_LIMIT,
    );

  for (const run of candidates) {
    const queryIds = [...new Set(run.queries.map((q) => q.query))];
    if (!queryIds.length) continue;

    const statuses = await getQueryStatusesByIds(run.organization, queryIds);
    if (statuses.length !== queryIds.length) continue;

    const running = statuses.filter((q) => q.status === "running");
    const queued = statuses.filter((q) => q.status === "queued");
    const allTerminal = statuses.every(
      (q) => q.status === "succeeded" || q.status === "failed",
    );

    // Stuck "queued" with nothing running: the in-memory timer driving the DAG was lost.
    const orphanedDag = running.length === 0 && queued.length > 0;

    if (!allTerminal && !orphanedDag) continue;

    const latestFinishedAt = Math.max(
      0,
      ...statuses.map((s) => s.finishedAt?.getTime() ?? 0),
    );
    // Orphaned DAG may have nothing finished yet (latestFinishedAt 0); fall back to the run's age.
    const lastActivityAt =
      latestFinishedAt > 0 ? latestFinishedAt : run.dateCreated.getTime();
    if (Date.now() - lastActivityAt < STALLED_FINALIZE_GRACE_MS) continue;

    const statusById = new Map(statuses.map((s) => [s.id, s.status]));
    run.queries.forEach((q) => {
      q.status = statusById.get(q.query) ?? q.status;
    });

    const error = orphanedDag
      ? "Aggregated fact table run stalled: queries were never started (the server likely restarted mid-run). It will be retried on the next scheduled update."
      : "Aggregated fact table run stalled: queries finished but the run was never finalized (the process was likely restarted). It will be retried on the next scheduled update.";

    const reaped = await finalizeStuckAggregatedFactTableRun(run, {
      queries: run.queries,
      error,
    });
    if (!reaped) continue;

    logger.info(
      orphanedDag
        ? `Reaped orphaned aggregated fact table run ${run.id} (${run.factTableId}/${run.idType}): ${queued.length} of ${queryIds.length} queries stuck in "queued" with nothing running`
        : `Reaped stalled aggregated fact table run ${run.id} (${run.factTableId}/${run.idType}): all ${queryIds.length} queries terminal but run never finalized`,
    );
  }
}
