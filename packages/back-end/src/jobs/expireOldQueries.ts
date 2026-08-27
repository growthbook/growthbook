import Agenda from "agenda";
import uniqid from "uniqid";
import { Queries } from "shared/types/query";
import {
  AggregatedFactTableInterface,
  AggregatedFactTableRunInterface,
  ContextualBanditSnapshotInterface,
  QueryRunnerRunParentType,
  SafeRolloutSnapshotInterface,
} from "shared/validators";
import {
  errorSnapshotIfStillRunning,
  findRunningSnapshotsByQueryId,
  dangerousFindStalledRunningSnapshotsFromAllOrgs,
} from "back-end/src/models/ExperimentSnapshotModel";
import { findRunningMetricsByQueryId } from "back-end/src/models/MetricModel";
import { findRunningPastExperimentsByQueryId } from "back-end/src/models/PastExperimentsModel";
import {
  failQueryRunnerRunQueries,
  failStaleQueries,
  findStaleRunningQueries,
  getQueryStatusesByIds,
  markPendingQueriesAsFailed,
} from "back-end/src/models/QueryModel";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { findReportsByQueryId } from "back-end/src/models/ReportModel";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { MetricAnalysisModel } from "back-end/src/models/MetricAnalysisModel";
import { getCollection } from "back-end/src/util/mongo.util";
import { QueryRunnerRunModel } from "back-end/src/models/QueryRunnerRunModel";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
const JOB_NAME = "expireOldQueries";

// The time after which a snapshot is considered stalled
const STALLED_SNAPSHOT_THRESHOLD_MS = 60 * 60 * 1000;
// The allowable time between the last query finishing and the snapshot being finalized
const STALLED_FINALIZE_GRACE_MS = 10 * 60 * 1000;
const STALLED_SNAPSHOT_REAP_LIMIT = 50;

// Accessed via raw collections (not context-scoped BaseModel) so this cross-org reaper needs no per-run org context.
const AGGREGATED_FACT_TABLE_RUN_COLLECTION = "aggregatedfacttableruns";
const AGGREGATED_FACT_TABLE_COLLECTION = "aggregatedfacttables";

const LEASE_REAP_ERROR =
  "The process running this analysis stopped unexpectedly. Please try updating results again.";
const STALE_LEASE_REAP_LIMIT = 20;

/** Returns a copy of the query pointers with the given ids flipped to "failed". */
function markQueryPointersFailed(
  queries: Queries | undefined,
  failedIds: string[],
): Queries {
  const failed = new Set(failedIds);
  return (queries ?? []).map((q) =>
    failed.has(q.query) ? { ...q, status: "failed" as const } : q,
  );
}

function hasPendingOwnedQuery(
  queries: Queries | undefined,
  queryIds: string[],
): queries is Queries {
  const owned = new Set(queryIds);
  return Boolean(
    queries?.some(
      (query) =>
        owned.has(query.query) &&
        (query.status === "queued" || query.status === "running"),
    ),
  );
}

const PARENT_COLLECTION_NAMES: Record<QueryRunnerRunParentType, string> = {
  experimentSnapshot: "experimentsnapshots",
  report: "reports",
  metric: "metrics",
  pastExperiments: "pastexperiments",
  metricAnalysis: "metricanalyses",
  dimensionSlices: "dimensionslices",
  safeRolloutSnapshot: "saferolloutsnapshots",
  contextualBanditSnapshot: "contextualbanditsnapshots",
  aggregatedFactTableRun: "aggregatedfacttableruns",
  populationData: "populationdata",
  productAnalyticsExploration: "analyticsexploration",
};

type ParentDagDoc = {
  id: string;
  organization: string;
  queries?: Queries;
  experiment?: string;
};
type ParentErrorWriteArgs = {
  context: ReqContext | ApiReqContext;
  parentDoc: ParentDagDoc;
  failedQueryIds: string[];
  error: string;
};
type ParentErrorWriter = (args: ParentErrorWriteArgs) => Promise<boolean>;

/**
 * For parents with a scalar run status: guards the write on status:"running" so
 * a parent that already concluded can't be resurrected. Returns whether the
 * write applied.
 */
function statusGuardedWriter(coll: string): ParentErrorWriter {
  return async function writeStatusGuardedError({
    context,
    parentDoc,
    failedQueryIds,
    error,
  }) {
    if (!hasPendingOwnedQuery(parentDoc.queries, failedQueryIds)) return false;
    const res = await getCollection(coll).updateOne(
      {
        organization: context.org.id,
        id: parentDoc.id,
        status: "running",
        queries: parentDoc.queries,
      },
      {
        $set: {
          status: "error",
          error,
          queries: markQueryPointersFailed(parentDoc.queries, failedQueryIds),
        },
      },
    );
    return res.modifiedCount > 0;
  };
}

/**
 * For legacy parents with no run status, where a pending query pointer is
 * the only liveness signal. Returns whether the write applied.
 */
