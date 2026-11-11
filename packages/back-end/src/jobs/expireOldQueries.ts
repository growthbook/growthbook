import Agenda from "agenda";
import { Queries, QueryInterface } from "shared/types/query";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import {
  AggregatedFactTableInterface,
  AggregatedFactTableRunInterface,
  ContextualBanditSnapshotInterface,
  InterleavingInterface,
  InterleavingSnapshotInterface,
  SafeRolloutInterface,
  SafeRolloutSnapshotInterface,
} from "shared/validators";
import {
  errorSnapshotIfStillRunning,
  findRunningSnapshotsByQueryId,
  findSnapshotById,
  dangerousFindStalledRunningSnapshotsFromAllOrgs,
  updateSnapshot,
} from "back-end/src/models/ExperimentSnapshotModel";
import { recoverStalledSnapshot } from "back-end/src/queryRunners/rehydrate";
import { SnapshotReapReason } from "back-end/src/services/experimentUpdateExecutionLogger";
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
import { getErrorMessage } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { MetricAnalysisModel } from "back-end/src/models/MetricAnalysisModel";
import { getCollection } from "back-end/src/util/mongo.util";
import { ApiReqContext } from "back-end/types/api";
import {
  failNotStartedQueries,
  isIncrementalRefreshRun,
} from "back-end/src/services/interruptedRefresh";

const JOB_NAME = "expireOldQueries";

// The time after which a snapshot is considered stalled
const STALLED_SNAPSHOT_THRESHOLD_MS = 60 * 60 * 1000;
// The allowable time between the last query finishing and the snapshot being finalized
const STALLED_FINALIZE_GRACE_MS = 10 * 60 * 1000;
// How long after the last query finished a fresh incremental lock heartbeat
// still defers the reaper. The heartbeat is a timer, so it proves the process
// is alive, not that the run is progressing.
const STALLED_HEARTBEAT_DEFER_CAP_MS = 60 * 60 * 1000;
// The runner beats every queued query doc it owns every 30 seconds; 5 minutes
// without a beat is ten missed beats, enough to consider it stalled
const QUEUED_HEARTBEAT_STALE_MS = 5 * 60 * 1000;
// createNewQuery stamps createdAt and heartbeat from two separate `new Date()`
// calls, so a never-heartbeated doc shows a gap of about a millisecond. A real
// beat lands at least one 30s tick later, so a 1s gap separates the two.
// This ensures we don't consider just created docs as stalled.
const HEARTBEAT_MIN_GAP_MS = 1000;
// With a 5 minute candidate window every long-running live snapshot is a
// candidate on every tick, so the snapshot reaper pages past live waiters
// instead of stopping at the first page. This caps the work one tick can do;
// the warn below surfaces it.
const STALLED_SNAPSHOT_REAP_LIMIT = 50;
const STALLED_SNAPSHOT_REAP_MAX_PER_TICK = 500;

const MANUAL_RETRY_HINT = "Please try updating results again.";
const SCHEDULED_RETRY_HINT = "A retry has been scheduled.";
const INTERRUPTED_QUERIES_ERROR = `Queries were interrupted. ${MANUAL_RETRY_HINT}`;
const ORPHANED_SNAPSHOT_ERROR =
  "Snapshot stalled: queries were never started. This can happen when the server restarts mid-refresh.";
const NO_QUERIES_RECORDED_ERROR =
  "Snapshot stalled: its queries were never recorded. This can happen when the server restarts mid-refresh.";
const NOT_FINALIZED_SNAPSHOT_ERROR =
  "Snapshot stalled: queries finished but results were never finalized. This usually means the analysis step failed (check server logs) or the process was restarted.";
const ORPHANED_QUERY_ERROR =
  "Query was never started: the snapshot driving it was reaped as stalled.";

