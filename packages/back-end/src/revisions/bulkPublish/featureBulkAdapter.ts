import { isStrandedLiveRevision, type MergeResultChanges } from "shared/util";
import { draftRevertedFromVersion } from "shared/util";
import { FeatureInterface } from "shared/types/feature";
import {
  bypassApprovalPermission,
  NO_ENVIRONMENT_BINDING,
} from "shared/permissions";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { SafeRolloutInterface } from "shared/validators";
import { canPublishFeatureRevisionChange } from "back-end/src/revisions/featureDraftAuthority";
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
import {
  assertFeatureNotLockedByRamp,
  RampLockdownError,
} from "back-end/src/services/rampSchedule";
import {
  bulkPublishFields,
  entityKey,
} from "back-end/src/events/bulkPublishCorrelation";
import { getErrorMessage } from "back-end/src/util/errors";
import { CasConflictError } from "back-end/src/models/BaseModel";
import { ownedRestoreValues } from "back-end/src/revisions/bulkPublish/ownedRestore";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import {
  LandingConflictError,
  runGuardedWrite,
} from "back-end/src/revisions/landingSequence";
import {
  authorityRefused,
  gateOr5xx,
  makeBlockingGate,
} from "back-end/src/revisions/publishGates";
import type {
  BulkPublishableAdapter,
  BulkRevisionRef,
} from "back-end/src/revisions/bulkPublish/BulkPublishableAdapter";

