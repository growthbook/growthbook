import { QueryInterface, QueryStatus } from "shared/types/query";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { IncrementalRefreshInterface } from "shared/validators";
import {
  failQueuedQueries,
  getQueryStatusesByIds,
} from "back-end/src/models/QueryModel";
import {
  incrementalRefreshQueryNames,
  INSERT_METRICS_SOURCE_DATA_PREFIX,
} from "back-end/src/queryRunners/incrementalRefreshQueryNames";
import { logger } from "back-end/src/util/logger";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";

// The flag or the dropped units table makes the next update a full refresh.
export const FULL_REFRESH_NEXT_HINT =
  "The next update will run a full refresh.";
// The cleanup and the flag could not be saved; the lock is still held.
export const CLEANUP_PENDING_HINT =
  "Its cleanup could not be saved yet, so updates may be blocked for a few minutes before a full refresh runs.";
export const INTERRUPTED_REFRESH_ERROR = `This update stopped before it finished. ${FULL_REFRESH_NEXT_HINT}`;
export const INTERRUPTED_RUN_FULL_REFRESH_REASON =
  "An earlier update stopped part-way and its cache tables could not be cleaned up.";
export const RESULTS_NOT_COMMITTED_ERROR =
  "Another update took over this experiment's cache tables before this one finished, so its results were not saved. Please try updating results again.";
export const UPDATE_INVALIDATED_ERROR =
  "An earlier update stopped part-way while this one was running, so these results could count some data twice. The next update will run a full refresh.";
export const NOT_RUN_QUERY_ERROR =
  "Not run: the update this query belonged to stopped before the query started.";

export interface InterruptedRunCleanup {
  // Metric sources whose cache table may hold rows past its saved timestamp
  metricGroupIdsToRebuild: string[];
  forceFullRefresh: boolean;
}

// null means the query's status could not be read.
export type InterruptedRunQuery = { name: string; status: QueryStatus | null };

export function isIncrementalRefreshRun(
  snapshot: Pick<ExperimentSnapshotInterface, "runnerKind">,
): boolean {
  return (
    snapshot.runnerKind === "incremental-full" ||
    snapshot.runnerKind === "incremental-update"
  );
}

export function planInterruptedRunCleanup({
  snapshotId,
  fullRefresh,
  queries,
  runFinished = false,
}: {
  snapshotId: string;
  fullRefresh: boolean;
  queries: InterruptedRunQuery[];
  // Every query ended and the run's own source-list writes landed, so a full
  // refresh's old sources can no longer be left in place.
  runFinished?: boolean;
}): InterruptedRunCleanup {
  const statusByName = new Map(queries.map((q) => [q.name, q.status]));
  // A query we can't read may have run, so only a known "queued" is unstarted.
  const started = (name: string) =>
    statusByName.has(name) && statusByName.get(name) !== "queued";
  const succeeded = (name: string) => statusByName.get(name) === "succeeded";

  const metricGroupIds = queries
    .filter((q) => q.name.startsWith(INSERT_METRICS_SOURCE_DATA_PREFIX))
    .map((q) => q.name.slice(INSERT_METRICS_SOURCE_DATA_PREFIX.length));

  // The insert appends rows; only the timestamp query's success records how
  // far they reach. Covariate inserts are left out: duplicate covariate rows
  // do not change the result.
  const metricGroupIdsToRebuild = metricGroupIds.filter(
    (groupId) =>
      started(incrementalRefreshQueryNames.insertMetricsSourceData(groupId)) &&
      !succeeded(
        incrementalRefreshQueryNames.maxTimestampMetricsSource(groupId),
      ),
  );

  const unitsTableMissing =
    started(incrementalRefreshQueryNames.dropUnitsTable(snapshotId)) &&
    !succeeded(incrementalRefreshQueryNames.alterUnitsTable(snapshotId));

  const unfinishedFullRefresh =
    fullRefresh &&
    !runFinished &&
    (!succeeded(
      incrementalRefreshQueryNames.maxTimestampUnitsTable(snapshotId),
    ) ||
      metricGroupIds.some(
        (groupId) =>
          !succeeded(
            incrementalRefreshQueryNames.maxTimestampMetricsSource(groupId),
          ),
      ));

  return {
    metricGroupIdsToRebuild,
    forceFullRefresh: unitsTableMissing || unfinishedFullRefresh,
  };
}

/**
 * Releases an interrupted incremental refresh's lock, dropping the cache state
 * it may have corrupted in the same write. Returns true when that state needed
 * dropping but the run no longer held the lock, so only a full refresh is safe.
 */
