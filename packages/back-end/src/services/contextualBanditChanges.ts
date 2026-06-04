import { ContextualBanditInterface } from "shared/validators";
import { ApiReqContext } from "back-end/types/api";
import { ReqContext } from "back-end/types/request";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
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
import { SDKPayloadKey } from "back-end/types/sdk-payload";

/**
 * Status transitions for ContextualBandit docs — the CB equivalent of
 * `executeExperimentStart` / `stopExperiment` in
 * `services/experimentChanges/changeExperimentStatus.ts`.
 *
 * Kept deliberately narrow in PR-5:
 *   - No winner / released-variation bookkeeping. CBs don't yet carry a
 *     released-variation concept; that ships with the decision tab in PR-6.
 *   - No status-update scheduling. The scheduled-start agenda job lands
 *     with the auto-snapshot job in a later PR.
 *   - No checklist / approval gating. CBs don't expose a start checklist.
 *
 * Everything that DOES need to happen on start/stop lives here:
 *   - Phase open/close on the CB doc.
 *   - dateStarted / dateStopped timestamps.
 *   - SDK payload refresh for every linked feature, so connections that
 *     reach `getFeatureDefinition` see the new status (and the running CB
 *     becomes eligible for the contextual-bandit-ref payload branch).
 *   - Pending-draft autopublish via the PR-3 helper.
 *
 * Permission checks live at the HTTP boundary (the CB REST handlers added
 * in PR-4/PR-4-cleanup) so these helpers are safe to call from agenda
 * jobs without a user context.
 */

// ---------------------------------------------------------------------------
// Shared payload-refresh helper
// ---------------------------------------------------------------------------

/**
 * SDK-payload keys affected by a CB status change. Mirrors `getPayloadKeys`
 * for experiments — uses the CB's `linkedFeatures` to find which envs/projects
 * to refresh. Walks both feature-rule families during the decoupling window:
 * Matches `contextual-bandit-ref` rules pointing at this CB. The legacy
 * `experiment-ref` fallback was retired in PR-8 Commit 3 — the migration
 * script (`scripts/migrate-cb-decoupling.ts`) rewrites every
 * `experiment-ref` that targeted a CB-typed experiment to a
 * `contextual-bandit-ref` before this code ships, and post-Commit-3 the
 * experiment FK on the CB is gone so there's no fallback id to match
 * against anyway.
 */
function getPayloadKeysForContextualBandit(
  context: ReqContext | ApiReqContext,
  cb: ContextualBanditInterface,
): SDKPayloadKey[] {
  const environments = getEnvironmentIdsFromOrg(context.org);
  return getAffectedSDKPayloadKeys(
    // The features themselves are loaded by the caller; here we only need
    // the predicate, so build the keys from the in-context linked-features
    // list. `queueSDKPayloadRefresh` deduplicates downstream.
    [],
    environments,
    (rule) => {
      if (rule.enabled === false) return false;
      return (
        rule.type === "contextual-bandit-ref" &&
        rule.contextualBanditId === cb.id
      );
    },
  );
}

async function refreshLinkedFeaturePayloads(
  context: ReqContext | ApiReqContext,
  cb: ContextualBanditInterface,
  auditEvent: "contextualBandit.start" | "contextualBandit.stop",
): Promise<void> {
  const linkedFeatures = await getFeaturesByIds(
    context,
    cb.linkedFeatures ?? [],
  );
  if (!linkedFeatures.length) return;

  const environments = getEnvironmentIdsFromOrg(context.org);
  const payloadKeys = getAffectedSDKPayloadKeys(
    linkedFeatures,
    environments,
    (rule) => {
      if (rule.enabled === false) return false;
      return (
        rule.type === "contextual-bandit-ref" &&
        rule.contextualBanditId === cb.id
      );
    },
  );
  if (payloadKeys.length === 0) return;
  queueSDKPayloadRefresh({
    context,
    payloadKeys,
    auditContext: { event: auditEvent, model: "contextualBandit", id: cb.id },
  });
}

// Exported for callers (agenda jobs in a later PR) that don't have
// linked-feature docs in scope yet.
export { getPayloadKeysForContextualBandit };

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/**
 * Core CB start — no permission checks, works from any context (HTTP
 * request or Agenda job).
 *
 * Publishes pending linked feature drafts BEFORE the status flip so a
 * single atomic state transition is observable to the SDK payload refresh
 * that follows. Throws (with `failedFeatureDrafts` attached) if any draft
 * cannot be published — mirrors `executeExperimentStart`.
 */
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

  // Ensure a phase exists. CBs are typically seeded with an initial phase
  // by `ContextualBanditModel.processApiCreateBody`, but defensive-creation
  // here matches `executeExperimentStart`'s default-phase fallback for
  // older docs that predate the CB-decoupling create flow.
  const phases =
    cb.phases.length > 0
      ? cb.phases
      : [
          {
            dateStarted: now,
            currentLeafWeights: [],
          },
        ];

  const updated = await context.models.contextualBandits.update(cb, {
    status: "running",
    dateStarted: cb.dateStarted ?? now,
    phases,
  });

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

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

/**
 * Core CB stop — no permission checks, works from any context.
 *
 * Closes the current phase (sets `dateEnded` if not already set), records
 * `dateStopped`, and refreshes the SDK payload so the running rule drops
 * out of the experiment-rule emitter. `allowAlreadyStopped` lets idempotent
 * callers (agenda jobs, retries) skip the status-guard error.
 */
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
  const phases = cb.phases.map((p, i, arr) => {
    if (i === arr.length - 1 && !p.dateEnded) {
      return { ...p, dateEnded: now };
    }
    return p;
  });

  const updated = await context.models.contextualBandits.update(cb, {
    status: "stopped",
    dateStopped: cb.dateStopped ?? now,
    phases,
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
