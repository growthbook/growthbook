import {
  Revision,
  RevisionTargetType,
  checkMergeConflicts,
  normalizeProposedChanges,
} from "shared/enterprise";
import type { Context } from "back-end/src/models/BaseModel";
import {
  type EntityRevisionAdapter,
  filterUpdatableChanges,
} from "back-end/src/revisions/EntityRevisionAdapter";
import type { PublishGate } from "back-end/src/revisions/publishGates";
import { buildMergeDesiredState } from "back-end/src/revisions/util";
import { collectRevisionGovernanceGates } from "back-end/src/revisions/governanceGates";
import { ownedRestoreValues } from "back-end/src/revisions/bulkPublish/ownedRestore";
import { getRevisionWebhookAdapter } from "back-end/src/events/revisionWebhookAdapters";
import { ConflictError, MergeConflictError } from "back-end/src/util/errors";
import type {
  BulkPublishableAdapter,
  BulkRevisionRef,
} from "back-end/src/revisions/bulkPublish/BulkPublishableAdapter";

function toRef(revision: Revision): BulkRevisionRef {
  return {
    id: revision.id,
    version: revision.version ?? 0,
    status: revision.status,
    dateUpdated: revision.dateUpdated,
    raw: revision,
  };
}

/**
 * Bulk-publish surface for any entity on the generic revision system. Wraps
 * the entity's EntityRevisionAdapter for entity behavior and the shared
 * RevisionModel for revision lifecycle. `extraGates` lets a type contribute
 * gates its single-entity REST handler assembles inline (e.g. the config
 * lock gate) without the orchestrator knowing the type.
 */