// Accessed via raw collections (not context-scoped BaseModel) so this cross-org reaper needs no per-run org context.
const AGGREGATED_FACT_TABLE_RUN_COLLECTION = "aggregatedfacttableruns";
const AGGREGATED_FACT_TABLE_COLLECTION = "aggregatedfacttables";

type RawSnapshot = Pick<
  | SafeRolloutSnapshotInterface
  | ContextualBanditSnapshotInterface
  | InterleavingSnapshotInterface,
  "id" | "organization" | "dateCreated" | "queries"
> &
  // Only one exists, named by RawSnapshotFamily.parentIdField.
  Partial<
    Pick<SafeRolloutSnapshotInterface, "safeRolloutId"> &
      Pick<ContextualBanditSnapshotInterface, "contextualBandit"> &
      Pick<InterleavingSnapshotInterface, "interleavingId">
  >;

// Snapshot collections that are BaseModels. Those need an org-bound context,
// which a cross-org job does not have, so it reaches them through getCollection.
type RawSnapshotFamily = {
  collection: string;
  label: string;
  parentIdField: "safeRolloutId" | "contextualBandit" | "interleavingId";
  // Called after a snapshot is errored, for families whose scheduler defers
  // while the latest snapshot is running and so needs a nudge to try again.
  scheduleRetry?: (snapshot: RawSnapshot) => Promise<void>;
};

const SAFE_ROLLOUT_SNAPSHOTS: RawSnapshotFamily = {
  collection: "saferolloutsnapshots",
  label: "safe rollout snapshot",
  parentIdField: "safeRolloutId",
  // Mirrors the experiment reaper's retry: addSafeRolloutSnapshotJob picks
  // this up on its next minute tick, sees the errored snapshot, and starts a
  // new one. nextSnapshotAttempt is excluded from the model's audit log and
  // dateUpdated handling, so the raw write loses nothing.
  scheduleRetry: async (snapshot) => {
    await getCollection<SafeRolloutInterface>("saferollout").updateOne(
      { id: snapshot.safeRolloutId, status: "running", autoSnapshots: true },
      { $set: { nextSnapshotAttempt: new Date() } },
    );
  },
};
const CONTEXTUAL_BANDIT_SNAPSHOTS: RawSnapshotFamily = {
  collection: "contextualbanditsnapshots",
  label: "contextual bandit snapshot",
  parentIdField: "contextualBandit",
};
const INTERLEAVING_SNAPSHOTS: RawSnapshotFamily = {
  collection: "interleavingsnapshots",
  label: "interleaving snapshot",
  parentIdField: "interleavingId",
  // updateInterleavingResults defers while a snapshot is running, and its next
  // window can be up to a week out, so a reap without this waits that out.
  scheduleRetry: async (snapshot) => {
    await getCollection<InterleavingInterface>("interleavings").updateOne(
      { id: snapshot.interleavingId, status: "running", autoSnapshots: true },
      { $set: { nextSnapshotAttempt: new Date() } },
    );
  },
};

const RAW_SNAPSHOT_FAMILIES = [
  SAFE_ROLLOUT_SNAPSHOTS,
  CONTEXTUAL_BANDIT_SNAPSHOTS,
  INTERLEAVING_SNAPSHOTS,
];

