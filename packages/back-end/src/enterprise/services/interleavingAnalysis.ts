import {
  InterleavingSnapshotInterface,
  InterleavingSnapshotSettings,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { InterleavingResultsQueryRunner } from "back-end/src/enterprise/queryRunners/InterleavingResultsQueryRunner";

type Context = ReqContext | ApiReqContext;

/**
 * Create a snapshot from frozen settings and kick off its metric queries.
 * Returns the new snapshot; the runner completes asynchronously. Callers own
 * building the settings from whatever configures the experiment.
 */
export async function runInterleavingSnapshot(
  context: Context,
  settings: InterleavingSnapshotSettings,
): Promise<InterleavingSnapshotInterface> {
  if (!context.hasPremiumFeature("interleaving")) {
    context.throwPlanDoesNotAllowError(
      "Interleaving experiments require an Enterprise plan.",
    );
  }
  if (settings.metrics.length === 0) {
    throw new Error(
      "Add at least one metric to this interleaving experiment before updating results",
    );
  }

  const ds = await getDataSourceById(context, settings.datasourceId);
  if (!ds) {
    throw new Error(`Datasource missing: ${settings.datasourceId}`);
  }

  const snapshot = await context.models.interleavingSnapshots.create({
    interleaving: settings.interleavingId,
    status: "running",
    queries: [],
    runStarted: null,
    frozenSettings: settings,
  });

  const integration = getSourceIntegrationObject(context, ds, true);
  const runner = new InterleavingResultsQueryRunner(
    context,
    snapshot,
    integration,
    false,
  );
  await runner.startAnalysis({ snapshotSettings: settings });

  return snapshot;
}

/** Cancel a running snapshot's queries and delete it. */
export async function cancelInterleavingSnapshot(
  context: Context,
  snapshot: InterleavingSnapshotInterface,
): Promise<boolean> {
  if (snapshot.status !== "running" && snapshot.status !== "pending") {
    return false;
  }
  const datasourceId = snapshot.frozenSettings?.datasourceId;
  if (!datasourceId) {
    throw new Error(`Snapshot ${snapshot.id} has no frozen settings`);
  }
  const ds = await getDataSourceById(context, datasourceId);
  if (!ds) {
    throw new Error(`Datasource missing: ${datasourceId}`);
  }
  const integration = getSourceIntegrationObject(context, ds, true);
  const runner = new InterleavingResultsQueryRunner(
    context,
    snapshot,
    integration,
    false,
  );
  await runner.cancelQueries();
  await context.models.interleavingSnapshots.delete(snapshot);
  return true;
}
