import { QueryInterface, QueryStatus } from "shared/types/query";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
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
    return needsCleanup && !released;
  } catch (e) {
    logger.warn(
      e,
      `Failed to clean up interrupted incremental refresh ${snapshot.id}; releasing its lock without cleanup`,
    );
    await releaseLockWithoutCleanup(context, snapshot);
    return needsCleanup;
  }
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
 * Statuses to plan a cancelled run's cleanup from. The cancel fails every
 * pending query, so a query that was still queued before it never started.
 */
export function getCancelledRunQueryStatuses(
  before: Pick<QueryInterface, "id" | "status">[],
  after: Pick<QueryInterface, "id" | "status">[],
): Map<string, QueryStatus> {
  const statuses = new Map(after.map((doc) => [doc.id, doc.status]));
  before
    .filter((doc) => doc.status === "queued" && statuses.has(doc.id))
    .forEach((doc) => statuses.set(doc.id, "queued"));
  return statuses;
}

/**
 * For a refresh whose running query timed out: fails its queries that have
 * not started, so none can start later, then releases the run. Returns the
 * ids it failed and whether only a full refresh is safe next.
 */
export async function stopTimedOutRefresh(
  context: ApiReqContext,
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