// Only look back 24 hours to keep scans bounded; older docs should not still be running anyway.
function oneDayAgo(): Date {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date;
}

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
    logger.warn("Updating status of snapshot " + snapshot.id);
    const context = await getContextForAgendaJobByOrgId(snapshot.organization);
    const failedQueryIds = new Set(queryIds);
    // An incremental refresh's queued queries are stopped too, so none starts
    // after the run is released.
    if (isIncrementalRefreshRun(snapshot)) {
      const notRunQueryIds = await failNotStartedQueries(context, snapshot);
      notRunQueryIds.forEach((id) => failedQueryIds.add(id));
    }
    updateQueryStatus(snapshot.queries, failedQueryIds);
    await updateSnapshot({
      context,
      id: snapshot.id,
      updates: {
        error: INTERRUPTED_QUERIES_ERROR,
        status: "error",
        queries: snapshot.queries,
      },
      conclusion: { concludedBy: "reaper", reason: "stale-queries" },
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
      error: INTERRUPTED_QUERIES_ERROR,
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
        "Queries were interrupted. Please try re-running the analysis.",
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
      error: "Queries were interrupted. Please try refreshing the list.",
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
      error: "Queries were interrupted. Please try refreshing the results.",
    });
  }

  for (const family of RAW_SNAPSHOT_FAMILIES) {
    const rawSnapshots =
      await dangerousFindRunningRawSnapshotsByQueryIdFromAllOrgs(family, [
        ...queryIds,
      ]);
    for (const snapshot of rawSnapshots) {
      logger.info(`Updating status of ${family.label} ${snapshot.id}`);
      updateQueryStatus(snapshot.queries, queryIds);
      await errorRawSnapshotIfStillRunning(family, snapshot.id, {
        error: INTERRUPTED_QUERIES_ERROR,
        queries: snapshot.queries,
      });
    }
  }

  // Finalize matching aggregated runs: driven only by an in-memory QueryRunner
  // (no client polling), so a dead process leaves run pointers stuck even though
  // the query docs were flipped to failed.
  const aggregatedRuns =
    await dangerousFindRunningAggregatedFactTableRunsByQueryIdFromAllOrgs([
      ...queryIds,
    ]);
  for (const run of aggregatedRuns) {
    logger.info("Updating status of aggregated fact table run " + run.id);
    updateQueryStatus(run.queries, queryIds);
    await finalizeStuckAggregatedFactTableRun(run, {
      queries: run.queries,
      error: "Queries were interrupted. Please try refreshing the results.",
    });
  }

  try {
    await recoverOrErrorStalledExperimentSnapshots();
  } catch (e) {
    logger.error(e, "Failed to reap stalled experiment snapshots");
  }

  for (const family of RAW_SNAPSHOT_FAMILIES) {
    try {
      await errorStalledSnapshots(family);
    } catch (e) {
      logger.error(e, `Failed to reap stalled ${family.label}s`);
    }
  }

  try {
    await reapStalledAggregatedFactTableRuns();
  } catch (e) {
    logger.error(e, "Failed to reap stalled aggregated fact table runs");
  }
};

export type StalledQueryStatus = Pick<
  QueryInterface,
  "id" | "status" | "finishedAt" | "heartbeat" | "createdAt"
>;

export type StalledSnapshotVerdict =
  | "active" // leave alone this tick
  | "stalled-terminal" // every query terminal, snapshot never finalized
  | "orphaned-dead" // nothing running, queued docs were heartbeated and all beats are stale
  | "orphaned-unknown"; // nothing running, queued docs never heartbeated

export function classifyStalledSnapshot({
  queryStatuses,
  snapshotDateCreated,
  now,
}: {
  queryStatuses: StalledQueryStatus[];
  snapshotDateCreated: Date;
  now: number;
}): StalledSnapshotVerdict {
  if (queryStatuses.some((q) => q.status === "running")) {
    return "active";
  }

  const queued = queryStatuses.filter((q) => q.status === "queued");

  const snapshotAge = now - snapshotDateCreated.getTime();
  const latestFinishedAt = Math.max(
    0,
    ...queryStatuses.map((s) => s.finishedAt?.getTime() ?? 0),
  );
  // Orphaned DAGs may have no finished queries, so fall back to snapshot age.
  const lastActivityAt =
    latestFinishedAt > 0 ? latestFinishedAt : snapshotDateCreated.getTime();
  // Before heartbeats for queued queries, snapshots were considered stalled if they
  // were at least 60 minutes old, with no running queries and none finishing in the last 10 minutes.
  const meetsFallbackLegacyCriteria =
    snapshotAge >= STALLED_SNAPSHOT_THRESHOLD_MS &&
    now - lastActivityAt >= STALLED_FINALIZE_GRACE_MS;

  if (queued.length === 0) {
    return meetsFallbackLegacyCriteria ? "stalled-terminal" : "active";
  }

  const heartbeated = queued.filter(
    (q) =>
      q.heartbeat &&
      q.createdAt &&
      q.heartbeat.getTime() - q.createdAt.getTime() >= HEARTBEAT_MIN_GAP_MS,
  );
  if (heartbeated.length === 0) {
    return meetsFallbackLegacyCriteria ? "orphaned-unknown" : "active";
  }

  // The newest beat decides: a runner beats all of its queued docs in one
  // updateMany, so any fresh beat means the owner is still alive.
  const newestBeat = Math.max(...heartbeated.map((q) => q.heartbeat.getTime()));
  return now - newestBeat >= QUEUED_HEARTBEAT_STALE_MS
    ? "orphaned-dead"
    : "active";
}

