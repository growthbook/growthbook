import {
  InterleavingInterface,
  InterleavingSnapshotSettings,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { InterleavingResultsQueryRunner } from "back-end/src/enterprise/queryRunners/InterleavingResultsQueryRunner";

type Context = ReqContext | ApiReqContext;

/**
 * Create a snapshot for an interleaving experiment and kick off its metric
 * queries. Returns the new snapshot id; the runner completes asynchronously.
 */
export async function runInterleavingRefresh(
  context: Context,
  interleaving: InterleavingInterface,
): Promise<{ snapshotId: string }> {
  if (!context.hasPremiumFeature("interleaving")) {
    context.throwPlanDoesNotAllowError(
      "Interleaving experiments require an Enterprise plan.",
    );
  }

  const ds = await getDataSourceById(context, interleaving.datasource);
  if (!ds) {
    throw new Error(`Datasource missing: ${interleaving.datasource}`);
  }

  const interleavingQuery = await context.models.interleavingQueries.getById(
    interleaving.interleavingQueryId,
  );
  if (!interleavingQuery) {
    throw new Error(
      `Interleaving query missing: ${interleaving.interleavingQueryId}`,
    );
  }

  if (interleaving.metrics.length === 0) {
    throw new Error(
      "Add at least one metric to this interleaving experiment before updating results",
    );
  }

  const snapshotSettings: InterleavingSnapshotSettings = {
    interleavingId: interleaving.id,
    trackingKey: interleaving.trackingKey,
    datasourceId: interleaving.datasource,
    interleavingQueryId: interleavingQuery.id,
    query: interleavingQuery.query,
    userIdType: interleavingQuery.userIdType,
    variationNames: interleaving.variationNames,
    metrics: interleaving.metrics,
    startDate: interleaving.dateStarted ?? interleaving.dateCreated,
    endDate: interleaving.dateStopped ?? null,
  };

  const snapshot = await context.models.interleavingSnapshots.create({
    interleaving: interleaving.id,
    status: "running",
    queries: [],
    runStarted: null,
    frozenSettings: snapshotSettings,
  });

  const integration = getSourceIntegrationObject(context, ds, true);
  const runner = new InterleavingResultsQueryRunner(
    context,
    snapshot,
    integration,
    false,
  );

  await runner.startAnalysis({ snapshotSettings });

  return { snapshotId: snapshot.id };
}

/** Cancel the latest running snapshot's queries and delete the snapshot. */
export async function cancelInterleavingLatestRunningSnapshot(
  context: Context,
  interleaving: InterleavingInterface,
): Promise<boolean> {
  const latest =
    await context.models.interleavingSnapshots.getLatestForInterleaving(
      interleaving.id,
    );
  if (!latest || (latest.status !== "running" && latest.status !== "pending")) {
    return false;
  }

  const ds = await getDataSourceById(context, interleaving.datasource);
  if (!ds) {
    throw new Error(`Datasource missing: ${interleaving.datasource}`);
  }

  const integration = getSourceIntegrationObject(context, ds, true);
  const runner = new InterleavingResultsQueryRunner(
    context,
    latest,
    integration,
    false,
  );
  await runner.cancelQueries();
  await context.models.interleavingSnapshots.delete(latest);
  return true;
}
