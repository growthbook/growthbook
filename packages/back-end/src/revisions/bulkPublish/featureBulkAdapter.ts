import { isStrandedLiveRevision, type MergeResultChanges } from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import {
  bypassApprovalPermission,
  NO_ENVIRONMENT_BINDING,
} from "shared/permissions";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { SafeRolloutInterface } from "shared/validators";
import { logger } from "back-end/src/util/logger";
import {
  applyHoldoutExperimentLinkage,
  type HoldoutExperimentLinkagePlan,
  applyHoldoutSideEffects,
  assertHoldoutChangeAllowed,
  applyRampCreateActionsForRevision,
  applyRevisionChanges,
  captureHoldoutLinkagePreImage,
  computeRevisionMergeChanges,
  computeSafeRolloutStatusMap,
  finalizeRampActionsAfterPublish,
  getFeature,
  type HoldoutLinkagePreImage,
  planHoldoutExperimentLinkage,
  reverseHoldoutExperimentLinkage,
  rewindHoldoutLinkage,
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
  getLinkageSyncRevisionSummaries,
  getRevision,
  hasPublishLockingScheduledSibling,
  restoreFeatureRevisionAfterFailedBulkPublish,
} from "back-end/src/models/FeatureRevisionModel";
import { isArchiveTransition } from "back-end/src/revisions/archiveTransition";
import {
  applyFeatureContextualBanditLinkage,
  ContextualBanditLinkagePlan,
  planFeatureContextualBanditLinkage,
  referencesAnyContextualBandit,
  reverseFeatureContextualBanditLinkage,
} from "back-end/src/util/featureContextualBanditSync";
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
  /**
   * The holdout linkage the apply is about to write, captured before any
   * mutation. Absent means the apply threw before that point, so there is
   * nothing for compensation to reverse.
   */
  holdoutLinkage?: HoldoutLinkagePreImage | null;
  holdoutExperimentLinkage?: HoldoutExperimentLinkagePlan[];
  /** Same contract as `holdoutExperimentLinkage`: captured pre-mutation, null when there is nothing to write. */
  contextualBanditLinkage?: ContextualBanditLinkagePlan | null;
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

  // Coarse project-level publish authority (no env restriction here); the
  // precise env-scoped canPublishFeature check happens in collectGates, narrowed
  // to the environments the merge touches. Publishing does not require manage.
  canPublish(context, entity) {
    return context.permissions.canPublishFeature(
      entity as unknown as FeatureInterface,
      [],
    );
  },

  canUpdate(context, entity) {
    // Destination-project check on a publish that moves projects.
    return context.permissions.canPublishFeature(
      entity as unknown as FeatureInterface,
      NO_ENVIRONMENT_BINDING,
    );
  },

  canBypassApproval(context, entity) {
    return context.permissions.canBypassFlagApprovalChecks(
      entity as unknown as FeatureInterface,
      "feature",
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

    // Archiving is delete-class wherever the merge lands (it takes the flag out
    // of service and is what lets it then be deleted freely), so bulk publish
    // enforces it too. Unarchiving is covered by the publish check above.
    if (
      isArchiveTransition({
        proposed: plan.mergeResult?.archived,
        current: feature.archived,
      }) &&
      !callerContext.permissions.canDeleteFeature(feature, envsToCheck)
    ) {
      gates.push(
        makeBlockingGate({
          type: "permission-denied",
          messages: [
            "You do not have permission to archive this Feature Flag.",
          ],
        }),
      );
    }

    // The generic no-op merge path doesn't apply to features — a publish must
    // advance the live version pointer — so an empty revision blocks.
    if (
      !plan.hasChanges &&
      // Publishing a stranded revision is how it gets reconciled.
      !isStrandedLiveRevision({
        featureVersion: feature.version,
        revisionVersion: raw.version,
        revisionStatus: raw.status,
        hasChanges: plan.hasChanges,
      })
    ) {
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
          requiresPermission: bypassApprovalPermission("feature"),
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
          requiresPermission: bypassApprovalPermission("feature"),
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

    // TOCTOU backstop — the plan gate is the primary check. Runs before any
    // mutation so a change that became invalid since planning fails fast,
    // without relying on compensation to undo an advanced feature.version.
    if (mergeResult.holdout !== undefined) {
      await assertHoldoutChangeAllowed(
        context,
        feature,
        mergeResult.holdout,
        mergeResult.rules ?? feature.rules ?? [],
        { isRevert: !!raw.revertedFrom },
      );
      desired.holdoutLinkage = await captureHoldoutLinkagePreImage(
        context,
        feature,
        mergeResult.holdout,
      );
    }

    // Same pre-mutation rule: planning is read-only, and its project check must
    // refuse the publish before feature.version moves. Covers a rules-only
    // publish too (mirrors publishRevision).
    desired.holdoutExperimentLinkage = await planHoldoutExperimentLinkage(
      context,
      feature,
      (mergeResult.holdout !== undefined
        ? mergeResult.holdout?.id
        : feature.holdout?.id) ?? null,
      mergeResult.rules ?? feature.rules ?? [],
    );

    // Also pre-mutation, so compensation has a pre-image to converge on. Rules
    // on either side matter: one adding a bandit rule links the feature, one
    // removing the last of them unlinks it.
    if (
      referencesAnyContextualBandit(feature.rules) ||
      referencesAnyContextualBandit(mergeResult.rules)
    ) {
      const { openDrafts } = await getLinkageSyncRevisionSummaries(
        raw.organization,
        raw.featureId,
      );
      desired.contextualBanditLinkage =
        await planFeatureContextualBanditLinkage(
          context,
          raw.featureId,
          openDrafts.filter((d) => d.version !== raw.version),
          mergeResult.rules ?? feature.rules ?? [],
        );
    }

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
      // Guard already ran above, before any mutation.
      await applyHoldoutSideEffects(context, feature, mergeResult.holdout, {
        skipGuard: true,
      });
    }

    for (const plan of desired.holdoutExperimentLinkage ?? []) {
      await applyHoldoutExperimentLinkage(context, plan);
    }

    if (desired.contextualBanditLinkage) {
      await applyFeatureContextualBanditLinkage(
        context,
        desired.contextualBanditLinkage,
      );
    }
  },

  async restorePreImage(context, preImage, revision, desiredState) {
    const feature = preImage as unknown as FeatureInterface;
    const desired = desiredState as unknown as FeatureDesiredState;
    const reversalFailures: string[] = [];
    const current = await getFeature(context, feature.id);
    // Entity gone (concurrent hard-delete): can't restore a pre-image that no
    // longer exists, and the doc-dependent reversals below need it → route to
    // restore-failed (reported published).
    if (!current) {
      throw new Error(
        `bulk publish compensation: feature "${feature.id}" no longer exists — cannot restore its pre-image`,
      );
    }
    const { mergeResult } = desired;

    // Leave-whole rule (same as the generic adapter): the moment ANY reversal
    // fails, stop mutating and leave the feature DOC at the published state —
    // reverting rules/version beside a still-published satellite would be a
    // false "rolled-back". Enforced before every mutating phase below, so each
    // leave-whole outcome stays coherent (kept ramp schedules pair with the
    // published doc, intact links pair with the published rules).
    //
    // ACCEPTED BOUNDARY: these reversals are not transactional. Deterministic
    // failures are designed out (rollouts preflighted before any mutates, the
    // holdout resolves its target before mutating and skips its config-guard on
    // revert, revert-only writes gated), but an INFRA failure after a prior
    // write can still leave a partial — reported "published" (needs attention).
    // That residual needs DB transactions; it can't be reordered away.
    const assertNoReversalFailures = () => {
      if (reversalFailures.length) {
        throw new Error(
          `bulk publish compensation: could not fully roll back feature ${feature.id} — ${reversalFailures.join(", ")}; feature left at the published state`,
        );
      }
    };

    // Two passes over the safe-rollout reversals: a dry preflight (all checks,
    // no writes) so a deterministic refusal — a missing ownership baseline —
    // surfaces before ANY rollout mutates, then the real pass.
    for (const dryRun of [true, false]) {
      for (const entry of desired.safeRollouts ?? []) {
        try {
          await context.models.safeRollout.restoreAfterFailedBulkPublish(
            entry.pre,
            entry.writtenStatus,
            entry.post,
            { dryRun },
          );
        } catch (e) {
          reversalFailures.push(`safe rollout ${entry.pre.id}`);
          logger.error(
            e,
            `bulk publish compensation: failed to restore safe rollout ${entry.pre.id} for feature ${feature.id}`,
          );
        }
      }
      assertNoReversalFailures();
    }

    // Reverse the apply-time holdout transition from the pre-image the apply
    // captured before any mutation, rather than running the transition backwards:
    // a reversal derived from the delta cannot express "there was no holdout
    // before" (its experiment restamping would be skipped entirely) and would
    // stamp the old holdout onto experiments this revision newly added. Every
    // step converges on a captured value, so it is an idempotent no-op if the
    // forward write never landed and repairs the half if it landed partway.
    for (const plan of desired.holdoutExperimentLinkage ?? []) {
      try {
        await reverseHoldoutExperimentLinkage(context, plan);
      } catch (e) {
        reversalFailures.push("holdout experiments");
        logger.error(
          e,
          `bulk publish compensation: failed to reverse experiment linkage for holdout ${plan.holdoutId} on feature ${feature.id}`,
        );
      }
    }
    assertNoReversalFailures();

    if (desired.contextualBanditLinkage) {
      try {
        await reverseFeatureContextualBanditLinkage(
          context,
          desired.contextualBanditLinkage,
        );
      } catch (e) {
        reversalFailures.push("contextual bandit linkage");
        logger.error(
          e,
          `bulk publish compensation: failed to reverse contextual bandit linkage for feature ${feature.id}`,
        );
      }
      assertNoReversalFailures();
    }

    if (desired.holdoutLinkage) {
      try {
        await rewindHoldoutLinkage(context, desired.holdoutLinkage);
      } catch (e) {
        reversalFailures.push("holdout");
        logger.error(
          e,
          `bulk publish compensation: failed to reverse holdout change for feature ${feature.id} — linked experiments [${(current.linkedExperiments ?? []).join(", ")}] may carry stale holdout pointers`,
        );
      }
      assertNoReversalFailures();
    }

    // Every satellite reversed → the revert is decided. Delete the ramp
    // schedules this apply created (the pre-image had none). ONLY on a revert:
    // a feature left published keeps its created ramp so the poller still
    // activates it — deleting it there would freeze the rule at zero traffic.
    if (desired.createdRampScheduleIds?.length) {
      const failedIds = await rollbackCreatedRampSchedules(
        context,
        desired.createdRampScheduleIds,
      );
      if (failedIds.length) {
        reversalFailures.push(`ramp schedule(s) ${failedIds.join(", ")}`);
      }
      assertNoReversalFailures();
    }

    // Unlink the experiments the restored rules no longer reference (paired
    // with the rules restore: a reverted rule set must not leave a dangling
    // link).
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
    assertNoReversalFailures();

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
    }) as Partial<FeatureInterface>;
    if (Object.keys(restore).length) {
      await updateFeature(context, current, restore);
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
