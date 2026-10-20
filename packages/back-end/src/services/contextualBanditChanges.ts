import { ContextualBanditInterface } from "shared/validators";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import {
  ContextualBanditUpdate,
  determineNextContextualBanditSchedule,
} from "back-end/src/services/contextualBanditSchedule";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { getAffectedSDKPayloadKeys } from "back-end/src/util/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import {
  formatPendingDraftFailureMessage,
  PendingDraftFailure,
  PendingDraftPublishResult,
  publishPendingFeatureDraftsForContextualBandit,
} from "back-end/src/services/experiment-feature";

export async function refreshLinkedFeaturePayloads(
  context: ReqContext | ApiReqContext,
  cb: ContextualBanditInterface,
  auditEvent:
    | "contextualBandit.start"
    | "contextualBandit.stop"
    | "contextualBandit.refresh",
): Promise<void> {
  const features = await getAllFeatures(context);
  if (!features.length) return;

  const environments = getEnvironmentIdsFromOrg(context.org);
  const allProjectIds = await context.getAllProjectIds();
  const payloadKeys = getAffectedSDKPayloadKeys(
    features,
    environments,
    (rule) => {
      if (rule.enabled === false) return false;
      return (
        rule.type === "contextual-bandit-ref" &&
        rule.contextualBanditId === cb.id
      );
    },
    allProjectIds,
  );
  if (payloadKeys.length === 0) return;
  queueSDKPayloadRefresh({
    context,
    payloadKeys,
    auditContext: { event: auditEvent, model: "contextualBandit", id: cb.id },
  });
}

/** Core CB start (no permission checks). Publishes pending drafts BEFORE the status flip; throws with `failedFeatureDrafts` on failure. */
export async function executeContextualBanditStart(
  context: ReqContext | ApiReqContext,
  cb: ContextualBanditInterface,
): Promise<{
  updated: ContextualBanditInterface;
  publishResult: PendingDraftPublishResult;
}> {
  const publishResult = await publishPendingFeatureDraftsForContextualBandit(
    context,
    cb,
  );
  if (publishResult.failed.length > 0) {
    const err = new Error(
      formatPendingDraftFailureMessage(publishResult.failed),
    ) as Error & { failedFeatureDrafts?: PendingDraftFailure[] };
    err.failedFeatureDrafts = publishResult.failed;
    throw err;
  }

  const now = new Date();
  const s = context.org.settings;

  const startChanges: ContextualBanditUpdate = {
    status: "running",
    dateStarted: cb.dateStarted ?? now,
    autoSnapshots: true,
    stage: "explore",
    stageDateStarted: now,
    scheduleValue: cb.scheduleValue ?? s?.banditScheduleValue ?? 1,
    scheduleUnit: cb.scheduleUnit ?? s?.banditScheduleUnit ?? "days",
    burnInValue: cb.burnInValue ?? s?.banditBurnInValue ?? 1,
    burnInUnit: cb.burnInUnit ?? s?.banditBurnInUnit ?? "days",
  };
  startChanges.nextSnapshotAttempt = determineNextContextualBanditSchedule({
    ...cb,
    ...startChanges,
  } as ContextualBanditInterface);

  const updated = await context.models.contextualBandits.update(
    cb,
    startChanges,
  );

  await context.auditLog({
    event: "contextualBandit.start",
    entity: {
      object: "contextualBandit",
      id: cb.id,
    },
    details: auditDetailsUpdate(cb, updated),
  });

  await refreshLinkedFeaturePayloads(
    context,
    updated,
    "contextualBandit.start",
  );

  return { updated, publishResult };
}

/** Core CB stop (no permission checks). Records `dateStopped`, refreshes SDK payload. */
export async function executeContextualBanditStop(
  context: ReqContext | ApiReqContext,
  cb: ContextualBanditInterface,
  { allowAlreadyStopped = false }: { allowAlreadyStopped?: boolean } = {},
): Promise<{ updated: ContextualBanditInterface }> {
  if (
    cb.status !== "running" &&
    !(allowAlreadyStopped && cb.status === "stopped")
  ) {
    throw new Error(
      "invalid_status: Can only stop a contextual bandit in running status",
    );
  }
  if (cb.status === "stopped") {
    return { updated: cb };
  }

  const now = new Date();

  const updated = await context.models.contextualBandits.update(cb, {
    status: "stopped",
    dateStopped: cb.dateStopped ?? now,
  });

  await context.auditLog({
    event: "contextualBandit.stop",
    entity: {
      object: "contextualBandit",
      id: cb.id,
    },
    details: auditDetailsUpdate(cb, updated),
  });

  await refreshLinkedFeaturePayloads(context, updated, "contextualBandit.stop");

  return { updated };
}
