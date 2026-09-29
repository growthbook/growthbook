import uniq from "lodash/uniq";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { Queries, QueryInterface } from "shared/types/query";
import {
  deleteSnapshotIfRunning,
  errorSnapshotIfStillRunning,
  findLatestSuccessfulReportSnapshotId,
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
}: {
  snapshot: Pick<ExperimentSnapshotInterface, "id" | "status" | "queries">;
  docs: Pick<QueryInterface, "id" | "status">[];
  reportSnapshotId: string | null;
}): { action: SnapshotCancelAction; queries: Queries } {
  const statusById = new Map(docs.map((doc) => [doc.id, doc.status]));
  const queries: Queries = snapshot.queries.map((pointer) => ({
    name: pointer.name,
    query: pointer.query,
    status: statusById.get(pointer.query) ?? "failed",
  }));

  if (snapshot.status === "running") {
    return {
      action: reportSnapshotId === snapshot.id ? "conclude" : "delete",
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
): Promise<SnapshotCancelOutcome> {
  switch (action) {
    case "none":
      return "unchanged";
    case "delete":
      if (await deleteSnapshotIfRunning(context, id)) return "deleted";
      break;
    case "conclude":
      if (
        await errorSnapshotIfStillRunning(
          context,
          id,
          { queries, error: SNAPSHOT_CANCELLED_ERROR },
          "cancelled",
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
): Promise<{ outcome: SnapshotCancelOutcome; cancelledQueryIds: string[] }> {
  // Undecryptable credentials must not block the Mongo cleanup; the warehouse
  // cancels below already downgrade their own failures to warnings.
  const integration = await getIntegrationFromDatasourceId(
    context,
    snapshot.settings.datasourceId,
  );
  if (!context.permissions.canRunExperimentQueries(integration.datasource)) {
    context.permissions.throwPermissionError();
  }

  const pointerIds = uniq(snapshot.queries.map((pointer) => pointer.query));
  const before = await getQueryStatusesByIds(context.org.id, pointerIds);
  const pendingIds = before
    .filter((doc) => doc.status === "running" || doc.status === "queued")
    .map((doc) => doc.id);

  // The fence: once pending docs are failed, no live runner can promote a
  // queued query or record a result for a running one.
  await markPendingQueriesAsFailed(
    context,
    pendingIds,
    QUERY_CANCELLED_BY_USER_ERROR,
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
  });
  // A finished snapshot is never cancelled itself; only its pending queries
  // and stale pointers are. With neither, there is nothing to cancel.
  if (action === "none" && !pendingIds.length) {
    throw new BadRequestError("Snapshot is not running");
  }
  const outcome = await applySnapshotCancel(
    context,
    snapshot.id,
    action,
    queries,
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