export async function releaseInterruptedRefresh(
  context: ReqContext | ApiReqContext,
  snapshot: Pick<
    ExperimentSnapshotInterface,
    "id" | "experiment" | "runnerKind" | "queries" | "phase"
  >,
  statusByQueryId: Map<string, QueryStatus>,
  { runFinished = false }: { runFinished?: boolean } = {},
): Promise<boolean> {
  const plan = planInterruptedRunCleanup({
    snapshotId: snapshot.id,
    fullRefresh: snapshot.runnerKind === "incremental-full",
    queries: snapshot.queries.map((q) => ({
      name: q.name,
      status: statusByQueryId.get(q.query) ?? null,
    })),
    runFinished,
  });
  const needsCleanup =
    plan.forceFullRefresh || plan.metricGroupIdsToRebuild.length > 0;

  try {
    const released =
      await context.models.incrementalRefresh.releaseLockAfterInterruptedRun(
        snapshot.experiment,
        snapshot.id,
        plan,
      );
    if (needsCleanup) {
      logger.warn(
        { snapshotId: snapshot.id, experimentId: snapshot.experiment, ...plan },
        released
          ? "Dropped incremental refresh cache state an interrupted run may have appended to"
          : "Interrupted incremental refresh no longer held its lock; its cache state could not be dropped",
      );
    }
    if (needsCleanup && !released) {
      // The run was already concluded and nobody holds the lock: applying the
      // cleanup again is safe. Only another run's lock calls for the flag.
      if (
        await context.models.incrementalRefresh.cleanUpUnlockedPhase(
          snapshot.experiment,
          snapshot.phase,
          plan,
        )
      ) {
        return false;
      }
      await requireFullRefresh(context, snapshot);
      return true;
    }
    return false;
  } catch (e) {
    logger.warn(
      e,
      `Failed to clean up interrupted incremental refresh ${snapshot.id}; releasing its lock without cleanup`,
    );
    // Throws, keeping the lock, when the flag can't be recorded either.
    if (needsCleanup) await requireFullRefresh(context, snapshot);
    await releaseLockWithoutCleanup(context, snapshot);
    return needsCleanup;
  }
}

// Stored apart from the lock so the run holding it now, and every later one,
// can see that the cache tables can no longer be trusted. A failed write
// throws: callers leave the interrupted run in place to be retried.
async function requireFullRefresh(
  context: ReqContext | ApiReqContext,
  snapshot: Pick<ExperimentSnapshotInterface, "id" | "experiment">,
) {
  await context.models.incrementalRefresh.requireFullRefresh(
    snapshot.experiment,
    { reason: INTERRUPTED_RUN_FULL_REFRESH_REASON, snapshotId: snapshot.id },
  );
}

/**
 * True when a run that reads the cache tables as they are (an Update or a
 * dimension breakdown) can't trust them, because another run was interrupted
 * and left them in a state it could not clean up.
 */
export function isUpdateInvalidatedByInterruptedRun(
  snapshot: Pick<ExperimentSnapshotInterface, "runnerKind">,
  state: Pick<IncrementalRefreshInterface, "fullRefreshRequired"> | null,
): boolean {
  return (
    readsCacheTablesAsIs(snapshot) &&
    (state?.fullRefreshRequired ?? null) !== null
  );
}

function readsCacheTablesAsIs(
  snapshot: Pick<ExperimentSnapshotInterface, "runnerKind">,
) {
  return (
    snapshot.runnerKind === "incremental-update" ||
    snapshot.runnerKind === "incremental-exploratory"
  );
}

// Keeps a failed cleanup from also blocking the full refresh it asks for.
export async function releaseLockWithoutCleanup(
  context: ReqContext | ApiReqContext,
  snapshot: Pick<ExperimentSnapshotInterface, "id" | "experiment">,
) {
  await context.models.incrementalRefresh
    .releaseLock(snapshot.experiment, snapshot.id)
    .catch((e) =>
      logger.warn(
        e,
        `Failed to release the incremental refresh lock of interrupted snapshot ${snapshot.id}`,
      ),
    );
}

/**
 * Statuses to plan a cancelled run's cleanup from. Only the queries the cancel
 * failed while they were still queued are known never to have started.
 */
export function getCancelledRunQueryStatuses(
  notStartedIds: string[],
  after: Pick<QueryInterface, "id" | "status">[],
): Map<string, QueryStatus> {
  const statuses = new Map(after.map((doc) => [doc.id, doc.status]));
  notStartedIds
    .filter((id) => statuses.has(id))
    .forEach((id) => statuses.set(id, "queued"));
  return statuses;
}

/**
 * For a refresh that stopped with queries still pending (a timed-out query, a
 * stalled run, or the runner's own failure): fails its queries that have not
 * started, so none can start later, then releases the run. Returns the ids it
 * failed and whether only a full refresh is safe next.
 */
