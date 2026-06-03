import Agenda from "agenda";
import { Queries } from "shared/types/query";
import { SafeRolloutSnapshotInterface } from "shared/validators";
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
} from "back-end/src/models/QueryModel";
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

  try {
    await reapStalledSnapshots();
  } catch (e) {
    logger.error(e, "Failed to reap stalled snapshots");
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

    // An orphaned DAG: nothing is actually executing, but one or more
    // queries are still "queued" and will never be started. This happens
    // when the in-memory timer that drives the DAG forward was lost —
    // e.g. the process restarted mid-run, or a fast first query finished
    // and fired its follow-up timer before the full query DAG was
    // persisted (the Full Refresh race). Queued queries have no heartbeat
    // and are never "running", so neither getStaleQueries() nor the
    // all-terminal reap path above will ever touch them. Without this
    // branch the snapshot would show "Running" forever.
    const orphanedDag = running.length === 0 && queued.length > 0;

    if (!allTerminal && !orphanedDag) continue;

    const latestFinishedAt = Math.max(
      0,
      ...statuses.map((s) => s.finishedAt?.getTime() ?? 0),
    );
    // For an orphaned DAG nothing may have finished yet (latestFinishedAt
    // stays 0), in which case fall back to the snapshot's age — the
    // STALLED_SNAPSHOT_THRESHOLD_MS check above has already guaranteed it.
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