// Adapts the feature revision store and apply path to the bulk orchestrator.

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
  // The stamp the apply's guarded write PUT on the feature document. Distinct
  // from `updatedFeature.dateUpdated`, which is a set-then-fetch and so carries a
  // rival's stamp when one lands in the gap — reading ownership from that says
  // "still ours" at the one moment it isn't.
  ourWriteStamp?: Date;
  // Per safe rollout the apply's status sync will write: the pre-apply doc
  // (compensation's restore source), the status the sync writes (the
  // ownership check even when `post` is absent), and the post-apply doc
  // (per-field ownership baseline so worker progress is never clobbered;
  // absent when the apply threw before the feature write completed).
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
  staleBaseForceAllowsRestBypass: false,

  applyScanOverlay(overlayContext, proposedEntities) {
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

  canUpdate(context, entity) {
    // Coarse destination precheck; collectGates performs footprint-aware authorization.
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

    // Use caller context for footprint-aware landing authority.
    const envsToCheck = await getMergeResultPublishEnvs({
      context: callerContext,
      feature,
      filledLiveRules: plan.filledLiveRules,
      result: plan.mergeResult,
      environmentIds: plan.environmentIds,
      // Same blind spot as the single publish: ramp reach is not in any rule diff.
      rampActions: raw.rampActions,
    });
    if (
      !(await canPublishFeatureRevisionChange({
        context: callerContext,
        feature,
        revision: raw,
        environments: envsToCheck,
        mergeChanges: plan.mergeResult,
      }))
    ) {
      gates.push(
        makeBlockingGate({
          type: "permission-denied",
          messages: [
            "You do not have permission to publish this Feature Flag in the environments this revision changes.",
          ],
        }),
      );
    }

    // Archiving requires delete authority over the publish footprint.
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

    if (authorityRefused(gates)) return gates;

    // Feature publishes must advance the live version pointer.
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

    try {
      await assertFeatureNotLockedByRamp(overlayContext, feature.id);
    } catch (e) {
      // Only RampLockdownError is bypassable; propagate schedule-read failures.
      if (!(e instanceof RampLockdownError)) throw e;
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

    // Evaluate shared gates against the release overlay.
    try {
      gates.push(
        ...(await collectFeaturePublishGates({
          context: overlayContext,
          feature,
          revision: raw,
          plan,
          comment: flags.comment,
          // Hooks must see the caller as publisher, not the overlay context.
          publisher: callerContext.auditUser,
          includeValidationGates: true,
        })),
      );
    } catch (e) {
      // Convert only the collector's 4xx rejection to a gate.
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

    // Recheck holdout validity before mutation to close planning-time drift.
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

    // Create ramps before the feature write and retain leaked IDs for compensation.
    desired.createdRampScheduleIds = await applyRampCreateActionsForRevision(
      context,
      feature,
      raw,
      mergeResult,
      // Recorded even when the create throws, so compensation sees schedules
      // a failed create left behind instead of them vanishing with the error.
      (leaked) => {
        desired.createdRampScheduleIds = [
          ...(desired.createdRampScheduleIds ?? []),
          ...leaked,
        ];
      },
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
      desired.updatedFeature = await runGuardedWrite(
        "feature",
        feature.id,
        () =>
          applyRevisionChanges(
            context,
            feature,
            raw,
            mergeResult,
            (stamp) => {
              desired.ourWriteStamp = stamp;
            },
            // Use sync-reported rollout images; later reads could capture worker progress.
            (postImages) => {
              const postById = new Map(postImages.map((doc) => [doc.id, doc]));
              for (const entry of desired.safeRollouts ?? []) {
                entry.post = postById.get(entry.pre.id);
              }
            },
          ),
      );
    } catch (e) {
      // No write stamp means the feature document did not land.
      if (desired.ourWriteStamp === undefined) revision.casLost = true;
      throw e;
    }
    // A rollout with no reported baseline is refused by
    // restoreAfterFailedBulkPublish rather than half-restored.

    // Fence before satellite writes using the exact feature write stamp.
    if (desired.ourWriteStamp) {
      const live = await getFeature(context, feature.id);
      if (live?.dateUpdated?.getTime() !== desired.ourWriteStamp.getTime()) {
        revision.casLost = true;
        throw new LandingConflictError("feature", feature.id);
      }
    }

    // Satellite writes span collections and cannot be transactional. Guard each
    // write, then re-fence the feature; holdout membership cannot encode ownership.
    try {
      if (mergeResult.holdout !== undefined) {
        // Guard already ran above, before any mutation.
        await applyHoldoutSideEffects(context, feature, mergeResult.holdout, {
          skipGuard: true,
          // Same reason as the direct path: compensation must remove the entry
          // this pass wrote, not whatever occupies the slot when it runs.
          onFeatureLinked: (entry) => {
            if (desired.holdoutLinkage) {
              desired.holdoutLinkage.addedFeatureEntry = entry;
            }
          },
        });
      }

      // One chain across the sequence — see applyHoldoutExperimentLinkage.
      const linkageChain: Record<string, string> = {};
      for (const plan of desired.holdoutExperimentLinkage ?? []) {
        await applyHoldoutExperimentLinkage(context, plan, linkageChain);
      }

      if (desired.contextualBanditLinkage) {
        await applyFeatureContextualBanditLinkage(
          context,
          desired.contextualBanditLinkage,
          { guarded: true },
        );
      }

      // Re-fence after satellites; loss triggers ownership-aware compensation.
      if (desired.ourWriteStamp) {
        const after = await getFeature(context, feature.id);
        if (after?.dateUpdated?.getTime() !== desired.ourWriteStamp.getTime()) {
          throw new CasConflictError();
        }
      }
    } catch (e) {
      if (!(e instanceof CasConflictError)) throw e;
      throw new LandingConflictError("feature", feature.id);
    }
  },

  async restorePreImage(context, preImage, revision, desiredState) {
    // A CAS loser may still have created ramps before the guarded feature write.
    if (revision.casLost) {
      const desired = desiredState as unknown as FeatureDesiredState;
      if (desired.createdRampScheduleIds?.length) {
        const failedIds = await rollbackCreatedRampSchedules(
          context,
          desired.createdRampScheduleIds,
        );
        if (failedIds.length) {
          throw new Error(
            `bulk publish compensation: CAS-lost feature "${(preImage as { id: string }).id}" leaked ramp schedule(s) ${failedIds.join(", ")}`,
          );
        }
      }
      return;
    }
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

    // Leave the feature published if any satellite reversal fails; restoring the
    // document beside unreverted satellites would falsely report a rollback.
    const assertNoReversalFailures = () => {
      if (reversalFailures.length) {
        throw new Error(
          `bulk publish compensation: could not fully roll back feature ${feature.id} — ${reversalFailures.join(", ")}; feature left at the published state`,
        );
      }
    };

    // A rival owns the document, but ownership-aware satellite reversals still remove ours.
    const ourStamp = desired.ourWriteStamp;
    const docLostToRival = !!(
      ourStamp &&
      current.dateUpdated?.getTime() !== new Date(ourStamp).getTime()
    );

    // Preflight every rollout reversal before performing any of them.
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

    // Reverse holdout linkage from pre-images so compensation is idempotent.
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

    // Delete created ramps only after all satellites are restored.
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
    if (docLostToRival) {
      // Satellites were restored, but a rival owns the document; report it published.
      throw new Error(
        `bulk publish compensation: feature "${feature.id}" was changed by a later write; its satellite writes were taken back but the document is left at the newer landing's state`,
      );
    }
    if (Object.keys(restore).length) {
      // Guard restoration on the ownership read; losing this CAS leaves the winner untouched.
      await updateFeature(context, current, restore, {
        casOnDateUpdated: current.dateUpdated,
      });
    }
    // Suppress this adapter's deferred update event after restoration.
    context.bulkPublishRestoredEntities?.add(entityKey("feature", feature.id));
  },

  async emitPublished(context, entity, revision, desiredState) {
    const feature = entity as unknown as FeatureInterface;
    const desired = desiredState as unknown as FeatureDesiredState;
    const raw = rawRevision(revision);
    const updated =
      desired.updatedFeature ??
      (await getFeature(context, feature.id)) ??
      feature;

    // Run required published effects before the isolated best-effort tail.
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
    const revertedTo = draftRevertedFromVersion(finalRevision);
    if (revertedTo !== undefined) {
      await dispatchFeatureRevisionEvent(
        context,
        updated,
        finalRevision,
        "revision.reverted",
        { ...bulkPublishFields(context), revertedToVersion: revertedTo },
      );
    }

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