export async function stopInterruptedRefresh(
  context: ReqContext | ApiReqContext,
  snapshot: Pick<
    ExperimentSnapshotInterface,
    "id" | "experiment" | "runnerKind" | "queries" | "organization" | "phase"
  >,
): Promise<{ notRunQueryIds: string[]; needsFullRefresh: boolean }> {
  const queryIds = [...new Set(snapshot.queries.map((q) => q.query))];
  const statuses = await getQueryStatusesByIds(snapshot.organization, queryIds);
  const statusByQueryId = new Map(statuses.map((s) => [s.id, s.status]));

  const queuedIds = statuses
    .filter((s) => s.status === "queued")
    .map((s) => s.id);
  const notRunQueryIds = await failQueuedQueries(
    context,
    queuedIds,
    NOT_RUN_QUERY_ERROR,
  );
  // A query that started between the read and the write may have run.
  queuedIds
    .filter((id) => !notRunQueryIds.includes(id))
    .forEach((id) => statusByQueryId.delete(id));

  const needsFullRefresh = await releaseInterruptedRefresh(
    context,
    snapshot,
    statusByQueryId,
  );
  return { notRunQueryIds, needsFullRefresh };
}

// A failed cleanup falls back to a plain release only once the flag is
// recorded; if that fails too, it throws and the run keeps its lock until a
// retry, or until a stale takeover flags the tables.
export async function stopInterruptedRefreshOrRelease(
  context: ReqContext | ApiReqContext,
  snapshot: Parameters<typeof stopInterruptedRefresh>[1],
): Promise<{ notRunQueryIds: string[]; needsFullRefresh: boolean }> {
  try {
    return await stopInterruptedRefresh(context, snapshot);
  } catch (e) {
    logger.warn(
      e,
      `Failed to stop interrupted incremental refresh ${snapshot.id}`,
    );
    await requireFullRefresh(context, snapshot);
    await releaseLockWithoutCleanup(context, snapshot);
    return { notRunQueryIds: [], needsFullRefresh: true };
  }
}

/**
 * Releases a run that reached a terminal status, in the same write dropping
 * any cache state its own writes could not: a source whose timestamp query
 * failed, or a units table it dropped but never renamed. Returns true when
 * that state needed dropping but the run no longer held the lock.
 */
export async function releaseConcludedRefresh(
  context: ReqContext | ApiReqContext,
  snapshot: Parameters<typeof stopInterruptedRefresh>[1],
  status: "succeeded" | "partially-succeeded" | "failed",
): Promise<boolean> {
  // A failed run can still have queries running.
  if (status === "failed") {
    return (await stopInterruptedRefreshOrRelease(context, snapshot))
      .needsFullRefresh;
  }
  return releaseInterruptedRefresh(
    context,
    snapshot,
    new Map(snapshot.queries.map((q) => [q.query, q.status])),
    { runFinished: true },
  );
}

/**
 * Concludes a run that reached a terminal status. Its results are committed
 * only while it holds the lock and, if it read the tables as they are, no
 * interrupted run has flagged them; a full refresh then clears the flag.
 * Then the lock is released with the cleanup the status calls for. Returns the
 * error to save instead of the results, if any, and whether only a full
 * refresh is safe next.
 */
export async function concludeRefresh(
  context: ReqContext | ApiReqContext,
  snapshot: Parameters<typeof stopInterruptedRefresh>[1] &
    Pick<ExperimentSnapshotInterface, "dateCreated">,
  status: "succeeded" | "partially-succeeded" | "failed",
): Promise<{ resultsError: string | null; needsFullRefresh: boolean }> {
  let resultsError: string | null = null;
  if (status !== "failed") {
    const committed = await context.models.incrementalRefresh.commitRunResults(
      snapshot.experiment,
      snapshot.id,
      {
        materialized: snapshot.runnerKind !== "incremental-exploratory",
        requireUnflagged: readsCacheTablesAsIs(snapshot),
      },
    );
    if (!committed) {
      const stillLocked =
        await context.models.incrementalRefresh.isLockedBySnapshotId(
          snapshot.experiment,
          snapshot.id,
        );
      resultsError = stillLocked
        ? UPDATE_INVALIDATED_ERROR
        : RESULTS_NOT_COMMITTED_ERROR;
    } else if (
      status === "succeeded" &&
      snapshot.runnerKind === "incremental-full"
    ) {
      // A flag left in place only costs another full refresh.
      await context.models.incrementalRefresh
        .clearFullRefreshRequired(
          snapshot.experiment,
          snapshot.id,
          snapshot.dateCreated,
        )
        .catch((e) =>
          logger.warn(
            e,
            "Failed to clear the full refresh flag after a full refresh",
          ),
        );
    }
  }
  const needsFullRefresh = await releaseConcludedRefresh(
    context,
    snapshot,
    status,
  );
  return { resultsError, needsFullRefresh };
}
