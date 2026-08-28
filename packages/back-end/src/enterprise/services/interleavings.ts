import {
  InterleavingInterface,
  InterleavingSnapshotSettings,
} from "shared/validators";
import { cloneDeep } from "lodash";
import type { AuditInterfaceInput } from "shared/types/audit";
import type { EventUser } from "shared/types/events/event-types";
import type { FeatureInterface, FeatureRule } from "shared/types/feature";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { discardIfJustCreated } from "back-end/src/api/features/validations";
import { updateRevision } from "back-end/src/models/FeatureRevisionModel";
import { recordRevisionUpdate } from "back-end/src/services/featureRevisionEvents";
import {
  generateRuleId,
  getDraftRevision,
  refreshSDKPayloadCache,
} from "back-end/src/services/features";
import { publishContextualBanditRevision } from "back-end/src/enterprise/services/contextualBandits";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { InterleavingResultsQueryRunner } from "back-end/src/enterprise/queryRunners/InterleavingResultsQueryRunner";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";

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

// ---------------------------------------------------------------------------
// Lifecycle: draft -> running -> stopped. Only running interleaving
// experiments are served in the SDK payload, so status transitions must
// refresh the SDK payload cache for the affected project/environments.
// ---------------------------------------------------------------------------

async function refreshInterleavingPayload(
  context: Context,
  interleaving: InterleavingInterface,
): Promise<void> {
  const payloadKeys = getEnvironmentIdsFromOrg(context.org).map(
    (environment) => ({
      environment,
      project: interleaving.project || "",
    }),
  );
  await refreshSDKPayloadCache({
    context,
    payloadKeys,
    treatEmptyProjectAsGlobal: true,
    auditContext: {
      event: "interleaving.statusChange",
      model: "interleaving",
      id: interleaving.id,
    },
  });
}

// Feature Flags whose rules reference this interleaving (interleave-ref)
export async function getInterleavingLinkedFeatureIds(
  context: Context,
  interleaving: InterleavingInterface,
): Promise<string[]> {
  const features = await getAllFeatures(context);
  return features
    .filter((f) =>
      (f.rules ?? []).some(
        (r) =>
          r.type === "interleave-ref" && r.interleavingId === interleaving.id,
      ),
    )
    .map((f) => f.id);
}

export async function startInterleaving(
  context: Context,
  interleaving: InterleavingInterface,
): Promise<InterleavingInterface> {
  if (interleaving.status !== "draft") {
    throw new Error("Only draft interleaving experiments can be started");
  }
  const linkedFeatureIds = await getInterleavingLinkedFeatureIds(
    context,
    interleaving,
  );
  if (linkedFeatureIds.length === 0) {
    throw new Error(
      "Add an interleave rule to a Feature Flag before starting this interleaving experiment",
    );
  }
  const updated = await context.models.interleavings.update(interleaving, {
    status: "running",
    dateStarted: new Date(),
  });
  await refreshInterleavingPayload(context, updated);
  return updated;
}

export async function stopInterleaving(
  context: Context,
  interleaving: InterleavingInterface,
): Promise<InterleavingInterface> {
  if (interleaving.status !== "running") {
    throw new Error("Only running interleaving experiments can be stopped");
  }
  const updated = await context.models.interleavings.update(interleaving, {
    status: "stopped",
    dateStopped: new Date(),
  });
  await refreshInterleavingPayload(context, updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Feature linking: interleave-ref rules are added to features through the
// standard revision machinery (CB pattern), then published immediately.
// ---------------------------------------------------------------------------

export async function linkFeatureToInterleaving({
  context,
  interleaving,
  feature,
  coverage,
  eventAudit,
  audit,
}: {
  context: Context;
  interleaving: InterleavingInterface;
  feature: FeatureInterface;
  coverage?: number;
  eventAudit: EventUser;
  audit: (input: AuditInterfaceInput) => Promise<void>;
}): Promise<{ version: number; ruleId: string }> {
  if (feature.valueType !== "string") {
    throw new Error(
      "The linked Feature Flag must be string-valued: its value names the list to serve",
    );
  }
  if (
    (feature.rules ?? []).some(
      (r) =>
        r.type === "interleave-ref" && r.interleavingId === interleaving.id,
    )
  ) {
    throw new Error(
      `Feature Flag ${feature.id} already has a rule for this interleaving experiment`,
    );
  }
  if (!context.environments.length) {
    throw new Error(
      "Must have at least one environment configured to use Feature Flags",
    );
  }
  if (!context.permissions.canEditFeatureDrafts(feature)) {
    context.permissions.throwPermissionError();
  }

  const scopedRule: FeatureRule = {
    type: "interleave-ref",
    interleavingId: interleaving.id,
    description: "",
    id: generateRuleId(),
    allEnvironments: true,
    ...(coverage !== undefined ? { coverage } : {}),
  };

  const revision = await getDraftRevision(context, feature, feature.version);
  try {
    const updatedRevision = await updateRevision(
      context,
      feature,
      revision,
      {
        rules: [...cloneDeep(revision.rules ?? []), scopedRule],
        ...(revision.title ? {} : { title: "Link interleaving experiment" }),
      },
      {
        user: eventAudit,
        action: "add interleave rule",
        subject: "to all environments",
        value: JSON.stringify(scopedRule),
      },
      false,
    );
    await recordRevisionUpdate(context, feature, updatedRevision, "rule.add", {
      environments: context.environments,
    });
    await publishContextualBanditRevision({
      context,
      feature,
      revision: updatedRevision,
      comment: `Link interleaving experiment "${interleaving.name}"`,
      audit,
    });
    return { version: updatedRevision.version, ruleId: scopedRule.id };
  } catch (err) {
    await discardIfJustCreated(context, revision, true);
    throw err;
  }
}