export function makeGenericBulkAdapter(
  targetType: RevisionTargetType,
  adapter: EntityRevisionAdapter,
  options: {
    extraGates?: (args: {
      callerContext: Context;
      overlayContext: Context;
      entity: Record<string, unknown>;
      revision: Revision;
      desiredState: Record<string, unknown>;
    }) => Promise<PublishGate[]>;
    // Install this type's proposed docs on the overlay context — wired per type
    // in the registry, since each model's setScanOverlay is strongly typed.
    setScanOverlay: (
      overlayContext: Context,
      proposedEntities: Record<string, unknown>[],
    ) => void;
  },
): BulkPublishableAdapter {
  return {
    staleBaseForceAllowsRestBypass: true,

    applyScanOverlay(overlayContext, proposedEntities) {
      options.setScanOverlay(overlayContext, proposedEntities);
    },

    async loadEntity(context, entityId) {
      const model = adapter.getModel(context);
      if (!model) return null;
      return (await model.getById(entityId)) ?? null;
    },

    async loadRevision(context, entity, version) {
      const revision = await context.models.revisions.getByTargetAndVersion(
        targetType,
        (entity as { id: string }).id,
        version,
      );
      return revision ? toRef(revision) : null;
    },

    canPublish(context, entity) {
      return adapter.canPublishRevision
        ? adapter.canPublishRevision(context, entity)
        : adapter.canUpdate(context, entity);
    },

    canUpdate(context, entity) {
      return adapter.canUpdate(context, entity);
    },

    canBypassApproval(context, entity) {
      return adapter.canBypassApproval(context, entity);
    },

    async buildDesiredState(context, entity, revision) {
      const raw = revision.raw as Revision;
      const snapshot = raw.target.snapshot as Record<string, unknown>;
      const updatable = adapter.getUpdatableFields();
      const conflictResult = checkMergeConflicts(
        snapshot,
        entity,
        normalizeProposedChanges(raw.target.proposedChanges),
        updatable,
      );
      if (!conflictResult.success) {
        throw new MergeConflictError(
          "Merge conflicts exist — rebase before publishing",
          conflictResult.conflicts,
        );
      }
      const desiredState = buildMergeDesiredState(
        entity,
        snapshot,
        raw.target.proposedChanges,
        updatable,
      );
      // Exactly what applyChanges will write — same filter, so hasChanges can
      // never disagree with the apply about whether there's a net change.
      const hasChanges =
        Object.keys(filterUpdatableChanges(desiredState, entity, updatable))
          .length > 0;
      return {
        desiredState,
        hasChanges,
        proposedEntity: { ...entity, ...desiredState },
      };
    },

    async collectGates({
      callerContext,
      overlayContext,
      entity,
      revision,
      desiredState,
    }) {
      const raw = revision.raw as Revision;
      // Approval + stale-base via the shared collector (approval scoping
      // stays inside each adapter's isApprovalRequiredForRevision). Caller
      // context: governance judges the caller's org policy, not the overlay
      // end-state.
      const gates: PublishGate[] = collectRevisionGovernanceGates({
        context: callerContext,
        adapter,
        targetType,
        entity,
        revision: raw,
      });

      // Entity-level guards + schema validation, evaluated against the
      // multi-entity end-state: the overlay context is both the read context
      // (models carry the overlay) and — via scanContextOverride — the scan
      // context every guard evaluator inside uses.
      if (adapter.collectPublishGates) {
        gates.push(
          ...(await adapter.collectPublishGates(
            overlayContext,
            entity,
            raw,
            desiredState,
          )),
        );
      }

      if (options.extraGates) {
        gates.push(
          ...(await options.extraGates({
            callerContext,
            overlayContext,
            entity,
            revision: raw,
            desiredState,
          })),
        );
      }

      return gates;
    },

    async prepareNoOpMerge(context, entity, revision) {
      await adapter.beforeNoOpMerge?.(
        context,
        entity,
        revision.raw as Revision,
      );
    },

    async claim(context, revision, baseline, { isApprovalBypass, comment }) {
      try {
        const merged = await context.models.revisions.merge(
          revision.id,
          context.userId,
          {
            bypass: isApprovalBypass,
            comment,
            expected: {
              status: baseline.revisionStatus,
              dateUpdated: baseline.revisionDateUpdated,
            },
          },
        );
        // The dateUpdated our merge left behind — releaseClaim pins its reopen
        // to it so a concurrent re-publish's successful merge isn't clobbered.
        revision.claimStamp = merged.dateUpdated;
        return true;
      } catch (e) {
        // A lost CAS race is the expected "false" outcome; anything else
        // (DB failure, permission error) must surface as itself, not a 409.
        if (e instanceof ConflictError) return false;
        throw e;
      }
    },

    async releaseClaim(context, revision) {
      // Reopen only the exact merge we made (status still "merged" AND the
      // dateUpdated our claim stamped). If a concurrent actor reopened and
      // re-published the revision in the meantime, the fingerprint misses and
      // we leave their published state alone — the orchestrator reports this
      // item as still-published (needs attention), never a silent clobber.
      const restored = await context.models.revisions.reopenAfterFailedApply(
        revision.id,
        context.userId,
        revision.raw as Revision,
        revision.claimStamp ?? null,
      );
      return restored !== null;
    },

    async applyPrecomputed(context, entity, revision, desiredState) {
      const raw = revision.raw as Revision;
      // The keys the write actually persisted (post updatable-filter and
      // post-normalization) — the exact set compensation may roll back.
      revision.persistedKeys = await adapter.applyChanges(
        context,
        entity,
        desiredState,
        { isRevert: !!raw.revertedFrom },
      );
      // The write may NORMALIZE what it persists (config schemas are stripped
      // against ancestors), so the post-apply doc — not desiredState — is the
      // ownership baseline compensation compares the live doc against.
      const model = adapter.getModel(context);
      revision.writtenEntity =
        (await model?.getById((entity as { id: string }).id)) ?? null;
    },

    async restorePreImage(context, preImage, revision, desiredState) {
      const model = adapter.getModel(context);
      const current = await model?.getById((preImage as { id: string }).id);
      // This apply wrote the entity, so it should exist. If it's gone (a
      // concurrent hard-delete between apply and compensation), surface it —
      // reporting the item "rolled-back" would assert a pre-image that no
      // longer exists. Throwing routes it to restore-failed (needs attention).
      if (!current) {
        throw new Error(
          `bulk publish compensation: ${targetType} "${(preImage as { id: string }).id}" no longer exists — cannot restore its pre-image`,
        );
      }
      // Restore only the fields the apply ACTUALLY persisted — captured from
      // applyChanges, so a key dropped by the updatable filter or by config
      // normalization is never rolled back over a concurrent writer's value.
      // (Falls back to the desired-state keys for a revision that never went
      // through applyPrecomputed — defensive; that path doesn't reach here.)
      const updatable = adapter.getUpdatableFields();
      const persistedKeys =
        revision.persistedKeys ??
        Object.keys(desiredState).filter((k) => updatable.has(k));
      // What the apply actually persisted: the post-apply doc when the write
      // completed (normalization-aware), else the precomputed desired state.
      const written =
        (revision.writtenEntity as Record<string, unknown> | null) ??
        desiredState;
      const pre = preImage as Record<string, unknown>;
      const restore = ownedRestoreValues({
        keys: persistedKeys,
        preImage: pre,
        written,
        current: current as Record<string, unknown>,
      });
      if (!Object.keys(restore).length) return;
      await adapter.applyChanges(context, current, restore, {
        // Restoring a pre-image is semantically a revert to a known-good
        // published state — skip validations that would block a restore.
        isRevert: true,
      });
    },

    async emitPublished(context, entity, revision) {
      const merged = await context.models.revisions.getById(revision.id);
      if (!merged) return;
      await getRevisionWebhookAdapter(targetType)?.dispatch(context, merged, {
        type: merged.revertedFrom ? "reverted" : "published",
      });
    },

    async emitPublishFailed(context, entity, revision, reason) {
      const current =
        (await context.models.revisions.getById(revision.id)) ??
        (revision.raw as Revision);
      await getRevisionWebhookAdapter(targetType)?.dispatch(context, current, {
        type: "publishFailed",
        reason,
        terminal: false,
        attempts: 1,
      });
    },
  };
}
