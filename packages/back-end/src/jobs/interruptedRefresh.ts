import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import {
  failQueuedQueries,
  getQueryStatusesByIds,
} from "back-end/src/models/QueryModel";
import { ConcurrentIncrementalRefreshError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";

// Before writing a cache table, a run marks it dirty in a write fenced on its
// lock, and only clears the mark in the fenced write that saves the table's
// new watermark. Marks precede writes, both fenced on the lock, so a run that
// stops anywhere leaves every table it may have changed marked, and the next
// refresh rebuilds those. Stopping a run therefore only has to release it.

export const NOT_RUN_QUERY_ERROR =
  "Not run: the update this query belonged to stopped before the query started.";
export const LOCK_LOST_ERROR =
  "Another update took over this experiment while this one was running, so it stopped.";
export const RESULTS_SUPERSEDED_ERROR =
  "Another update took over this experiment before this one finished, so its results were not saved. Update results again to see them.";

export function isIncrementalRefreshRun(
  snapshot: Pick<ExperimentSnapshotInterface, "runnerKind">,
): boolean {
  return (
    snapshot.runnerKind === "incremental-full" ||
    snapshot.runnerKind === "incremental-update"
  );
}

/**
 * Stops an incremental refresh: fails its queries that have not started, so
 * none can start later, then releases its lock. Returns the ids it failed.
 */
export async function stopIncrementalRefresh(
  context: ReqContext | ApiReqContext,
  snapshot: Pick<
    ExperimentSnapshotInterface,
    "id" | "experiment" | "queries" | "organization"
  >,
): Promise<string[]> {
  const queryIds = [...new Set(snapshot.queries.map((q) => q.query))];
  let notRunQueryIds: string[] = [];
  try {
    const statuses = await getQueryStatusesByIds(
      snapshot.organization,
      queryIds,
    );
    notRunQueryIds = await failQueuedQueries(
      context,
      statuses.filter((s) => s.status === "queued").map((s) => s.id),
      NOT_RUN_QUERY_ERROR,
    );
  } catch (e) {
    // A query that starts anyway fails its fenced writes once the lock is gone.
    logger.warn(e, `Failed to stop the queued queries of ${snapshot.id}`);
  }
  await context.models.incrementalRefresh
    .releaseLock(snapshot.experiment, snapshot.id)
    .catch((e) =>
      logger.warn(
        e,
        `Failed to release the incremental refresh lock of ${snapshot.id}`,
      ),
    );
  return notRunQueryIds;
}

/**
 * True for errors that only mean another update took over: the next refresh
 * runs normally, so they must never turn off scheduled updates.
 */
export function isSupersededRefreshError(error: unknown): boolean {
  if (error instanceof ConcurrentIncrementalRefreshError) return true;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return [RESULTS_SUPERSEDED_ERROR, LOCK_LOST_ERROR].some((m) =>
    message.includes(m),
  );
}