function pointerGuardedWriter(
  coll: string,
  errorField: string,
): ParentErrorWriter {
  return async function writePointerGuardedError({
    context,
    parentDoc,
    failedQueryIds,
    error,
  }) {
    if (!hasPendingOwnedQuery(parentDoc.queries, failedQueryIds)) return false;
    const res = await getCollection(coll).updateOne(
      {
        organization: context.org.id,
        id: parentDoc.id,
        queries: parentDoc.queries,
      },
      {
        $set: {
          [errorField]: error,
          queries: markQueryPointersFailed(parentDoc.queries, failedQueryIds),
        },
      },
    );
    return res.modifiedCount > 0;
  };
}

/** Every parent error write flows through here so the guard stays uniform. */
const PARENT_ERROR_WRITERS: Record<
  QueryRunnerRunParentType,
  ParentErrorWriter
> = {
  experimentSnapshot: async ({ context, parentDoc, failedQueryIds, error }) => {
    if (!hasPendingOwnedQuery(parentDoc.queries, failedQueryIds)) return false;
    const wrote = await errorSnapshotIfStillRunning(
      context,
      parentDoc.id,
      {
        queries: markQueryPointersFailed(parentDoc.queries, failedQueryIds),
        error,
      },
      parentDoc.queries,
    );
    // releaseLock filters on currentExecutionSnapshotId, so this is a no-op
    // unless this snapshot held the incremental-refresh lock.
    await context.models.incrementalRefresh
      .releaseLock(parentDoc.experiment ?? "", parentDoc.id)
      .catch((e) =>
        logger.warn(
          e,
          "Failed to release incremental lock for expired snapshot",
        ),
      );
    return wrote;
  },
  report: pointerGuardedWriter("reports", "error"),
  metric: pointerGuardedWriter("metrics", "analysisError"),
  pastExperiments: pointerGuardedWriter("pastexperiments", "error"),
  metricAnalysis: statusGuardedWriter("metricanalyses"),
  dimensionSlices: pointerGuardedWriter("dimensionslices", "error"),
  safeRolloutSnapshot: statusGuardedWriter("saferolloutsnapshots"),
  contextualBanditSnapshot: statusGuardedWriter("contextualbanditsnapshots"),
  aggregatedFactTableRun: async ({ parentDoc, failedQueryIds, error }) => {
    if (!hasPendingOwnedQuery(parentDoc.queries, failedQueryIds)) return false;
    return finalizeStuckAggregatedFactTableRun(
      parentDoc as unknown as AggregatedFactTableRunInterface,
      {
        queries: markQueryPointersFailed(parentDoc.queries, failedQueryIds),
        error,
      },
    );
  },
  populationData: statusGuardedWriter("populationdata"),
  productAnalyticsExploration: statusGuardedWriter("analyticsexploration"),
};

/**
 * Cleans up runs whose driver stopped refreshing its 30-second run heartbeat.
 */
async function reapStaleQueryRunnerRuns() {
  const staleRuns =
    await QueryRunnerRunModel.dangerouslyFindStaleQueryRunnerRuns(
      STALE_LEASE_REAP_LIMIT,
    );
  for (const run of staleRuns) {
    const reaperToken = uniqid("qrr-reaper_");
    try {
      const context = await getContextForAgendaJobByOrgId(run.organization);
      const claimed = await context.models.queryRunnerRuns.acquireLock(
        run.id,
        reaperToken,
      );
      if (!claimed) continue;
      try {
        // No queries to fail, so skip.
        if (!run.queryIds.length) continue;

        await failQueryRunnerRunQueries(
          context,
          run.queryIds,
          LEASE_REAP_ERROR,
        );

        const parentDoc = (await getCollection(
          PARENT_COLLECTION_NAMES[run.parentType],
        ).findOne({
          organization: run.organization,
          id: run.parentId,
        })) as ParentDagDoc | null;
        if (parentDoc) {
          const wrote = await PARENT_ERROR_WRITERS[run.parentType]({
            context,
            parentDoc,
            failedQueryIds: run.queryIds,
            error: LEASE_REAP_ERROR,
          });
          if (!wrote) {
            logger.warn(
              { queryRunnerRunId: run.id, parentId: run.parentId },
              "Stale query runner parent no longer matches the recorded DAG",
            );
          }
        }
      } finally {
        await context.models.queryRunnerRuns
          .releaseLock(run.id, reaperToken)
          .catch((e) =>
            logger.error(
              { err: e, queryRunnerRunId: run.id },
              "Failed to release reaper lease",
            ),
          );
      }
    } catch (e) {
      logger.error(
        { err: e, queryRunnerRunId: run.id },
        "Failed to reap stale query runner lease",
      );
    }
  }
}

/**
 * Covers pre-run-record executions during skip-version upgrades.
 * Parent failures are isolated so the stale-query sweep can continue.
 */
