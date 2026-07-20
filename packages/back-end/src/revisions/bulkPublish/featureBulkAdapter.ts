import type { MergeResultChanges } from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { logger } from "back-end/src/util/logger";
import {
  applyHoldoutSideEffects,
  applyRampCreateActionsForRevision,
  applyRevisionChanges,
  computeRevisionMergeChanges,
  finalizeRampActionsAfterPublish,
  getFeature,
  rollbackCreatedRampSchedules,
  updateFeature,
} from "back-end/src/models/FeatureModel";
import { clearPendingFeatureDraftsForRevision } from "back-end/src/models/ExperimentModel";
import {
  claimFeatureRevisionAsPublished,
  emitFeatureRevisionPublishedSideEffects,
  featureRevisionId,
  getRevision,
  hasPublishLockingScheduledSibling,
  restoreFeatureRevisionAfterFailedBulkPublish,
} from "back-end/src/models/FeatureRevisionModel";
import { canPublishFeatureRevision } from "back-end/src/api/features/autoPublishOnApproval";
import {
  collectFeaturePublishGates,
  planFeatureRevisionMerge,
  FeatureMergePlan,
} from "back-end/src/services/featurePublishGates";
import {
  dispatchFeatureRevisionEvent,
  getPublishedRevisionForEvents,
} from "back-end/src/services/featureRevisionEvents";
import { assertFeatureNotLockedByRamp } from "back-end/src/services/rampSchedule";
import { bulkPublishFields } from "back-end/src/events/bulkPublishCorrelation";
import { getErrorMessage } from "back-end/src/util/errors";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import type {
  BulkPublishableAdapter,
  BulkRevisionRef,
} from "back-end/src/revisions/bulkPublish/BulkPublishableAdapter";

// The feature-vs-generic revision-system differences, contained to this file:
// features keep their own revision model (claim via a guarded status CAS
// there), their own merge computation (autoMerge → MergeResultChanges), and
// their own apply path (applyRevisionChanges → updateFeature). The orchestrator
// can't tell this adapter from a generic one.

/**
 * desiredState carried opaquely through the orchestrator for feature items.
 * The apply phase stashes its runtime state here (created ramp schedule ids
 * for compensation, the post-apply feature for the ramp finalize pass) — the
 * orchestrator passes the same object to restorePreImage/emitPublished.
 */
type FeatureDesiredState = {
  mergeResult: MergeResultChanges;
  plan: FeatureMergePlan;
  createdRampScheduleIds?: string[];
  updatedFeature?: FeatureInterface;
};

function toRef(revision: FeatureRevisionInterface): BulkRevisionRef {
  return {
    id: revision.id ?? featureRevisionId(revision.featureId, revision.version),
    version: revision.version,
    status: revision.status,
    dateUpdated: revision.dateUpdated ?? revision.dateCreated,
    raw: revision as unknown as Record<string, unknown>,
  };
}

function rawRevision(ref: BulkRevisionRef): FeatureRevisionInterface {
  return ref.raw as unknown as FeatureRevisionInterface;
}

