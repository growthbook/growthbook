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
  computeSafeRolloutStatusMap,
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
import { ownedRestoreValues } from "back-end/src/revisions/bulkPublish/ownedRestore";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import {
  gateOr5xx,
  makeBlockingGate,
} from "back-end/src/revisions/publishGates";
import type {
  BulkPublishableAdapter,
  BulkRevisionRef,
} from "back-end/src/revisions/bulkPublish/BulkPublishableAdapter";

// Contains every feature-vs-generic revision-system difference: features keep
// their own revision model, merge computation, and apply path. The
// orchestrator can't tell this adapter from a generic one.

/**
 * desiredState carried opaquely through the orchestrator for feature items.
 * The apply phase stashes runtime state here (created ramp schedule ids, the
 * post-apply feature) for restorePreImage/emitPublished to read.
 */
type FeatureDesiredState = {
  mergeResult: MergeResultChanges;
  plan: FeatureMergePlan;
  createdRampScheduleIds?: string[];
  updatedFeature?: FeatureInterface;
  /**
   * Per safe rollout the apply's status sync will write: the pre-apply doc
   * (compensation's restore source), the status the sync writes (the
   * ownership check even when `post` is absent), and the post-apply doc
   * (per-field ownership baseline so worker progress is never clobbered;
   * absent when the apply threw before the feature write completed).
   */
  safeRollouts?: Array<{
    pre: SafeRolloutInterface;
    writtenStatus: string;
    post?: SafeRolloutInterface;
  }>;
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

  applyScanOverlay(overlayContext, proposedEntities) {
    // Feature guards resolve cross-entity state through featureScanOverlay
    // (an id→feature map), not a model overlay.
    overlayContext.featureScanOverlay = new Map(
      (proposedEntities as unknown as FeatureInterface[]).map((f) => [f.id, f]),
    );
  },

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

  // Entity-level check only; the env-scoped canPublishFeature check happens
  // in collectGates, narrowed to the environments the merge touches.
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
    // overlay context.
    const envsToCheck = await getMergeResultPublishEnvs({
      context: callerContext,
      feature,
      filledLiveRules: plan.filledLiveRules,
      result: plan.mergeResult,
      environmentIds: plan.environmentIds,
    });
    if (!callerContext.permissions.canPublishFeature(feature, envsToCheck)) {
      gates.push(
        makeBlockingGate({
          type: "permission-denied",
          messages: [
            "You do not have permission to publish this Feature Flag in the environments this revision changes.",
          ],
        }),
      );
    }

    // The generic no-op merge path doesn't apply to features — a publish must
    // advance the live version pointer — so an empty revision blocks.
    if (!plan.hasChanges) {
      gates.push(
        makeBlockingGate({
          type: "no-changes",
          messages: ["No changes detected in this revision."],
        }),
      );
    }

    // Lockdown blocks, surfaced as plan-time gates. Both auto-clear for the
    // bypass-approval permission or the org REST-bypass setting with no flag
    // needed (classifyPublishGate's lockdown branch) — a safety gate against
    // accidental live-traffic changes, not a security boundary.
    try {
      await assertFeatureNotLockedByRamp(overlayContext, feature.id);
    } catch (e) {
      // The lockdown signal is a plain Error (no status), so gateOr5xx can't
      // separate it from an infra failure of the schedule read — both would be
      // caught as a ramp-locked gate. That read is a single indexed lookup, so
      // treat any throw as the lock it almost always is.
      gates.push(
        makeBlockingGate({
          type: "ramp-locked",
          messages: [getErrorMessage(e)],
          requiresPermission: "bypassApprovalChecks",
        }),
      );
    }
    if (
      await hasPublishLockingScheduledSibling(
        feature.organization,
        feature.id,
        raw.version,
      )
    ) {
      gates.push(
        makeBlockingGate({
          type: "publish-locking-sibling",
          messages: [
            "Another draft of this Feature Flag has a scheduled publish that locks other drafts. Cancel that schedule first.",
          ],
          requiresPermission: "bypassApprovalChecks",
        }),
      );
    }

    // The shared gate set, evaluated against the overlay context so
    // config-backed value checks and hooks see the multi-entity end-state. It
    // throws on a config-backed default carrying overrides (never demotable)
    // — surfaced as a no-override gate so the plan reports it.
    try {
      gates.push(
        ...(await collectFeaturePublishGates({
          context: overlayContext,
          feature,
          revision: raw,
          plan,
          comment: flags.comment,
          // Hooks judge publishedBy: the claim will stamp the CALLER's
          // identity, never the identity-less overlay scan context's.
          publisher: callerContext.auditUser,
          includeValidationGates: true,
        })),
      );
    } catch (e) {
      // Only the structural config-backed-default rejection (a 4xx payload
      // error, the one thing this collector throws rather than gates) becomes a
      // no-override gate. Infra failures — transient DB errors in the
      // archive-dependents / value scans inside — propagate as the 5xx they
      // are, instead of masquerading as a permanent unfixable blocker.
      gates.push(
        gateOr5xx(e, (message) =>
          makeBlockingGate({
            type: "config-backed-default",
            messages: [message],
          }),
        ),
      );
    }

    return gates;
  },

  async claim(context, revision, baseline, { comment }) {
    const { claimed, claimStamp } = await claimFeatureRevisionAsPublished(
      rawRevision(revision),
      context.auditUser,
      {
        status: baseline.revisionStatus,
        dateUpdated: baseline.revisionDateUpdated,
      },
      comment,
    );
    revision.claimStamp = claimStamp;
    return claimed;
  },

  async releaseClaim(context, revision) {
    return restoreFeatureRevisionAfterFailedBulkPublish(
      rawRevision(revision),
      revision.claimStamp ?? null,
    );
  },

  async applyPrecomputed(context, entity, revision, desiredState) {
    const feature = entity as unknown as FeatureInterface;
    const raw = rawRevision(revision);
    const desired = desiredState as unknown as FeatureDesiredState;
    const { mergeResult } = desired;

    // Ramp `create` actions run BEFORE the feature write: a schedule-creation
    // failure gates the publish, and the ids are stashed for compensation.
    desired.createdRampScheduleIds = await applyRampCreateActionsForRevision(
      context,
      feature,
      raw,
      mergeResult,
    );

    // Snapshot the safe-rollout docs whose statuses the apply's sync will
    // rewrite (computeSafeRolloutStatusMap is the sync's own disposition), so
    // compensation can restore with an ownership check.
    const statusMap = computeSafeRolloutStatusMap(feature, raw);
    const safeRolloutIds = Object.keys(statusMap);
    if (safeRolloutIds.length) {
      const preImages =
        await context.models.safeRollout.getByIds(safeRolloutIds);
      desired.safeRollouts = preImages.map((pre) => ({
        pre,
        writtenStatus: statusMap[pre.id],
      }));
    }

    try {
      desired.updatedFeature = await applyRevisionChanges(
        context,
        feature,
        raw,
        mergeResult,
      );
    } finally {
      // Re-snapshot the safe rollouts after applyRevisionChanges' sync wrote
      // them — the per-field ownership baseline compensation needs. In `finally`
      // because a later apply step (the feature write) can throw AFTER the sync
      // ran; without this baseline the restore can't tell the sync's stamp from
      // a concurrent worker advance. Best-effort — must not mask the apply
      // error; a missing baseline is caught in restoreAfterFailedBulkPublish
      // (it refuses to half-restore), so the item is reported published.
      if (desired.safeRollouts?.length) {
        try {
          const postImages =
            await context.models.safeRollout.getByIds(safeRolloutIds);
          const postById = new Map(postImages.map((doc) => [doc.id, doc]));
          for (const entry of desired.safeRollouts) {
            entry.post = postById.get(entry.pre.id);
          }
        } catch (e) {
          logger.error(
            e,
            `bulk publish: post-apply safe-rollout snapshot failed for feature ${feature.id}`,
          );
        }
      }
    }

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
    // This apply wrote the feature, so it should exist. If it's gone (a
    // concurrent hard-delete between apply and compensation), surface it —
    // reporting the item "rolled-back" would assert a pre-image that no longer
    // exists, and the doc-dependent satellite reversals below can't run without
    // it. Throwing routes the item to restore-failed (needs attention), the
    // same honest outcome the generic adapter gives.
    if (!current) {
      throw new Error(
        `bulk publish compensation: feature "${feature.id}" no longer exists — cannot restore its pre-image`,
      );
    }
    const { mergeResult } = desired;

    // Reverse the cross-collection writes BEFORE the feature-doc restore so a
    // failed reversal keeps the doc consistent with the side collections. Each
    // reversal is attempted independently; ANY failure is surfaced at the end,
    // so a satellite left at the failed publish's state (safe rollout advancing,
    // stale experiment link, retained holdout) makes the item report "published"
    // rather than a clean rollback. The safe-rollout restore is ownership-checked
    // inside so worker progress is never clobbered.
    const reversalFailures: string[] = [];
    for (const entry of desired.safeRollouts ?? []) {
      try {
        await context.models.safeRollout.restoreAfterFailedBulkPublish(
          entry.pre,
          entry.writtenStatus,
          entry.post,
        );
      } catch (e) {
        reversalFailures.push(`safe rollout ${entry.pre.id}`);
        logger.error(
          e,
          `bulk publish compensation: failed to restore safe rollout ${entry.pre.id} for feature ${feature.id}`,
        );
      }
    }

    // Unlink experiments the apply newly linked this feature into — the
    // restored rules no longer reference them (the helper no-ops when the
    // link is already gone). Deliberately NOT gated on the holdout reversal
    // below: the unlink pairs with the unconditional rules restore, and
    // skipping it would break the hotter rules↔linkedFeatures invariant.
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
        reversalFailures.push(`experiment ${experimentId} unlink`);
        logger.error(
          e,
          `bulk publish compensation: failed to unlink feature ${feature.id} from experiment ${experimentId}`,
        );
      }
    }

    // Reverse the apply-time holdout transition. Its guards can legitimately
    // refuse during compensation — then the doc's holdout key is NOT restored
    // below, keeping the doc consistent with the un-reversed holdout/experiment
    // collections (the failure is surfaced with the others at the end).
    let holdoutReversalOk = true;
    if (mergeResult.holdout !== undefined) {
      try {
        await applyHoldoutSideEffects(
          context,
          { ...current, holdout: mergeResult.holdout ?? undefined },
          feature.holdout ?? null,
        );
      } catch (e) {
        holdoutReversalOk = false;
        reversalFailures.push("holdout");
        logger.error(
          e,
          `bulk publish compensation: failed to reverse holdout change for feature ${feature.id} — linked experiments [${(current.linkedExperiments ?? []).join(", ")}] may carry stale holdout pointers`,
        );
      }
    }

    // Restore exactly the fields the apply wrote (plus the version pointer,
    // which every merge advances) back to their pre-image values.
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
    const restore = ownedRestoreValues({
      keys: restoreKeys,
      preImage: feature as unknown as Record<string, unknown>,
      written,
      current: current as unknown as Record<string, unknown>,
      // The doc's holdout pointer follows the side collections: if their
      // reversal failed, keep the doc at the failed publish's holdout state so
      // membership stays consistent end to end.
      skip: (key) => key === "holdout" && !holdoutReversalOk,
    }) as Partial<FeatureInterface>;
    if (Object.keys(restore).length) {
      await updateFeature(context, current, restore);
    }

    // A failed satellite reversal leaves the feature partly published — throw
    // so commitBulkPublish marks the item restore-failed and reports it
    // "published" rather than a clean rollback.
    if (reversalFailures.length) {
      throw new Error(
        `bulk publish compensation: could not fully roll back feature ${feature.id} — ${reversalFailures.join(", ")} left at the failed publish's state`,
      );
    }
  },

  async emitPublished(context, entity, revision, desiredState) {
    const feature = entity as unknown as FeatureInterface;
    const desired = desiredState as unknown as FeatureDesiredState;
    const raw = rawRevision(revision);
    const updated =
      desired.updatedFeature ??
      (await getFeature(context, feature.id)) ??
      feature;

    // The load-bearing side effects run FIRST (the published hook activates
    // armed pending ramps) before the best-effort tail, which is individually
    // isolated so none of it can starve these.
    await emitFeatureRevisionPublishedSideEffects(
      context,
      raw,
      context.auditUser,
    );
    const finalRevision = await getPublishedRevisionForEvents(
      context,
      updated,
      raw,
    );
    await dispatchFeatureRevisionEvent(
      context,
      updated,
      finalRevision,
      "revision.published",
      bulkPublishFields(context),
    );

    const bestEffort = async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        logger.error(
          e,
          `bulk publish: ${label} failed for feature ${feature.id}`,
        );
      }
    };

    // Post-commit only, so a rolled-back release never clears pending drafts.
    await bestEffort("pending-draft cleanup", () =>
      clearPendingFeatureDraftsForRevision(
        context,
        raw.featureId,
        raw.version,
        raw.rules,
      ),
    );

    if (
      desired.mergeResult.metadata?.tags !== undefined &&
      Array.isArray(desired.mergeResult.metadata.tags)
    ) {
      await bestEffort("tag diff", () =>
        addTagsDiff(
          context.org.id,
          feature.tags || [],
          desired.mergeResult.metadata?.tags ?? [],
        ),
      );
    }

    await bestEffort("audit log", () =>
      context.auditLog({
        event: "feature.publish",
        entity: {
          object: "feature",
          id: feature.id,
        },
        details: auditDetailsUpdate(feature, updated, {
          revision: raw.version,
          comment: raw.comment ?? "",
        }),
      }),
    );

    // Deferred ramp actions (updates, detaches, orphan cleanup) — best-effort
    // after a known-good publish. Armed pending ramps activate via the
    // published hook above.
    if (raw.rampActions?.length || desired.updatedFeature) {
      await bestEffort("ramp finalize", () =>
        finalizeRampActionsAfterPublish(
          context,
          feature,
          updated,
          raw,
          desired.mergeResult,
        ),
      );
    }
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