async function reapParentFromStaleQueries(
  parentType: QueryRunnerRunParentType,
  parent: ParentDagDoc,
  queryIds: Set<string>,
  shieldedQueryIds: Set<string>,
  error: string,
): Promise<void> {
  try {
    const context = await getContextForAgendaJobByOrgId(parent.organization);
    const ownStaleIds = (parent.queries ?? [])
      .map((q) => q.query)
      .filter((id) => queryIds.has(id));
    const active = await context.models.queryRunnerRuns.getActiveByParent(
      parentType,
      parent.id,
    );
    if (active) {
      ownStaleIds.forEach((id) => shieldedQueryIds.add(id));
      return;
    }
    await PARENT_ERROR_WRITERS[parentType]({
      context,
      parentDoc: parent,
      failedQueryIds: ownStaleIds,
      error,
    });
  } catch (e) {
    logger.error(
      { err: e, parentId: parent.id, parentType },
      "Failed to reap parent for stale queries",
    );
  }
}

async function expireOldQueries() {
  await reapStaleQueryRunnerRuns();

  const staleDocs = await findStaleRunningQueries();
  const queryIds = new Set(staleDocs.map((d) => d.id));
  const orgIds = new Set(staleDocs.map((d) => d.organization));
  const shieldedQueryIds = new Set<string>();

  if (queryIds.size > 0) {
    logger.info("Found " + queryIds.size + " stale queries");
  } else {
    logger.debug("Found no stale queries");
  }

  const snapshots = await findRunningSnapshotsByQueryId([...queryIds]);
  for (const snapshot of snapshots) {
    logger.info("Updating status of snapshot " + snapshot.id);
    await reapParentFromStaleQueries(
      "experimentSnapshot",
      snapshot,
      queryIds,
      shieldedQueryIds,
      "Queries were interupted. Please try updating results again.",
    );
  }

  const reports = await findReportsByQueryId([...queryIds]);
  for (const report of reports) {
    if (report.type !== "experiment") continue;
    logger.info("Updating status of report " + report.id);
    await reapParentFromStaleQueries(
      "report",
      report,
      queryIds,
      shieldedQueryIds,
      "Queries were interupted. Please try updating results again.",
    );
  }

  const metrics = await findRunningMetricsByQueryId([...orgIds], [...queryIds]);
  for (const metric of metrics) {
    logger.info("Updating status of metric " + metric.id);
    await reapParentFromStaleQueries(
      "metric",
      metric,
      queryIds,
      shieldedQueryIds,
      "Queries were interupted. Please try re-running the analysis.",
    );
  }

  const pastExperiments = await findRunningPastExperimentsByQueryId(
    [...orgIds],
    [...queryIds],
  );
  for (const pastExperiment of pastExperiments) {
    logger.info("Updating status of pastExperiment " + pastExperiment.id);
    await reapParentFromStaleQueries(
      "pastExperiments",
      pastExperiment,
      queryIds,
      shieldedQueryIds,
      "Queries were interupted. Please try refreshing the list.",
    );
  }

  const metricAnalyses = await MetricAnalysisModel.findByQueryIds(
    [...orgIds],
    [...queryIds],
  );
  for (const metricAnalysis of metricAnalyses) {
    logger.info("Updating status of metricAnalysis " + metricAnalysis.id);
    await reapParentFromStaleQueries(
      "metricAnalysis",
      metricAnalysis,
      queryIds,
      shieldedQueryIds,
      "Queries were interupted. Please try refreshing the results.",
    );
  }

  const srSnapshots = await findRunningSafeRolloutSnapshotsByQueryId([
    ...queryIds,
  ]);
  for (const srSnapshot of srSnapshots) {
    logger.info("Updating status of safe rollout snapshot " + srSnapshot.id);
    await reapParentFromStaleQueries(
      "safeRolloutSnapshot",
      srSnapshot,
      queryIds,
      shieldedQueryIds,
      "Queries were interrupted. Please try updating results again.",
    );
  }

  const cbSnapshots = await findRunningContextualBanditSnapshotsByQueryId([
    ...queryIds,
  ]);
  for (const cbSnapshot of cbSnapshots) {
    logger.info(
      "Updating status of contextual bandit snapshot " + cbSnapshot.id,
    );
    await reapParentFromStaleQueries(
      "contextualBanditSnapshot",
      cbSnapshot,
      queryIds,
      shieldedQueryIds,
      "Queries were interrupted. Please try updating results again.",
    );
  }

  const aggregatedRuns = await findRunningAggregatedFactTableRunsByQueryId([
    ...queryIds,
  ]);
  for (const run of aggregatedRuns) {
    logger.info("Updating status of aggregated fact table run " + run.id);
    await reapParentFromStaleQueries(
      "aggregatedFactTableRun",
      run,
      queryIds,
      shieldedQueryIds,
      "Queries were interupted. Please try refreshing the results.",
    );
  }

  // Queries with no tracked parent are never shielded, so orphans still fail here.
  await failStaleQueries(staleDocs.filter((d) => !shieldedQueryIds.has(d.id)));

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
}

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
    { id: run.id, finishedAt: null, queries: run.queries },
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
