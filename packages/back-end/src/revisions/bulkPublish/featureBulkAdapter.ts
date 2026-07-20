import { isEqual } from "lodash";
import type { MergeResultChanges } from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { SafeRolloutInterface } from "shared/validators";
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
import {
  clearPendingFeatureDraftsForRevision,
  removeLinkedFeatureFromExperiment,
} from "back-end/src/models/ExperimentModel";
import { addTagsDiff } from "back-end/src/models/TagModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import {
  claimFeatureRevisionAsPublished,
  emitFeatureRevisionPublishedSideEffects,
  featureRevisionId,
  getRevision,
  hasPublishLockingScheduledSibling,
  restoreFeatureRevisionAfterFailedBulkPublish,
} from "back-end/src/models/FeatureRevisionModel";
import { getMergeResultPublishEnvs } from "back-end/src/services/features";
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
  /**
   * Pre-apply snapshots of the safe-rollout docs the apply's status sync may
   * mutate (captured BEFORE applyRevisionChanges, which writes them before
   * the feature doc) — compensation restores their statuses.
   */
  safeRolloutPreImages?: SafeRolloutInterface[];
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
  // Features gate stale-base force-merge on the permission alone.
  staleBaseForceAllowsRestBypass: false,

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

  // Mirrors the single-entity handler's up-front check. The env-scoped
  // canPublishFeature check happens in collectGates, where the merge result
  // narrows it to the environments the publish actually touches.
  canPublish(context, entity) {
    return context.permissions.canUpdateFeature(
      entity as unknown as FeatureInterface,
      {},
    );
  },

  canUpdate(context, entity) {
    return context.permissions.canUpdateFeature(
      entity as unknown as FeatureInterface,
      {},
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

  async collectGates({
    callerContext,
    overlayContext,
    entity,
    revision,
    desiredState,
    flags,
  }) {
    const feature = entity as unknown as FeatureInterface;
    const raw = rawRevision(revision);
    const { plan } = desiredState as unknown as FeatureDesiredState;
    const gates: PublishGate[] = [];

    // Environment-scoped publish authority, narrowed to the environments this
    // merge actually touches — the caller's context, never the admin-role
    // overlay context. Mirrors the single-entity handler's canPublishFeature
    // check.
    const envsToCheck = await getMergeResultPublishEnvs({
      context: callerContext,
      feature,
      filledLiveRules: plan.filledLiveRules,
      result: plan.mergeResult,
      environmentIds: plan.environmentIds,
    });
    if (!callerContext.permissions.canPublishFeature(feature, envsToCheck)) {
      gates.push({
        type: "permission-denied",
        severity: "blocker",
        messages: [
          "You do not have permission to publish this Feature Flag in the environments this revision changes.",
        ],
        override: null,
        requiresPermission: null,
        resolution: null,
      });
    }

    // Feature parity with the single-entity handler's 400: an empty feature
    // revision can't publish (the generic no-op merge path doesn't apply —
    // feature publishes must advance the live version pointer).
    if (!plan.hasChanges) {
      gates.push({
        type: "no-changes",
        severity: "blocker",
        messages: ["No changes detected in this revision."],
        override: null,
        requiresPermission: null,
        resolution: null,
      });
    }

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
          comment: flags.comment,
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

    // Snapshot the safe-rollout docs whose statuses the apply's sync may
    // rewrite (revision rules ∪ live rules — the same id set
    // updateSafeRolloutStatuses computes) so compensation can restore them.
    const safeRolloutIds = [
      ...new Set(
        [...(raw.rules ?? []), ...(feature.rules ?? [])]
          .filter((rule) => rule?.type === "safe-rollout")
          .map((rule) => (rule as { safeRolloutId: string }).safeRolloutId),
      ),
    ];
    if (safeRolloutIds.length) {
      desired.safeRolloutPreImages =
        await context.models.safeRollout.getByIds(safeRolloutIds);
    }

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
    const restoreKeys = new Set([...Object.keys(changes), "version"]);
    // A holdout removal lands via removeHoldoutFromFeature rather than
    // `changes`, so include the key explicitly when the apply transitioned it.
    if (mergeResult.holdout !== undefined) restoreKeys.add("holdout");
    // What the apply wrote per key: the persisted post-apply doc when the
    // feature write completed, else the computed $set (with a holdout removal
    // written as an unset).
    const written: Record<string, unknown> = desired.updatedFeature
      ? (desired.updatedFeature as unknown as Record<string, unknown>)
      : {
          ...changes,
          ...(mergeResult.holdout === null ? { holdout: undefined } : {}),
        };
    const currentDoc = current as unknown as Record<string, unknown>;
    const restore = Object.fromEntries(
      [...restoreKeys]
        // Same ownership rule as the generic adapter: restore a key only
        // while the live doc still holds the failed publish's value —
        // anything else was moved by a concurrent writer (or never written
        // by this apply) and must not be clobbered with the pre-image.
        .filter((key) => isEqual(currentDoc[key], written[key]))
        .map((key) => [
          key,
          // null-as-clear: undefined pre-image values would be dropped by the
          // update path's changes filter, leaving apply-added fields in place.
          feature[key as keyof FeatureInterface] ?? null,
        ]),
    ) as Partial<FeatureInterface>;
    if (Object.keys(restore).length) {
      await updateFeature(context, current, restore);
    }

    // Reverse the cross-collection writes the apply made (both best-effort,
    // matching the holdout reversal below — a partial rollback with a logged
    // error beats silently keeping the failed release's state).
    //
    // Safe rollouts the apply's status sync advanced go back to their
    // pre-apply state, including unsetting start metadata stamped on a
    // never-started rollout.
    for (const pre of desired.safeRolloutPreImages ?? []) {
      try {
        await context.models.safeRollout.restoreAfterFailedBulkPublish(pre);
      } catch (e) {
        logger.error(
          e,
          `bulk publish compensation: failed to restore safe rollout ${pre.id} for feature ${feature.id}`,
        );
      }
    }

    // Experiments the apply newly linked this feature into (linkedFeatures is
    // written by updateFeature for experiments absent from the pre-image's
    // linkedExperiments) get unlinked — the restored rules no longer reference
    // them. The helper no-ops when the link is already gone.
    const addedExperiments = (
      desired.updatedFeature?.linkedExperiments ?? []
    ).filter((id) => !(feature.linkedExperiments ?? []).includes(id));
    for (const experimentId of addedExperiments) {
      try {
        await removeLinkedFeatureFromExperiment(
          context,
          experimentId,
          feature.id,
        );
      } catch (e) {
        logger.error(
          e,
          `bulk publish compensation: failed to unlink feature ${feature.id} from experiment ${experimentId}`,
        );
      }
    }

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

    if (
      desired.mergeResult.metadata?.tags !== undefined &&
      Array.isArray(desired.mergeResult.metadata.tags)
    ) {
      await addTagsDiff(
        context.org.id,
        feature.tags || [],
        desired.mergeResult.metadata.tags,
      );
    }

    await context.auditLog({
      event: "feature.publish",
      entity: {
        object: "feature",
        id: feature.id,
      },
      details: auditDetailsUpdate(feature, updated, {
        revision: raw.version,
        comment: raw.comment ?? "",
      }),
    });

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
