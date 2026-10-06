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
 * Snapshot settings minus the fields frozen from the Interleaving Query.
 * `userIdType` is the caller's pick among the query's declared identifiers.
 */
export type InterleavingSnapshotRunSettings = Omit<
  InterleavingSnapshotSettings,
  "datasourceId" | "query"
>;

async function getIntegration(context: Context, datasourceId: string) {
  const ds = await getDataSourceById(context, datasourceId);
  if (!ds) {
    context.throwNotFoundError(`Data Source not found: ${datasourceId}`);
  }
  return getSourceIntegrationObject(context, ds, true);
}

/**
 * Freeze settings from the experiment config and its Interleaving Query,
 * create a snapshot, and kick off its metric queries. Returns the new
 * snapshot; the runner completes asynchronously.
 */
export async function runInterleavingSnapshot(
  context: Context,
  runSettings: InterleavingSnapshotRunSettings,
): Promise<InterleavingSnapshotInterface> {
  if (!context.hasPremiumFeature("interleaving")) {
    context.throwPlanDoesNotAllowError(
      "Interleaving experiments require an Enterprise plan.",
    );
  }
  if (runSettings.metrics.length === 0) {
    throw new Error(
      "Add at least one metric to this interleaving experiment before updating results",
    );
  }

  const interleavingQuery = await context.models.interleavingQueries.getById(
    runSettings.interleavingQueryId,
  );
  if (!interleavingQuery) {
    context.throwNotFoundError(
      `Interleaving query not found: ${runSettings.interleavingQueryId}`,
    );
  }
  if (!interleavingQuery.userIdTypes.includes(runSettings.userIdType)) {
    throw new Error(
      `Interleaving query "${interleavingQuery.name}" doesn't declare the "${runSettings.userIdType}" identifier type`,
    );
  }
  const settings: InterleavingSnapshotSettings = {
    ...runSettings,
    datasourceId: interleavingQuery.datasourceId,
    query: interleavingQuery.query,
  };

  const integration = await getIntegration(context, settings.datasourceId);
  if (!context.permissions.canRunExperimentQueries(integration.datasource)) {
    context.permissions.throwPermissionError();
  }

  const snapshot = await context.models.interleavingSnapshots.create({
    interleavingId: settings.interleavingId,
    status: "running",
    queries: [],
    runStarted: null,
    frozenSettings: settings,
  });

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
  const runner = new InterleavingResultsQueryRunner(
    context,
    snapshot,
    await getIntegration(context, datasourceId),
    false,
  );
  await runner.cancelQueries();
  await context.models.interleavingSnapshots.delete(snapshot);
  return true;
}