type StalledCandidate = {
  verdict: Exclude<StalledSnapshotVerdict, "active">;
  queryIds: string[];
  statuses: StalledQueryStatus[];
  queued: StalledQueryStatus[];
  // The snapshot's query pointers with status refreshed from the query docs.
  queries: Queries;
};

// Null means leave the snapshot alone this tick.
async function evaluateStalledCandidate(
  snapshot: Pick<RawSnapshot, "organization" | "dateCreated" | "queries">,
  now: number,
): Promise<StalledCandidate | null> {
  const queryIds = [...new Set(snapshot.queries.map((q) => q.query))];
  if (!queryIds.length) return null;

  const found = await getQueryStatusesByIds(snapshot.organization, queryIds);
  // Query docs are inserted before their id is ever written into a snapshot
  // and nothing deletes them, so a missing doc can never finish: count it as
  // failed and let the legacy age + grace criteria decide when to give up.
  const foundIds = new Set(found.map((s) => s.id));
  const statuses: StalledQueryStatus[] = [
    ...found,
    ...queryIds
      .filter((id) => !foundIds.has(id))
      .map((id) => ({
        id,
        status: "failed" as const,
        createdAt: snapshot.dateCreated,
        heartbeat: snapshot.dateCreated,
      })),
  ];

  const verdict = classifyStalledSnapshot({
    queryStatuses: statuses,
    snapshotDateCreated: snapshot.dateCreated,
    now,
  });
  if (verdict === "active") return null;

  const statusById = new Map(statuses.map((s) => [s.id, s.status]));
  return {
    verdict,
    queryIds,
    statuses,
    queued: statuses.filter((q) => q.status === "queued"),
    queries: snapshot.queries.map((q) => ({
      ...q,
      status: statusById.get(q.query) ?? q.status,
    })),
  };
}

function stalledSnapshotError(
  orphaned: boolean,
  retryScheduled = false,
): string {
  const base = orphaned
    ? ORPHANED_SNAPSHOT_ERROR
    : NOT_FINALIZED_SNAPSHOT_ERROR;
  if (retryScheduled) return `${base} ${SCHEDULED_RETRY_HINT}`;
  return orphaned ? `${base} ${MANUAL_RETRY_HINT}` : base;
}

// Oldest-first pages of running snapshots older than the heartbeat window,
// excluding ids already yielded so a page of live waiters can't hide newer
// dead snapshots behind it.
async function* stalledSnapshotCandidates<T extends { id: string }>(
  label: string,
  fetchPage: (limit: number, excludeIds: string[]) => Promise<T[]>,
) {
  const seen: string[] = [];
  while (seen.length < STALLED_SNAPSHOT_REAP_MAX_PER_TICK) {
    const page = await fetchPage(
      Math.min(
        STALLED_SNAPSHOT_REAP_LIMIT,
        STALLED_SNAPSHOT_REAP_MAX_PER_TICK - seen.length,
      ),
      seen,
    );
    if (!page.length) return;
    for (const snapshot of page) {
      seen.push(snapshot.id);
      yield snapshot;
    }
  }
  logger.warn(
    `Stalled ${label} reaper examined ${STALLED_SNAPSHOT_REAP_MAX_PER_TICK} candidates this tick; newer stalled snapshots may be delayed`,
  );
}

