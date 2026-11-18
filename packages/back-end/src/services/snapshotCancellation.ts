import uniq from "lodash/uniq";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { Queries, QueryInterface } from "shared/types/query";
import {
  deleteSnapshotIfRunning,
  errorSnapshotIfStillRunning,
  findLatestSuccessfulReportSnapshotId,
  findSnapshotsByIds,
  reconcileSnapshotQueryPointers,
} from "back-end/src/models/ExperimentSnapshotModel";
import {
  getQueryStatusesByIds,
  markPendingQueriesAsFailed,
} from "back-end/src/models/QueryModel";
import {
  getReportById,
  updateReportSnapshotIfUnchanged,
} from "back-end/src/models/ReportModel";
import { QUERY_CANCELLED_BY_USER_ERROR } from "back-end/src/queryRunners/QueryRunner";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { cancelExternalJobsForQueries } from "back-end/src/services/queryCancellation";
import { BadRequestError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

export const SNAPSHOT_CANCELLED_ERROR = "Update cancelled by user";
export const SNAPSHOT_INTERRUPTED_ERROR =
  "Interrupted by an update of the Overall Results. Run this breakdown again when the update finishes.";

export type SnapshotCancelAction = "delete" | "conclude" | "reconcile" | "none";
export type SnapshotCancelOutcome =
  | "deleted"
  | "concluded"
  | "reconciled"
  | "unchanged";

export function planSnapshotCancel({
  snapshot,
  docs,
  reportSnapshotId,
  interruptedByWriter = false,
}: {
  snapshot: Pick<ExperimentSnapshotInterface, "id" | "status" | "queries">;
  docs: Pick<QueryInterface, "id" | "status">[];
  reportSnapshotId: string | null;
  interruptedByWriter?: boolean;
}): { action: SnapshotCancelAction; queries: Queries } {
  const statusById = new Map(docs.map((doc) => [doc.id, doc.status]));
  const queries: Queries = snapshot.queries.map((pointer) => ({
    name: pointer.name,
    query: pointer.query,
    status: statusById.get(pointer.query) ?? "failed",
  }));

  if (snapshot.status === "running") {
    return {
      action:
        interruptedByWriter || reportSnapshotId === snapshot.id
          ? "conclude"
          : "delete",
      queries,
    };
  }

  const changed = queries.some(
    (pointer, i) => pointer.status !== snapshot.queries[i].status,
  );
  return { action: changed ? "reconcile" : "none", queries };
}

async function applySnapshotCancel(
  context: ReqContext,
  id: string,
  action: SnapshotCancelAction,
  queries: Queries,
  error: string,
): Promise<SnapshotCancelOutcome> {
  switch (action) {
    case "none":
      return "unchanged";
    case "delete":
      if (
        await deleteSnapshotIfRunning(context, id, { concludedBy: "cancel" })
      ) {
        return "deleted";
      }
      break;
    case "conclude":
      if (
        await errorSnapshotIfStillRunning(
          context,
          id,
          { queries, error },
          "cancelled",
          { concludedBy: "cancel" },
        )
      ) {
        return "concluded";
      }
      break;
    case "reconcile":
      break;
  }
  // A CAS miss means a runner or the reaper concluded the snapshot first.
  return (await reconcileSnapshotQueryPointers(context, id, queries))
    ? "reconciled"
    : "unchanged";
}

export async function cancelExperimentSnapshot(
  context: ReqContext,
  snapshot: ExperimentSnapshotInterface,
  // Set when an Overall Results update or phase delete took the incremental
  // lock from this run, rather than a user cancelling it.
  { interruptedByWriter = false }: { interruptedByWriter?: boolean } = {},
): Promise<{ outcome: SnapshotCancelOutcome; cancelledQueryIds: string[] }> {
  // Undecryptable credentials must not block the Mongo cleanup; the warehouse
  // cancels below already downgrade their own failures to warnings.
  const integration = await getIntegrationFromDatasourceId(
    context,
    snapshot.settings.datasourceId,
  );
  // The caller was already allowed to start the run that interrupts this one.
  if (
    !interruptedByWriter &&
    !context.permissions.canRunExperimentQueries(integration.datasource)
  ) {
    context.permissions.throwPermissionError();
  }

  const pointerIds = uniq(snapshot.queries.map((pointer) => pointer.query));
  const before = await getQueryStatusesByIds(context.org.id, pointerIds);
  const pendingIds = before
    .filter((doc) => doc.status === "running" || doc.status === "queued")
    .map((doc) => doc.id);

  // The fence: once pending docs are failed, no live runner can promote a
  // queued query or record a result for a running one.
  // A live runner that sees the failed queries first reports their error as
  // the snapshot's, so an interrupted run needs it here too.
  await markPendingQueriesAsFailed(
    context,
    pendingIds,
    interruptedByWriter
      ? SNAPSHOT_INTERRUPTED_ERROR
      : QUERY_CANCELLED_BY_USER_ERROR,
  );
  // Re-read so a doc that finished between the first read and the fence
  // keeps its real status.
  const after = pendingIds.length
    ? await getQueryStatusesByIds(context.org.id, pointerIds)
    : before;

  const report = snapshot.report
    ? await getReportById(context.org.id, snapshot.report)
    : null;
  const reportSnapshotId =
    report?.type === "experiment-snapshot" ? report.snapshot : null;

  const { action, queries } = planSnapshotCancel({
    snapshot,
    docs: after,
    reportSnapshotId,
    interruptedByWriter,
  });
  // A finished snapshot is never cancelled itself; only its pending queries
  // and stale pointers are. With neither, there is nothing to cancel, which
  // is only an error when a user asked.
  if (action === "none" && !pendingIds.length && !interruptedByWriter) {
    throw new BadRequestError("Snapshot is not running");
  }
  const outcome = await applySnapshotCancel(
    context,
    snapshot.id,
    action,
    queries,
    interruptedByWriter ? SNAPSHOT_INTERRUPTED_ERROR : SNAPSHOT_CANCELLED_ERROR,
  );

  // The cancelled run has no results, so its report goes back to the latest
  // successful one. This holds even when a runner that saw the fenced queries
  // concluded the run first, and for a stuck run that already errored with
  // live pointers. If a runner succeeded instead, the run is the latest
  // successful snapshot and keeps the report. The CAS keeps a newer refresh's
  // pointer.
  const runHasNoResults =
    action === "conclude" ||
    (action === "reconcile" && snapshot.status === "error");
  if (runHasNoResults && report?.type === "experiment-snapshot") {
    const latestSuccessId = await findLatestSuccessfulReportSnapshotId(
      context,
      report,
    );
    if (latestSuccessId && latestSuccessId !== snapshot.id) {
      await updateReportSnapshotIfUnchanged(
        context.org.id,
        report.id,
        snapshot.id,
        latestSuccessId,
      );
    }
  }

  await context.models.incrementalRefresh
    .releaseLock(snapshot.experiment, snapshot.id)
    .catch((e) =>
      logger.warn(e, "Failed to release incremental lock on snapshot cancel"),
    );

  const afterStatusById = new Map(after.map((doc) => [doc.id, doc.status]));
  const cancelledQueryIds = pendingIds.filter(
    (id) => afterStatusById.get(id) === "failed",
  );
  // Warehouse cancels go last so a live runner reacting to the aborted job
  // already finds the snapshot missing or terminal.
  await cancelExternalJobsForQueries(context, integration, cancelledQueryIds, {
    modelId: snapshot.id,
  });

  return { outcome, cancelledQueryIds };
}

/**
 * A writer calls this once it holds the incremental lock and before its first
 * query, so no breakdown is still reading the tables it is about to rebuild.
 */
export async function interruptIncrementalReaders(
  context: ReqContext,
  experimentId: string,
  writerId: string,
): Promise<void> {
  const readerSnapshotIds =
    await context.models.incrementalRefresh.clearReaders(
      experimentId,
      writerId,
    );
  if (!readerSnapshotIds.length) return;
  const readers = await findSnapshotsByIds(context, readerSnapshotIds);
  await Promise.all(
    readers.map((reader) =>
      cancelExperimentSnapshot(context, reader, { interruptedByWriter: true }),
    ),
  );
}