export const featureBulkAdapter: BulkPublishableAdapter = {
  async loadEntity(context, entityId) {
    const feature = await getFeature(context, entityId);
    return (feature as unknown as Record<string, unknown>) ?? null;
  },

  async loadRevision(context, entity, version) {
    const feature = entity as unknown as FeatureInterface;
    const revision = await getRevision({
      context,
      organization: feature.organization,
      featureId: feature.id,
      feature,
      version,
    });
    return revision ? toRef(revision) : null;
  },

  canPublish(context, entity) {
    return canPublishFeatureRevision(
      context,
      entity as unknown as FeatureInterface,
    );
  },

  canUpdate(context, entity) {
    return canPublishFeatureRevision(
      context,
      entity as unknown as FeatureInterface,
    );
  },

  canBypassApproval(context, entity) {
    return context.permissions.canBypassApprovalChecks(
      entity as unknown as FeatureInterface,
    );
  },

  async buildDesiredState(context, entity, revision) {
    const feature = entity as unknown as FeatureInterface;
    const plan = await planFeatureRevisionMerge({
      context,
      feature,
      revision: rawRevision(revision),
    });
    const { changes } = computeRevisionMergeChanges(
      context,
      feature,
      rawRevision(revision),
      plan.mergeResult,
    );
    const desired: FeatureDesiredState = {
      mergeResult: plan.mergeResult,
      plan,
    };
    return {
      desiredState: desired as unknown as Record<string, unknown>,
      hasChanges: plan.hasChanges,
      proposedEntity: { ...entity, ...changes },
    };
  },

  async collectGates({ overlayContext, entity, revision, desiredState }) {
    const feature = entity as unknown as FeatureInterface;
    const raw = rawRevision(revision);
    const { plan } = desiredState as unknown as FeatureDesiredState;
    const gates: PublishGate[] = [];

    // Lockdown blocks from the feature publish core, surfaced as gates at
    // plan time. Both are bypassable with the bypass-approval permission,
    // matching the single-entity path's `bypassLockdown` semantics (lockdown
    // is a safety gate against accidental live-traffic changes, not a
    // security boundary).
    try {
      await assertFeatureNotLockedByRamp(overlayContext, feature.id);
    } catch (e) {
      gates.push({
        type: "ramp-locked",
        severity: "blocker",
        messages: [getErrorMessage(e)],
        override: "ignoreWarnings",
        requiresPermission: "bypassApprovalChecks",
        resolution: null,
      });
    }
    if (
      await hasPublishLockingScheduledSibling(
        feature.organization,
        feature.id,
        raw.version,
      )
    ) {
      gates.push({
        type: "publish-locking-sibling",
        severity: "blocker",
        messages: [
          "Another draft of this feature has a scheduled publish that locks other drafts. Cancel that schedule first.",
        ],
        override: "ignoreWarnings",
        requiresPermission: "bypassApprovalChecks",
        resolution: null,
      });
    }

    // The shared gate set (same implementation the interactive handler uses),
    // evaluated against the overlay context so config-backed value checks and
    // hooks see the hypothetical multi-entity end-state. It throws on a
    // config-backed default carrying overrides (never demotable) — surface
    // that as a no-override gate so the plan reports it instead of erroring.
    try {
      gates.push(
        ...(await collectFeaturePublishGates({
          context: overlayContext,
          feature,
          revision: raw,
          plan,
          includeValidationGates: true,
        })),
      );
    } catch (e) {
      gates.push({
        type: "config-backed-default",
        severity: "blocker",
        messages: [getErrorMessage(e)],
        override: null,
        requiresPermission: null,
        resolution: null,
      });
    }

    return gates;
  },

  async claim(context, revision, baseline, { comment }) {
    return claimFeatureRevisionAsPublished(
      rawRevision(revision),
      context.auditUser,
      {
        status: baseline.revisionStatus,
        dateUpdated: baseline.revisionDateUpdated,
      },
      comment,
    );
  },

  async releaseClaim(context, revision) {
    await restoreFeatureRevisionAfterFailedBulkPublish(rawRevision(revision));
  },

  async applyPrecomputed(context, entity, revision, desiredState) {
    const feature = entity as unknown as FeatureInterface;
    const raw = rawRevision(revision);
    const desired = desiredState as unknown as FeatureDesiredState;
    const { mergeResult } = desired;

    // Ramp `create` actions run BEFORE the feature write, mirroring the
    // single-entity path: a schedule-creation failure gates the publish, and
    // the ids are stashed so compensation can roll them back.
    desired.createdRampScheduleIds = await applyRampCreateActionsForRevision(
      context,
      feature,
      raw,
      mergeResult,
    );

    const updated = await applyRevisionChanges(
      context,
      feature,
      raw,
      mergeResult,
    );
    desired.updatedFeature = updated;

    if (mergeResult.holdout !== undefined) {
      await applyHoldoutSideEffects(context, feature, mergeResult.holdout);
    }
  },

  async restorePreImage(context, preImage, revision, desiredState) {
    const feature = preImage as unknown as FeatureInterface;
    const desired = desiredState as unknown as FeatureDesiredState;
    // Ramp schedules created by this item's apply must not linger as orphans.
    if (desired.createdRampScheduleIds?.length) {
      await rollbackCreatedRampSchedules(
        context,
        desired.createdRampScheduleIds,
      );
    }
    const current = await getFeature(context, feature.id);
    if (!current) return;
    // Restore exactly the fields the apply wrote (plus the version pointer,
    // which every merge advances) back to their pre-image values.
    const { mergeResult } = desired;
    const { changes } = computeRevisionMergeChanges(
      context,
      feature,
      rawRevision(revision),
      mergeResult,
    );
    const restore = Object.fromEntries(
      [...new Set([...Object.keys(changes), "version"])].map((key) => [
        key,
        feature[key as keyof FeatureInterface],
      ]),
    ) as Partial<FeatureInterface>;
    await updateFeature(context, current, restore);

    // Reverse the apply-time holdout transition (best-effort: its guards can
    // legitimately refuse during compensation, and a half-restored holdout is
    // still better than silently keeping the failed release's linkage).
    if (mergeResult.holdout !== undefined) {
      try {
        await applyHoldoutSideEffects(
          context,
          { ...current, holdout: mergeResult.holdout ?? undefined },
          feature.holdout ?? null,
        );
      } catch (e) {
        logger.error(
          e,
          `bulk publish compensation: failed to reverse holdout change for feature ${feature.id}`,
        );
      }
    }
  },

  async emitPublished(context, entity, revision, desiredState) {
    const feature = entity as unknown as FeatureInterface;
    const desired = desiredState as unknown as FeatureDesiredState;
    const raw = rawRevision(revision);

    // Post-publish cleanup of pending experiment drafts pointing at this
    // revision — post-commit only, so a rolled-back release never clears them.
    await clearPendingFeatureDraftsForRevision(
      context,
      raw.featureId,
      raw.version,
      raw.rules,
    );
    const updated =
      desired.updatedFeature ??
      (await getFeature(context, feature.id)) ??
      feature;
    const original = rawRevision(revision);

    // Deferred ramp actions (updates, detaches, orphan cleanup) — best-effort
    // after a known-good publish, mirroring the single-entity path. Pending
    // ramps armed on this revision activate via the published hook below.
    if (original.rampActions?.length || desired.updatedFeature) {
      await finalizeRampActionsAfterPublish(
        context,
        feature,
        updated,
        original,
        desired.mergeResult,
      );
    }

    await emitFeatureRevisionPublishedSideEffects(
      context,
      original,
      context.auditUser,
    );
    const finalRevision = await getPublishedRevisionForEvents(
      context,
      updated,
      original,
    );
    await dispatchFeatureRevisionEvent(
      context,
      updated,
      finalRevision,
      "revision.published",
      bulkPublishFields(context),
    );
  },

  async emitPublishFailed(context, entity, revision, reason) {
    await dispatchFeatureRevisionEvent(
      context,
      entity as unknown as FeatureInterface,
      rawRevision(revision),
      "revision.publishFailed",
      {
        failureReason: reason,
        terminal: false,
        attempts: 1,
        ...bulkPublishFields(context),
      },
    );
  },
};
