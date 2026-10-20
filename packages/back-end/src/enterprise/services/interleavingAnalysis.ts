import {
  InterleavingInterface,
  InterleavingSnapshotInterface,
  InterleavingSnapshotSettings,
} from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { InterleavingResultsQueryRunner } from "back-end/src/enterprise/queryRunners/InterleavingResultsQueryRunner";

type Context = ReqContext | ApiReqContext;

async function getIntegration(context: Context, datasourceId: string) {
  const ds = await getDataSourceById(context, datasourceId);
  if (!ds) {
    context.throwNotFoundError(`Data Source not found: ${datasourceId}`);
  }
  return getSourceIntegrationObject(context, ds, true);
}

/**
 * Freeze the analysis inputs from an Interleaving and its Interleaving Exposure Query.
 */
async function getInterleavingSnapshotSettings(
  context: Context,
  interleaving: InterleavingInterface,
): Promise<InterleavingSnapshotSettings> {
  if (interleaving.metrics.length === 0) {
    throw new Error(
      "Add at least one metric to this interleaving experiment before updating results",
    );
  }
  if (!interleaving.dateStarted) {
    throw new Error(
      "Start this interleaving experiment before updating results",
    );
  }

  const interleavingExposureQuery =
    await context.models.interleavingExposureQueries.getById(
      interleaving.interleavingExposureQueryId,
    );
  if (!interleavingExposureQuery) {
    context.throwNotFoundError(
      `Interleaving exposure query not found: ${interleaving.interleavingExposureQueryId}`,
    );
  }
  if (interleavingExposureQuery.datasourceId !== interleaving.datasource) {
    throw new Error(
      `Interleaving exposure query "${interleavingExposureQuery.name}" belongs to a different Data Source than this interleaving experiment`,
    );
  }
  if (
    !interleavingExposureQuery.userIdTypes.includes(interleaving.userIdType)
  ) {
    throw new Error(
      `Interleaving exposure query "${interleavingExposureQuery.name}" doesn't declare the "${interleaving.userIdType}" identifier type`,
    );
  }

  const [a, b] = interleaving.variations;
  return {
    interleavingId: interleaving.id,
    trackingKey: interleaving.trackingKey,
    datasourceId: interleaving.datasource,
    interleavingExposureQueryId: interleavingExposureQuery.id,
    exposureQuery: interleavingExposureQuery.query,
    userIdType: interleaving.userIdType,
    variations: [
      { id: a.id, key: a.key, name: a.name },
      { id: b.id, key: b.key, name: b.name },
    ],
    metrics: interleaving.metrics,
    startDate: interleaving.dateStarted,
    endDate: interleaving.dateStopped ?? null,
  };
}

/**
 * Create a snapshot for an interleaving experiment and kick off its metric
 * queries. Returns the snapshot with its query pointers (or its final state
 * if every query was cached); otherwise the runner completes asynchronously.
 */
export async function runInterleavingSnapshot(
  context: Context,
  interleavingId: string,
): Promise<InterleavingSnapshotInterface> {
  if (!context.hasPremiumFeature("interleaving")) {
    context.throwPlanDoesNotAllowError(
      "Interleaving experiments require an Enterprise plan.",
    );
  }

  const interleaving =
    await context.models.interleavings.getById(interleavingId);
  if (!interleaving) {
    context.throwNotFoundError(`Interleaving not found: ${interleavingId}`);
  }
  const settings = await getInterleavingSnapshotSettings(context, interleaving);

  const integration = await getIntegration(context, settings.datasourceId);
  if (!context.permissions.canRunExperimentQueries(integration.datasource)) {
    context.permissions.throwPermissionError();
  }

  const snapshot = await context.models.interleavingSnapshots.create({
    interleavingId: settings.interleavingId,
    project: interleaving.project,
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
  return runner.startAnalysis({ snapshotSettings: settings });
}

/** Cancel a running snapshot's queries and delete it. */
export async function cancelInterleavingSnapshot(
  context: Context,
  snapshot: InterleavingSnapshotInterface,
): Promise<boolean> {
  if (snapshot.status !== "running" && snapshot.status !== "pending") {
    return false;
  }
  const runner = new InterleavingResultsQueryRunner(
    context,
    snapshot,
    await getIntegration(context, snapshot.frozenSettings.datasourceId),
    false,
  );
  await runner.cancelQueries();
  await context.models.interleavingSnapshots.delete(snapshot);
  return true;
}