// Unlike errorStalledSnapshots, an experiment snapshot may be recoverable:
// when every query succeeded, the analysis is replayed from persisted results.
// It also owns the incremental refresh lock, retry scheduling and alerts.
async function recoverOrErrorStalledExperimentSnapshots() {
  const now = Date.now();
  const stalledBefore = new Date(now - QUEUED_HEARTBEAT_STALE_MS);
  const candidates = stalledSnapshotCandidates(
    "experiment snapshot",
    (limit, seen) =>
      dangerousFindStalledRunningSnapshotsFromAllOrgs(
        stalledBefore,
        limit,
        seen,
      ),
  );

  for await (const snapshot of candidates) {
    const evaluated = await evaluateStalledCandidate(snapshot, now);
    if (!evaluated) continue;
    const {
      verdict,
      queryIds,
      statuses: queryStatuses,
      queued,
      queries,
    } = evaluated;
    const isOrphanedDag =
      verdict === "orphaned-dead" || verdict === "orphaned-unknown";

    const context = await getContextForAgendaJobByOrgId(snapshot.organization);

    // When every query succeeded, finalize the snapshot from the persisted
    // results instead of erroring it. The cross-org candidate can be stale, so
    // re-read in the org context and require the snapshot to still be running
    // on the same queries. A declined or failed recovery falls through to the
    // error write below, which records why as the reap reason.
    let recoverError = "";
    let reason: SnapshotReapReason = isOrphanedDag
      ? "orphaned"
      : "not-finalized";
    if (queryStatuses.every((q) => q.status === "succeeded")) {
      let freshSnapshot: ExperimentSnapshotInterface | null;
      try {
        freshSnapshot = await findSnapshotById(context, snapshot.id);
        if (freshSnapshot?.status === "running") {
          const freshQueryIds = new Set(
            freshSnapshot.queries.map((q) => q.query),
          );
          const sameQueries =
            freshQueryIds.size === queryIds.length &&
            queryIds.every((id) => freshQueryIds.has(id));

          // The snapshot changed since the original scan, so our succeeded
          // statuses describe a stale query set. Skip rather than error.
          if (!sameQueries) continue;

          // Results runners never hold the lock, so a fresh heartbeat means
          // the incremental runner is still alive (including analysis).
          // TODO: have a proper heartbeat for all queryRunners
          if (
            await context.models.incrementalRefresh.hasFreshLockHeartbeat(
              snapshot.experiment,
              snapshot.id,
            )
          ) {
            const lastFinishedAt = Math.max(
              0,
              ...queryStatuses.map((q) => q.finishedAt?.getTime() ?? 0),
            );
            if (now - lastFinishedAt < STALLED_HEARTBEAT_DEFER_CAP_MS) {
              logger.info(
                `Deferring stalled snapshot ${snapshot.id}: its runner is still heartbeating the incremental refresh lock`,
              );
              continue;
            }
            logger.warn(
              `Reaping stalled snapshot ${snapshot.id} despite a fresh incremental refresh lock heartbeat: its last query finished over ${STALLED_HEARTBEAT_DEFER_CAP_MS / 60000} minutes ago, so the runner looks hung`,
            );
          }
        }
      } catch (e) {
        // The runner may still be alive, and erroring would release its lock
        // to a new refresh.
        logger.warn(
          e,
          `Skipping stalled snapshot ${snapshot.id} this tick: failed to check whether its runner is still alive`,
        );
        continue;
      }

      if (freshSnapshot?.status === "running") {
        try {
          const recovery = await recoverStalledSnapshot(context, freshSnapshot);
          if (recovery.kind === "recovered") {
            logger.warn(
              `Recovered stalled snapshot ${snapshot.id} (experiment ${snapshot.experiment}) from persisted results`,
            );
            // Retry in case the runner's own release failed.
            await releaseStalledSnapshotLock(context, snapshot);
            continue;
          }
          reason =
            recovery.kind === "declined"
              ? `recovery-declined:${recovery.reason}`
              : "recovery-failed";
        } catch (e) {
          // A failed finalize must still leave the snapshot terminal, so fall
          // through to the error write below instead of retrying every tick.
          recoverError = getErrorMessage(e);
          reason = "recovery-failed";
          logger.warn(
            e,
            `Failed to recover stalled snapshot ${snapshot.id} from persisted results`,
          );
        }
      }
    }

    const shouldScheduleSnapshotRetry =
      isOrphanedDag &&
      !snapshot.report &&
      snapshot.type === "standard" &&
      snapshot.triggeredBy === "schedule";

    const error = isOrphanedDag
      ? stalledSnapshotError(true, shouldScheduleSnapshotRetry)
      : stalledSnapshotError(false) +
        (recoverError ? ` Automatic recovery failed: ${recoverError}` : "");

    const reaped = await errorSnapshotIfStillRunning(
      context,
      snapshot.id,
      {
        queries,
        error,
      },
      // A retry is already scheduled, so nobody needs an alert about it; the
      // cancelled cause is the one the notifier suppresses.
      shouldScheduleSnapshotRetry
        ? "cancelled"
        : isOrphanedDag
          ? "query"
          : "analysis",
      { concludedBy: "reaper", reason },
    );
    if (!reaped) continue;

    logger.warn(
      isOrphanedDag
        ? `Reaped orphaned snapshot ${snapshot.id} (experiment ${snapshot.experiment}): ${queued.length} of ${queryIds.length} queries stuck in "queued" with nothing running`
        : `Reaped stalled snapshot ${snapshot.id} (experiment ${snapshot.experiment}): all ${queryIds.length} queries terminal but status still running`,
    );

    if (isOrphanedDag) {
      await markPendingQueriesAsFailed(
        context,
        queued.map((q) => q.id),
        ORPHANED_QUERY_ERROR,
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

    await releaseStalledSnapshotLock(context, snapshot);
  }
}

// No-op if a newer run has taken the lock (releaseLock filters on snapshot id).
async function releaseStalledSnapshotLock(
  context: ApiReqContext,
  snapshot: { experiment: string; id: string },
) {
  await context.models.incrementalRefresh
    .releaseLock(snapshot.experiment, snapshot.id)
    .catch((e) =>
      logger.warn(e, "Failed to release incremental lock for stalled snapshot"),
    );
}

export default async function (agenda: Agenda) {
  agenda.define(JOB_NAME, expireOldQueries);

  const job = agenda.create(JOB_NAME, {});
  job.unique({});
  job.repeatEvery("1 minute");
  await job.save();
}

async function dangerousFindRunningRawSnapshotsByQueryIdFromAllOrgs(
  family: RawSnapshotFamily,
  ids: string[],
): Promise<RawSnapshot[]> {
  if (!ids.length) return [];

  return getCollection<RawSnapshot>(family.collection)
    .find({
      status: "running",
      dateCreated: { $gt: oneDayAgo() },
      queries: { $elemMatch: { query: { $in: ids }, status: "running" } },
    })
    .toArray();
}

function dangerousFindStalledRunningRawSnapshotsFromAllOrgs(
  family: RawSnapshotFamily,
  stalledBefore: Date,
  limit: number,
  excludeIds: string[],
): Promise<RawSnapshot[]> {
  return getCollection<RawSnapshot>(family.collection)
    .find({
      status: "running",
      dateCreated: { $gt: oneDayAgo(), $lt: stalledBefore },
      ...(excludeIds.length ? { id: { $nin: excludeIds } } : {}),
    })
    .sort({ dateCreated: 1 })
    .limit(limit)
    .toArray();
}

// Guarded: the runner may have finalized it between the find and here.
// dateUpdated advances the CAS token the interleaving runner's finalizeIfRunning
// guards on, or its in-flight write would still match and undo this.
async function errorRawSnapshotIfStillRunning(
  family: RawSnapshotFamily,
  id: string,
  updates: { error: string; queries?: Queries },
): Promise<boolean> {
  const res = await getCollection<RawSnapshot>(family.collection).updateOne(
    { id, status: "running" },
    { $set: { ...updates, status: "error", dateUpdated: new Date() } },
  );
  return res.modifiedCount > 0;
}

function rawSnapshotName(family: RawSnapshotFamily, snapshot: RawSnapshot) {
  return `${family.label} ${snapshot.id} (${family.parentIdField} ${snapshot[family.parentIdField]})`;
}

// Guarded error write, then log and nudge the family's scheduler if it has
// one. Returns false when the runner finalized first, in which case nothing
// is logged or scheduled.
async function reapRawSnapshot(
  family: RawSnapshotFamily,
  snapshot: RawSnapshot,
  updates: { error: string; queries?: Queries },
  logLine: string,
): Promise<boolean> {
  const reaped = await errorRawSnapshotIfStillRunning(
    family,
    snapshot.id,
    updates,
  );
  if (!reaped) return false;
  logger.warn(logLine);
  if (family.scheduleRetry) {
    await family
      .scheduleRetry(snapshot)
      .catch((e) =>
        logger.warn(e, `Failed to schedule retry after reaping ${snapshot.id}`),
      );
  }
  return true;
}

// These families have no recovery path, so the only outcome is status "error".
// Compare recoverOrErrorStalledExperimentSnapshots.
async function errorStalledSnapshots(family: RawSnapshotFamily) {
  const now = Date.now();
  // Same window as the experiment reaper: classifyStalledSnapshot does its own
  // age reasoning, and the short window is what lets a dead runner's stale
  // heartbeats be caught before the snapshot is a full hour old.
  const stalledBefore = new Date(now - QUEUED_HEARTBEAT_STALE_MS);
  const candidates = stalledSnapshotCandidates(family.label, (limit, seen) =>
    dangerousFindStalledRunningRawSnapshotsFromAllOrgs(
      family,
      stalledBefore,
      limit,
      seen,
    ),
  );

  for await (const snapshot of candidates) {
    const name = rawSnapshotName(family, snapshot);

    if (!snapshot.queries.length) {
      if (
        now - snapshot.dateCreated.getTime() <
        STALLED_SNAPSHOT_THRESHOLD_MS
      ) {
        continue;
      }
      await reapRawSnapshot(
        family,
        snapshot,
        {
          error: `${NO_QUERIES_RECORDED_ERROR} ${family.scheduleRetry ? SCHEDULED_RETRY_HINT : MANUAL_RETRY_HINT}`,
        },
        `Reaped ${name}: running with no queries recorded`,
      );
      continue;
    }

    const evaluated = await evaluateStalledCandidate(snapshot, now);
    if (!evaluated) continue;
    const { verdict, queryIds, queued, queries } = evaluated;
    const orphanedDag = verdict !== "stalled-terminal";

    const reaped = await reapRawSnapshot(
      family,
      snapshot,
      {
        error: stalledSnapshotError(orphanedDag, !!family.scheduleRetry),
        queries,
      },
      orphanedDag
        ? `Reaped orphaned ${name}: ${verdict}, ${queryIds.length} queries with nothing running`
        : `Reaped stalled ${name}: all ${queryIds.length} queries terminal but status still running`,
    );
    if (!reaped) continue;

    // Nothing ever dispatches a queued query doc from the collection, and the
    // stale sweep only looks at "running" ones, so without this they stay
    // non-terminal forever.
    if (orphanedDag && queued.length) {
      const context = await getContextForAgendaJobByOrgId(
        snapshot.organization,
      );
      await markPendingQueriesAsFailed(
        context,
        queued.map((q) => q.id),
        ORPHANED_QUERY_ERROR,
      ).catch((e) =>
        logger.warn(e, "Failed to mark orphaned queued queries as failed"),
      );
    }
  }
}

// In-flight runs with a still-"running" pointer to a now-failed query. Mirrors findRunningSnapshotsByQueryId.
async function dangerousFindRunningAggregatedFactTableRunsByQueryIdFromAllOrgs(
  ids: string[],
): Promise<AggregatedFactTableRunInterface[]> {
  if (!ids.length) return [];

  return getCollection<AggregatedFactTableRunInterface>(
    AGGREGATED_FACT_TABLE_RUN_COLLECTION,
  )
    .find({
      finishedAt: null,
      dateCreated: { $gt: oneDayAgo() },
      queries: { $elemMatch: { query: { $in: ids }, status: "running" } },
    })
    .toArray();
}

// In-flight runs old enough to be considered stalled. Mirrors dangerousFindStalledRunningRawSnapshotsFromAllOrgs.
async function dangerousFindStalledAggregatedFactTableRunsFromAllOrgs(
  stalledBefore: Date,
  limit: number,
  excludeIds: string[],
): Promise<AggregatedFactTableRunInterface[]> {
  return getCollection<AggregatedFactTableRunInterface>(
    AGGREGATED_FACT_TABLE_RUN_COLLECTION,
  )
    .find({
      finishedAt: null,
      dateCreated: { $gt: oneDayAgo(), $lt: stalledBefore },
      ...(excludeIds.length ? { id: { $nin: excludeIds } } : {}),
    })
    .sort({ dateCreated: 1 })
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
// never finalized.
async function reapStalledAggregatedFactTableRuns() {
  const now = Date.now();
  // Same window as the snapshot reapers: classifyStalledSnapshot does its own
  // age reasoning, and the short window is what lets a dead runner's stale
  // heartbeats be caught before the run is a full hour old.
  const stalledBefore = new Date(now - QUEUED_HEARTBEAT_STALE_MS);
  const candidates = stalledSnapshotCandidates(
    "aggregated fact table run",
    (limit, seen) =>
      dangerousFindStalledAggregatedFactTableRunsFromAllOrgs(
        stalledBefore,
        limit,
        seen,
      ),
  );

  for await (const run of candidates) {
    const evaluated = await evaluateStalledCandidate(run, now);
    if (!evaluated) continue;
    const { verdict, queryIds, queued, queries } = evaluated;
    const orphanedDag = verdict !== "stalled-terminal";

    const error = orphanedDag
      ? "Aggregated fact table run stalled: queries were never started (the server likely restarted mid-run). It will be retried on the next scheduled update."
      : "Aggregated fact table run stalled: queries finished but the run was never finalized (the process was likely restarted). It will be retried on the next scheduled update.";

    const reaped = await finalizeStuckAggregatedFactTableRun(run, {
      queries,
      error,
    });
    if (!reaped) continue;

    logger.warn(
      orphanedDag
        ? `Reaped orphaned aggregated fact table run ${run.id} (${run.factTableId}/${run.idType}): ${queued.length} of ${queryIds.length} queries stuck in "queued" with nothing running`
        : `Reaped stalled aggregated fact table run ${run.id} (${run.factTableId}/${run.idType}): all ${queryIds.length} queries terminal but run never finalized`,
    );

    // Same cleanup as the snapshot reapers: nothing else ever concludes a queued query doc.
    if (orphanedDag && queued.length) {
      const context = await getContextForAgendaJobByOrgId(run.organization);
      await markPendingQueriesAsFailed(
        context,
        queued.map((q) => q.id),
        ORPHANED_QUERY_ERROR,
      ).catch((e) =>
        logger.warn(e, "Failed to mark orphaned queued queries as failed"),
      );
    }
  }
}
