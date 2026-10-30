import {
  InterleavingInterface,
  InterleavingSnapshotInterface,
  InterleavingSnapshotSettings,
} from "shared/validators";
import { getScopedSettings } from "shared/settings";
import { DEFAULT_P_VALUE_THRESHOLD } from "shared/constants";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { InterleavingResultsQueryRunner } from "back-end/src/enterprise/queryRunners/InterleavingResultsQueryRunner";
import { resolveInterleavingMetrics } from "back-end/src/enterprise/services/interleavingMetrics";

type Context = ReqContext | ApiReqContext;

export async function resolveInterleavingExposureQuery(
  context: Context,
  interleaving: Pick<
    InterleavingInterface,
    "interleavingExposureQueryId" | "datasource" | "userIdType"
  >,
) {
  const query = await context.models.interleavingExposureQueries.getById(
    interleaving.interleavingExposureQueryId,
  );
  if (!query) {
    context.throwNotFoundError(
      `Interleaving exposure query not found: ${interleaving.interleavingExposureQueryId}`,
    );
  }
  if (query.datasourceId !== interleaving.datasource) {
    throw new Error(
      `Interleaving exposure query "${query.name}" belongs to a different Data Source than this interleaving experiment`,
    );
  }
  if (!query.userIdTypes.includes(interleaving.userIdType)) {
    throw new Error(
      `Interleaving exposure query "${query.name}" doesn't declare the "${interleaving.userIdType}" identifier type`,
    );
  }
  return query;
}

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
  const endDate = interleaving.dateStopped ?? new Date();

  const interleavingExposureQuery = await resolveInterleavingExposureQuery(
    context,
    interleaving,
  );

  // Project-scoped, matching how the results table resolves the same number.
  // Inlined rather than via getPValueThresholdForProject: importing
  // services/organizations here pulls in the model graph and cycles.
  const project = interleaving.project
    ? (await context.getProjects()).find((p) => p.id === interleaving.project)
    : undefined;
  const pValueThreshold =
    getScopedSettings({ organization: context.org, project }).settings
      .pValueThreshold.value ?? DEFAULT_P_VALUE_THRESHOLD;

  const [a, b] = interleaving.variations;
  return {
    interleavingId: interleaving.id,
    trackingKey: interleaving.trackingKey,
    datasourceId: interleaving.datasource,
    interleavingExposureQueryId: interleavingExposureQuery.id,
    interleavingExposureQuerySql: interleavingExposureQuery.query,
    userIdType: interleaving.userIdType,
    variations: [
      { id: a.id, key: a.key, name: a.name },
      { id: b.id, key: b.key, name: b.name },
    ],
    metrics: interleaving.metrics,
    pValueThreshold,
    startDate: interleaving.dateStarted,
    endDate,
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

  // Resolve before the snapshot exists so a bad metric never creates one
  const metrics = await resolveInterleavingMetrics(context, settings);

  const snapshot = await context.models.interleavingSnapshots.create({
    interleavingId: settings.interleavingId,
    status: "running",
    queries: [],
    runStarted: null,
    settings,
  });

  if (!(await context.models.interleavings.getById(interleavingId))) {
    await context.models.interleavingSnapshots.delete(snapshot);
    context.throwNotFoundError(`Interleaving not found: ${interleavingId}`);
  }

  const runner = new InterleavingResultsQueryRunner(
    context,
    snapshot,
    integration,
    false,
  );
  try {
    return await runner.startAnalysis({ snapshotSettings: settings, metrics });
  } catch (e) {
    // startAnalysis doesn't catch startQueries errors; without this the
    // snapshot would stay "running" forever and the UI would poll it
    await context.models.interleavingSnapshots.updateById(snapshot.id, {
      status: "error",
      error: e.message,
    });
    throw e;
  }
}

/** Cancel a running snapshot's queries and delete it. */
export async function cancelInterleavingSnapshot(
  context: Context,
  snapshot: InterleavingSnapshotInterface,
): Promise<boolean> {
  if (snapshot.status !== "running") {
    return false;
  }
  const runner = new InterleavingResultsQueryRunner(
    context,
    snapshot,
    await getIntegration(context, snapshot.settings.datasourceId),
    false,
  );
  await runner.cancelQueries();
  // deleteById re-reads through getById, which populates the datasource ref
  // canDelete needs; delete() alone does not.
  await context.models.interleavingSnapshots.deleteById(snapshot.id);
  return true;
}
