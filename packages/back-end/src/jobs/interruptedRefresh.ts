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

export const FULL_REFRESH_NEXT_HINT =
  "Choose Full refresh from the results page's three-dot menu next, not Update, because Update could now fail or count some data twice.";
export const INTERRUPTED_REFRESH_ERROR = `This update stopped before it finished. ${FULL_REFRESH_NEXT_HINT}`;
export const INTERRUPTED_RUN_FULL_REFRESH_REASON =
  "An earlier update stopped part-way and its cache tables could not be cleaned up.";
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
}: {
  snapshotId: string;
  fullRefresh: boolean;
  queries: InterruptedRunQuery[];
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
    "id" | "experiment" | "runnerKind" | "queries"
  >,
  statusByQueryId: Map<string, QueryStatus>,
): Promise<boolean> {
  const plan = planInterruptedRunCleanup({
    snapshotId: snapshot.id,
    fullRefresh: snapshot.runnerKind === "incremental-full",
    queries: snapshot.queries.map((q) => ({
      name: q.name,
      status: statusByQueryId.get(q.query) ?? null,
    })),
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
      await requireFullRefresh(context, snapshot);
      return true;
    }
    return false;
  } catch (e) {
    logger.warn(
      e,
      `Failed to clean up interrupted incremental refresh ${snapshot.id}; releasing its lock without cleanup`,
    );
    await releaseLockWithoutCleanup(context, snapshot);
    if (needsCleanup) await requireFullRefresh(context, snapshot);
    return needsCleanup;
  }
}

// Stored apart from the lock so the run holding it now, and every later one,
// can see that the cache tables can no longer be trusted.
async function requireFullRefresh(
  context: ReqContext | ApiReqContext,
  snapshot: Pick<ExperimentSnapshotInterface, "id" | "experiment">,
) {
  try {
    await context.models.incrementalRefresh.requireFullRefresh(
      snapshot.experiment,
      { reason: INTERRUPTED_RUN_FULL_REFRESH_REASON, snapshotId: snapshot.id },
    );
  } catch (e) {
    logger.error(
      e,
      `Failed to flag experiment ${snapshot.experiment} for a full refresh after interrupted snapshot ${snapshot.id}`,
    );
  }
}

/**
 * True when an update's results can't be trusted because another run was
 * interrupted and left cache tables it could not clean up.
 */
export function isUpdateInvalidatedByInterruptedRun(
  snapshot: Pick<ExperimentSnapshotInterface, "runnerKind">,
  state: Pick<IncrementalRefreshInterface, "fullRefreshRequired"> | null,
): boolean {
  return (
    snapshot.runnerKind === "incremental-update" &&
    (state?.fullRefreshRequired ?? null) !== null
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
    "id" | "experiment" | "runnerKind" | "queries" | "organization"
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

// Never leaves the lock held: a failed cleanup falls back to a plain release.
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
    await releaseLockWithoutCleanup(context, snapshot);
    await requireFullRefresh(context, snapshot);
    return { notRunQueryIds: [], needsFullRefresh: true };
  }
}
